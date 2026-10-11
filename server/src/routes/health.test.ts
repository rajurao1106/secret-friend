import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config/env.js';

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  CORS_ORIGIN: 'http://localhost:56767',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/secret_friend',
  JWT_SECRET: 'test_only_secret_that_is_at_least_32_characters',
  JWT_REFRESH_SECRET: 'test_only_refresh_secret_over_32_characters',
  OTP_PROVIDER: 'mock',
};

test('GET /health returns the service status', async () => {
  const app = buildApp(testConfig);

  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});

test('allows Flutter Web localhost origins on a dynamic development port', async () => {
  const app = buildApp({ ...testConfig, NODE_ENV: 'development' });

  try {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/auth/send-otp',
      headers: {
        origin: 'http://localhost:56767',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:56767');
  } finally {
    await app.close();
  }
});

test('allows profile updates in CORS preflight requests', async () => {
  const app = buildApp({ ...testConfig, NODE_ENV: 'development' });

  try {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/me/profile',
      headers: {
        origin: 'http://localhost:5000',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.match(
      response.headers['access-control-allow-methods'] ?? '',
      /\bPUT\b/,
    );
  } finally {
    await app.close();
  }
});

test('closes the realtime and HTTP servers cleanly', async () => {
  const app = buildApp(testConfig);

  await app.listen({ host: '127.0.0.1', port: 0 });
  await app.close();
});

test('rejects invalid mobile numbers before sending an OTP', async () => {
  const app = buildApp(testConfig);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/send-otp',
      payload: { mobile: '12345' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'Invalid Indian mobile number' });
  } finally {
    await app.close();
  }
});

test('protects account deletion with an access token', async () => {
  const app = buildApp(testConfig);

  try {
    const response = await app.inject({ method: 'DELETE', url: '/me' });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('protects discovery with an access token', async () => {
  const app = buildApp(testConfig);

  try {
    const response = await app.inject({ method: 'GET', url: '/discover' });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('protects REST chat history, message, and read endpoints', async () => {
  const app = buildApp(testConfig);
  const conversationId = '19d25512-0e0f-4a67-8df0-13a28c28bd48';

  try {
    const requests = [
      { method: 'GET' as const, url: `/conversations/${conversationId}/messages` },
      {
        method: 'POST' as const,
        url: `/conversations/${conversationId}/messages`,
        payload: { type: 'text', body: 'Hello' },
      },
      {
        method: 'POST' as const,
        url: `/conversations/${conversationId}/read`,
        payload: {},
      },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 401);
    }
  } finally {
    await app.close();
  }
});

test('protects meetup participation, presence, roster, and request endpoints', async () => {
  const app = buildApp(testConfig);
  const requestId = '0e3cc201-74e3-4f75-adbc-5a7d16c842a7';
  const requests = [
    { method: 'GET' as const, url: '/meetup/today' },
    {
      method: 'PUT' as const,
      url: '/meetup/interest',
      payload: { interested: true, quickReply: false },
    },
    { method: 'POST' as const, url: '/meetup/check-in', payload: {} },
    { method: 'POST' as const, url: '/meetup/presence', payload: {} },
    { method: 'GET' as const, url: '/meetup/online' },
    {
      method: 'POST' as const,
      url: '/meetup/requests',
      payload: { userId: requestId },
    },
    { method: 'GET' as const, url: '/meetup/requests?type=received' },
    {
      method: 'POST' as const,
      url: `/meetup/requests/${requestId}/accepted`,
      payload: {},
    },
    {
      method: 'POST' as const,
      url: `/meetup/requests/${requestId}/declined`,
      payload: {},
    },
  ];

  try {
    for (const request of requests) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 401, request.url);
    }
  } finally {
    await app.close();
  }
});

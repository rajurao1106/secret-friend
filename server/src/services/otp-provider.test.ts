import assert from 'node:assert/strict';
import test from 'node:test';
import { Msg91OtpProvider } from './otp-provider.js';

const config = {
  MSG91_AUTH_KEY: 'test-auth-key',
  MSG91_TEMPLATE_ID: 'test-template-id',
};

test('sends the generated OTP through the configured MSG91 Flow template', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ type: 'success', message: 'sent' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const provider = new Msg91OtpProvider(config, fetcher);
  await provider.sendOtp('9876543210', '012345');

  assert.equal(requestUrl, 'https://control.msg91.com/api/v5/flow/');
  assert.equal(requestInit?.method, 'POST');
  assert.equal(
    new Headers(requestInit?.headers).get('authkey'),
    config.MSG91_AUTH_KEY,
  );
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    template_id: config.MSG91_TEMPLATE_ID,
    short_url: '0',
    recipients: [{ mobiles: '919876543210', VAR1: '012345' }],
  });
});

test('rejects missing MSG91 credentials during provider setup', () => {
  assert.throws(
    () => new Msg91OtpProvider({ MSG91_TEMPLATE_ID: config.MSG91_TEMPLATE_ID }),
    /MSG91_AUTH_KEY is required/,
  );
  assert.throws(
    () => new Msg91OtpProvider({ MSG91_AUTH_KEY: config.MSG91_AUTH_KEY }),
    /MSG91_TEMPLATE_ID is required/,
  );
});

test('reports MSG91 provider rejections without treating them as sent', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ type: 'error', message: 'invalid template' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const provider = new Msg91OtpProvider(config, fetcher);

  await assert.rejects(
    provider.sendOtp('9876543210', '012345'),
    /MSG91 OTP request failed/,
  );
});

test('rejects successful HTTP responses without MSG91 success confirmation', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ message: 'unexpected response' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const provider = new Msg91OtpProvider(config, fetcher);

  await assert.rejects(
    provider.sendOtp('9876543210', '012345'),
    /MSG91 OTP request failed/,
  );
});

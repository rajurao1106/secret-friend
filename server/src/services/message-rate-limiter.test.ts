import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageRateLimiter } from './message-rate-limiter.js';

test('allows 20 messages per user per 10 seconds', () => {
  const limiter = new MessageRateLimiter();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(limiter.allow('user-1', 1000 + attempt), true);
  }
  assert.equal(limiter.allow('user-1', 2000), false);
  assert.equal(limiter.allow('user-2', 2000), true);
  assert.equal(limiter.allow('user-1', 11_001), true);
});

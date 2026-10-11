import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashOtp,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  verifyOtpChallenge,
} from './otp.js';

const secret = 'test_only_secret_that_is_at_least_32_characters';
const mobile = '9876543210';
const code = '012345';
const now = new Date('2026-10-11T00:00:00.000Z');

test('OTP challenges expire after five minutes', () => {
  const result = verifyOtpChallenge(
    {
      codeHash: hashOtp(mobile, code, secret),
      attempts: 0,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
    mobile,
    code,
    secret,
    new Date(now.getTime() + OTP_TTL_MS),
  );

  assert.deepEqual(result, { status: 'expired', attempts: 0 });
});

test('OTP verification stops after five attempts', () => {
  let attempts = 0;

  for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
    const result = verifyOtpChallenge(
      {
        codeHash: hashOtp(mobile, code, secret),
        attempts,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
      mobile,
      '999999',
      secret,
      now,
    );
    assert.equal(result.status, 'invalid');
    attempts = result.attempts;
  }

  const fifthAttempt = verifyOtpChallenge(
    {
      codeHash: hashOtp(mobile, code, secret),
      attempts,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
    mobile,
    '999999',
    secret,
    now,
  );
  assert.deepEqual(fifthAttempt, {
    status: 'attempt_limit',
    attempts: OTP_MAX_ATTEMPTS,
  });

  const sixthAttempt = verifyOtpChallenge(
    {
      codeHash: hashOtp(mobile, code, secret),
      attempts: fifthAttempt.attempts,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
    mobile,
    code,
    secret,
    now,
  );
  assert.deepEqual(sixthAttempt, {
    status: 'attempt_limit',
    attempts: OTP_MAX_ATTEMPTS,
  });
});

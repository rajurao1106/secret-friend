import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export interface OtpChallenge {
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly codeHash: string;
}

export type OtpVerification =
  | { readonly status: 'valid'; readonly attempts: number }
  | { readonly status: 'invalid'; readonly attempts: number }
  | { readonly status: 'expired'; readonly attempts: number }
  | { readonly status: 'attempt_limit'; readonly attempts: number };

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TTL_MS = 5 * 60 * 1000;

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(mobile: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${mobile}:${code}`).digest('hex');
}

export function verifyOtpChallenge(
  challenge: OtpChallenge,
  mobile: string,
  code: string,
  secret: string,
  now = new Date(),
): OtpVerification {
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    return { status: 'expired', attempts: challenge.attempts };
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return { status: 'attempt_limit', attempts: challenge.attempts };
  }

  const submittedHash = Buffer.from(hashOtp(mobile, code, secret), 'hex');
  const storedHash = Buffer.from(challenge.codeHash, 'hex');
  const matches =
    submittedHash.length === storedHash.length &&
    timingSafeEqual(submittedHash, storedHash);
  const attempts = challenge.attempts + 1;

  if (matches) {
    return { status: 'valid', attempts };
  }

  return attempts >= OTP_MAX_ATTEMPTS
    ? { status: 'attempt_limit', attempts }
    : { status: 'invalid', attempts };
}

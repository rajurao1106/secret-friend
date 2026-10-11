import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudinaryMediaStorage } from './media-storage.js';

const storage = new CloudinaryMediaStorage({
  NODE_ENV: 'test',
  PORT: 3000,
  CORS_ORIGIN: 'http://localhost:56767',
  DATABASE_URL: 'postgres://localhost:5432/secret_friend',
  JWT_SECRET: 'test_only_secret_that_is_at_least_32_characters',
  JWT_REFRESH_SECRET: 'test_only_refresh_secret_over_32_characters',
  OTP_PROVIDER: 'mock',
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
});

test('builds authenticated Cloudinary asset keys with the raw file extension', () => {
  assert.equal(
    storage.keyForUpload(
      'owner-id',
      'gallery',
      'upload-id',
      'image/jpeg',
    ),
    'image/owner-id/gallery/upload-id',
  );
  assert.equal(
    storage.keyForUpload(
      'owner-id',
      'chat',
      'upload-id',
      'application/pdf',
    ),
    'raw/owner-id/chat/upload-id.pdf',
  );
});

test('returns signed authenticated multipart upload instructions', async () => {
  const result = await storage.presignUpload(
    'image/owner-id/profile/upload-id',
    900,
  );

  assert.equal(result.uploadUrl, 'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
  assert.equal(result.method, 'POST');
  assert.equal(result.expiresInSeconds, 900);
  assert.equal(result.fields.public_id, 'owner-id/profile/upload-id');
  assert.equal(result.fields.type, 'authenticated');
  assert.equal(result.fields.overwrite, 'false');
  assert.equal(result.fields.api_key, 'test-key');
  assert.ok(result.fields.signature);
});

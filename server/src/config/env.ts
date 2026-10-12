import 'dotenv/config';
import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value: unknown) => (value === '' ? undefined : value),
  z.url().optional(),
);
const optionalString = z.preprocess(
  (value: unknown) => (value === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.url().default('http://localhost:5000'),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  OTP_PROVIDER: z.enum(['mock', 'msg91']).default('mock'),
  MSG91_AUTH_KEY: optionalString,
  MSG91_TEMPLATE_ID: optionalString,
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
});

export const env = envSchema.parse(process.env);
export type AppConfig = typeof env;

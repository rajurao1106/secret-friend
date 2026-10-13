import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AppConfig } from '../config/env.js';

export interface FirebaseIdentity {
  readonly phoneNumber?: string;
}

export interface FirebaseTokenVerifier {
  verifyIdToken(idToken: string): Promise<FirebaseIdentity>;
}

export class FirebaseAdminConfigurationError extends Error {
  constructor() {
    super('Firebase Admin credentials are required to verify sign-in tokens');
  }
}

export class FirebaseTokenInvalidError extends Error {
  constructor() {
    super('Firebase sign-in token is invalid or expired');
  }
}

export class FirebaseAdminTokenVerifier implements FirebaseTokenVerifier {
  readonly #config: Pick<
    AppConfig,
    'FIREBASE_PROJECT_ID' | 'FIREBASE_CLIENT_EMAIL' | 'FIREBASE_PRIVATE_KEY'
  >;

  constructor(
    config: Pick<
      AppConfig,
      'FIREBASE_PROJECT_ID' | 'FIREBASE_CLIENT_EMAIL' | 'FIREBASE_PRIVATE_KEY'
    >,
  ) {
    this.#config = config;
  }

  async verifyIdToken(idToken: string): Promise<FirebaseIdentity> {
    const projectId = this.#config.FIREBASE_PROJECT_ID?.trim();
    const clientEmail = this.#config.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = this.#config.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
    if (
      projectId === undefined ||
      projectId.length === 0 ||
      clientEmail === undefined ||
      clientEmail.length === 0 ||
      privateKey === undefined ||
      privateKey.length === 0
    ) {
      throw new FirebaseAdminConfigurationError();
    }

    const appName = 'secret-friend-auth';
    const app =
      getApps().find((candidate) => candidate.name === appName) ??
      initializeApp(
        {
          credential: cert({ projectId, clientEmail, privateKey }),
          projectId,
        },
        appName,
      );
    let decodedToken;
    try {
      decodedToken = await getAuth(app).verifyIdToken(idToken, true);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string' &&
        [
          'auth/argument-error',
          'auth/invalid-id-token',
          'auth/id-token-expired',
          'auth/id-token-revoked',
          'auth/user-disabled',
          'auth/user-not-found',
          'auth/tenant-id-mismatch',
        ].includes(error.code)
      ) {
        throw new FirebaseTokenInvalidError();
      }
      throw error;
    }
    return { phoneNumber: decodedToken.phone_number };
  }
}

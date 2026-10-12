import type { AppConfig } from '../config/env.js';

export interface OtpProvider {
  sendOtp(mobile: string, code: string): Promise<void>;
}

export class MockOtpProvider implements OtpProvider {
  async sendOtp(mobile: string, code: string): Promise<void> {
    console.info(`[mock-otp] ***${mobile.slice(-2)}: ${code}`);
  }
}

export class Msg91OtpProvider implements OtpProvider {
  readonly #authKey: string;
  readonly #templateId: string;
  readonly #fetch: typeof fetch;

  constructor(
    config: Pick<AppConfig, 'MSG91_AUTH_KEY' | 'MSG91_TEMPLATE_ID'>,
    fetcher: typeof fetch = fetch,
  ) {
    const authKey = config.MSG91_AUTH_KEY?.trim();
    const templateId = config.MSG91_TEMPLATE_ID?.trim();
    if (authKey === undefined || authKey.length === 0) {
      throw new Error('MSG91_AUTH_KEY is required when OTP_PROVIDER=msg91');
    }
    if (templateId === undefined || templateId.length === 0) {
      throw new Error('MSG91_TEMPLATE_ID is required when OTP_PROVIDER=msg91');
    }
    this.#authKey = authKey;
    this.#templateId = templateId;
    this.#fetch = fetcher;
  }

  async sendOtp(mobile: string, code: string): Promise<void> {
    const response = await this.#fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: this.#authKey,
      },
      body: JSON.stringify({
        template_id: this.#templateId,
        short_url: '0',
        recipients: [
          {
            mobiles: `91${mobile}`,
            VAR1: code,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const responseText = await response.text();
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      if (response.ok) {
        throw new Error('MSG91 returned an invalid response');
      }
      throw new Error(`MSG91 OTP request failed (HTTP ${response.status})`);
    }

    const responseType =
      typeof responseData === 'object' &&
      responseData !== null &&
      'type' in responseData &&
      typeof responseData.type === 'string'
        ? responseData.type.toLowerCase()
        : undefined;

    if (!response.ok || responseType !== 'success') {
      throw new Error(`MSG91 OTP request failed (HTTP ${response.status})`);
    }
  }
}

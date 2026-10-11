export interface OtpProvider {
  sendOtp(mobile: string, code: string): Promise<void>;
}

export class MockOtpProvider implements OtpProvider {
  async sendOtp(mobile: string, code: string): Promise<void> {
    console.info(`[mock-otp] ***${mobile.slice(-2)}: ${code}`);
  }
}

export class Msg91OtpProvider implements OtpProvider {
  async sendOtp(_mobile: string, _code: string): Promise<void> {
    throw new Error('MSG91 OTP delivery is not configured');
  }
}

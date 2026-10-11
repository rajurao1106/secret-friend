export interface ModerationService {
  inspectImage(key: string, mime: string): Promise<void>;
}

export class NoopModerationService implements ModerationService {
  async inspectImage(_key: string, _mime: string): Promise<void> {
    return;
  }
}

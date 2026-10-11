export interface NotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
}

export interface NotificationService {
  push(userId: string, payload: NotificationPayload): Promise<void>;
}

export class NoopNotificationService implements NotificationService {
  async push(_userId: string, _payload: NotificationPayload): Promise<void> {
    return;
  }
}

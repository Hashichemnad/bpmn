import { Inject, Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string | null;
  fromAddress: string;
  fromName: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email. Replaced by an in-memory outbox in tests, so the test suite never sends
 * real email.
 */
@Injectable()
export class MailTransport {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(smtp: SmtpConfig, msg: MailMessage): Promise<void> {
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
      connectionTimeout: this.config.SMTP_TIMEOUT_MS,
      greetingTimeout: this.config.SMTP_TIMEOUT_MS,
      socketTimeout: this.config.SMTP_TIMEOUT_MS,
    });
    try {
      await transport.sendMail({
        from: smtp.fromName ? { name: smtp.fromName, address: smtp.fromAddress } : smtp.fromAddress,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
    } finally {
      transport.close();
    }
  }
}

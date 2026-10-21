import { Inject, Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { OutboundPolicy } from '../common/outbound';

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
 * real email. The SMTP host must not be internal unless allowed (OUTBOUND_ALLOWED_HOSTS); the
 * checked address is the one connected to, and TLS still verifies the configured host name.
 */
@Injectable()
export class MailTransport {
  private readonly policy: OutboundPolicy;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.policy = new OutboundPolicy(config.outboundAllowedHosts);
  }

  async send(smtp: SmtpConfig, msg: MailMessage): Promise<void> {
    const { address } = await this.policy.resolve(smtp.host);
    const transport = createTransport({
      host: address,
      servername: smtp.host,
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

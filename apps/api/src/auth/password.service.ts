import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { checkPasswordPolicy } from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/app-exception';
import { hashPassword } from './argon';

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same time as a real verification, to avoid user enumeration by timing. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  /** Throws a 400 with the list of violated rules when the password is too weak. */
  assertPolicy(password: string): void {
    const errors = checkPasswordPolicy(password, this.config.passwordPolicy);
    if (errors.length) {
      throw badRequest('WEAK_PASSWORD', 'Password does not meet the policy', {
        errors,
        policy: this.config.passwordPolicy,
      });
    }
  }
}

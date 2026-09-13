import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import type { Env } from '../../config/env';

/**
 * Password hashing and policy (doc 07 §1).
 *
 * Argon2id, tuned so a hash costs roughly 250ms on the target server. The
 * parameters are configuration, not constants, so they can be raised as
 * hardware improves without a code change.
 */
@Injectable()
export class PasswordService {
  constructor(private readonly env: Env) {}

  private get options(): argon2.Options {
    return {
      type: argon2.argon2id,
      memoryCost: this.env.ARGON2_MEMORY_KIB,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    };
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A malformed hash must not be distinguishable from a wrong password.
      return false;
    }
  }

  /**
   * Burns roughly the same time as a real verification.
   *
   * Called when the account does not exist, so that response timing cannot be
   * used to enumerate valid email addresses.
   */
  async burnTime(): Promise<void> {
    const dummy =
      '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$Zm9yY29uc3RhbnR0aW1lY29tcGFyaXNvbg';
    await this.verify(dummy, 'not-the-password');
  }

  /** Constant-time comparison for non-password secrets (invitation tokens). */
  safeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }

  /**
   * Password policy.
   *
   * Length first, because it does more for real-world strength than character
   * classes. The personal-information check matters in a facility where names
   * are widely known.
   */
  validate(
    password: string,
    context: { email?: string; fullName?: string; facilityName?: string } = {},
  ): { valid: boolean; problems: string[] } {
    const problems: string[] = [];

    if (password.length < 12) {
      problems.push('Use at least 12 characters. Length matters more than symbols.');
    }
    if (password.length > 200) {
      problems.push('That is longer than 200 characters.');
    }
    if (/^(.)\1+$/.test(password)) {
      problems.push('A single repeated character is not a password.');
    }
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      problems.push('That password appears on lists of commonly used passwords.');
    }

    const personal = [context.email?.split('@')[0], context.fullName, context.facilityName]
      .filter((value): value is string => Boolean(value && value.length >= 4))
      .map((value) => value.toLowerCase());

    const lowered = password.toLowerCase();
    for (const term of personal) {
      const normalised = term.replace(/[^a-z0-9]/g, '');
      if (normalised.length >= 4 && lowered.includes(normalised)) {
        problems.push('Do not include your name, email or facility name.');
        break;
      }
    }

    return { valid: problems.length === 0, problems };
  }
}

/**
 * A deliberately small starter list. The full check belongs against a breach
 * corpus (for example a k-anonymity range API or a local bloom filter); this
 * catches the worst offenders until that is wired in, and is documented as
 * such rather than presented as complete.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '123456789012',
  'qwertyuiop12',
  'administrator',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'health123456',
  'hospital1234',
  'clinic123456',
  'nigeria12345',
  'changeme1234',
]);

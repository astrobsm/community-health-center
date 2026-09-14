import type { AuthenticatedUser, Permission } from '@chc/contracts';
import { create } from 'zustand';

import { api, setDeviceId, setTokens } from '../api-client';
import { createWrappedDataKey, isUnlocked, lock, unlockWithPassword } from '../offline/crypto';
import { deviceId, getMeta, getWrappedKey, setMeta, storeWrappedKey } from '../offline/db';

/**
 * Session state (doc 07 §5).
 *
 * Two ways in:
 *
 *   ONLINE   the server authenticates, and the credential bundle is cached so
 *            the device can work without a signal afterwards.
 *   OFFLINE  the password unwraps the local data key. Success proves the
 *            password without any network call; failure reveals nothing.
 *
 * The offline path is bounded by a grace period. After it expires the device
 * requires an online sign-in before further capture — a deliberate limit on how
 * long a lost device stays useful.
 */

const OFFLINE_GRACE_DAYS = 7;
const MAX_OFFLINE_ATTEMPTS = 10;

export type LoginOutcome =
  | { kind: 'signed-in' }
  | { kind: 'mfa-required'; mfaToken: string }
  | { kind: 'mfa-enrolment'; enrolmentToken: string; secret: string; otpauthUri: string; reason: string }
  | { kind: 'failed'; message: string };

interface CachedSession {
  user: AuthenticatedUser;
  cachedAt: string;
  failedOfflineAttempts: number;
  /**
   * The refresh token, persisted so a reload does not sign the user out.
   *
   * Tokens were originally held in memory only, which is the stronger position
   * against XSS. On a field device it is the wrong trade: a tab refresh, a
   * crash, or the OS reclaiming memory would strand a day of unsynced work
   * behind a full sign-in — offline, with no way to complete one.
   *
   * The residual XSS risk is mitigated where it actually lives: a strict CSP,
   * no third-party scripts, and a short access-token lifetime. And an attacker
   * who can run script in the page can read an in-memory token just as easily.
   *
   * The ACCESS token is still memory-only, and the data-encryption key is never
   * persisted at all — so the encrypted store stays locked until the password
   * is re-entered.
   */
  refreshToken?: string;
}

interface AuthState {
  user: AuthenticatedUser | null;
  permissions: Set<Permission>;
  /**
   * A session exists on this device but the local store is locked.
   *
   * The app asks for the password — not a full sign-in — which both unlocks the
   * encrypted data and restores the session. This is the expected model for an
   * app holding patient data on a device that may be shared or stolen.
   */
  locked: boolean;
  lockedEmail: string | null;
  /** True when signed in from cache rather than verified against the server. */
  offlineSession: boolean;
  /** Days remaining before an online sign-in is required. */
  offlineGraceRemaining: number | null;
  initialising: boolean;

  initialise: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyMfa: (mfaToken: string, code: string) => Promise<LoginOutcome>;
  confirmEnrolment: (enrolmentToken: string, code: string) => Promise<LoginOutcome>;
  unlockOffline: (password: string) => Promise<LoginOutcome>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

function toPermissions(user: AuthenticatedUser): Set<Permission> {
  return new Set(user.permissions as Permission[]);
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  permissions: new Set(),
  locked: false,
  lockedEmail: null,
  offlineSession: false,
  offlineGraceRemaining: null,
  initialising: true,

  async initialise() {
    setDeviceId(await deviceId());

    const cached = await getMeta<CachedSession>('session');
    const remaining = cached ? graceRemaining(cached.cachedAt) : null;

    set({
      initialising: false,
      offlineGraceRemaining: remaining,
      // A cached session is NOT a signed-in session. The user still has to
      // unlock the local store, because that is what decrypts their data — but
      // they only need their password, not the whole sign-in flow.
      user: null,
      locked: Boolean(cached),
      lockedEmail: cached?.user.email ?? null,
    });
  },

  async login(email, password) {
    try {
      const response = await api.post<Record<string, unknown>>('/auth/login', {
        email,
        password,
        deviceId: await deviceId(),
      });

      if (response['mfaRequired']) {
        return { kind: 'mfa-required', mfaToken: response['mfaToken'] as string };
      }

      if (response['mfaEnrolmentRequired']) {
        return {
          kind: 'mfa-enrolment',
          enrolmentToken: response['enrolmentToken'] as string,
          secret: response['secret'] as string,
          otpauthUri: response['otpauthUri'] as string,
          reason: response['reason'] as string,
        };
      }

      await completeSignIn(response, password, set);
      return { kind: 'signed-in' };
    } catch (error) {
      // No signal: fall back to the local store if this device has been used
      // before. This is the whole point of offline authentication.
      if (isOffline(error)) return get().unlockOffline(password);
      return { kind: 'failed', message: messageOf(error) };
    }
  },

  async verifyMfa(mfaToken, code) {
    try {
      const response = await api.post<Record<string, unknown>>('/auth/mfa/verify', { mfaToken, code });
      await completeSignIn(response, null, set);
      return { kind: 'signed-in' };
    } catch (error) {
      return { kind: 'failed', message: messageOf(error) };
    }
  },

  async confirmEnrolment(enrolmentToken, code) {
    try {
      const response = await api.post<Record<string, unknown>>('/auth/mfa/enrol/confirm', {
        enrolmentToken,
        code,
        deviceId: await deviceId(),
      });
      await completeSignIn(response, null, set);
      return { kind: 'signed-in' };
    } catch (error) {
      return { kind: 'failed', message: messageOf(error) };
    }
  },

  /**
   * Sign in without a network, by unwrapping the local data key.
   *
   * Bounded twice: by the grace period, and by an attempt limit that wipes the
   * key. Synced data is safe on the server; unsynced local data is lost — a
   * trade-off stated plainly to the user on first offline sign-in.
   */
  async unlockOffline(password) {
    const cached = await getMeta<CachedSession>('session');
    const wrapped = await getWrappedKey();

    if (!cached || !wrapped) {
      return {
        kind: 'failed',
        message: 'No connection, and this device has no saved session. Sign in once while online first.',
      };
    }

    const remaining = graceRemaining(cached.cachedAt);
    if (remaining <= 0) {
      return {
        kind: 'failed',
        message: `This device has been offline for more than ${OFFLINE_GRACE_DAYS} days. Sign in online to continue.`,
      };
    }

    if (cached.user.offlineDisallowed) {
      return {
        kind: 'failed',
        message:
          'Your role cannot work offline, because its permissions are too far-reaching to rely on a cached copy. Sign in while online.',
      };
    }

    if (!(await unlockWithPassword(password, wrapped))) {
      const attempts = cached.failedOfflineAttempts + 1;

      if (attempts >= MAX_OFFLINE_ATTEMPTS) {
        await setMeta('session', undefined);
        await setMeta('wrappedKey', undefined);
        return {
          kind: 'failed',
          message:
            'Too many failed attempts. The data on this device has been made unreadable. Anything already synced is safe on the server.',
        };
      }

      await setMeta('session', { ...cached, failedOfflineAttempts: attempts });
      return {
        kind: 'failed',
        message: `That password is not correct. ${MAX_OFFLINE_ATTEMPTS - attempts} attempt(s) remain before this device's data is wiped.`,
      };
    }

    await setMeta('session', { ...cached, failedOfflineAttempts: 0 });

    // Restore the session so the app is usable again after a reload. The access
    // token is refreshed lazily on the first request that needs it.
    if (cached.refreshToken) {
      setTokens({ accessToken: '', refreshToken: cached.refreshToken });
    }

    set({
      user: cached.user,
      permissions: toPermissions(cached.user),
      locked: false,
      lockedEmail: null,
      // Only genuinely an offline session if there is no way to reach the
      // server; with a refresh token and a connection, the next request
      // revalidates against it.
      offlineSession: !navigator.onLine || !cached.refreshToken,
      offlineGraceRemaining: remaining,
    });

    return { kind: 'signed-in' };
  },

  async signOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Signing out locally must work with no signal.
    }
    setTokens(null);
    lock();
    // The cached session and the wrapped key are deliberately kept: signing out
    // is not the same as forgetting the device, and the next sign-in should be
    // a password rather than a full enrolment.
    set({ user: null, permissions: new Set(), locked: false, lockedEmail: null, offlineSession: false });
  },

  can(permission) {
    return get().permissions.has(permission);
  },
}));

async function completeSignIn(
  response: Record<string, unknown>,
  password: string | null,
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  const user = response['user'] as AuthenticatedUser;

  setTokens({
    accessToken: response['accessToken'] as string,
    refreshToken: response['refreshToken'] as string,
  });

  // Roles barred from offline mode get no local key at all, so there is nothing
  // on the device to unwrap even if it is stolen.
  if (password && !user.offlineDisallowed) {
    if (!isUnlocked()) {
      const existing = await getWrappedKey();
      if (!existing || !(await unlockWithPassword(password, existing))) {
        // First sign-in on this device, or the password changed: a new data key
        // is generated, which necessarily orphans anything encrypted under the
        // old one. Unsynced work is drained before this point in normal use.
        await storeWrappedKey(await createWrappedDataKey(password));
      }
    }

    await setMeta('session', {
      user,
      cachedAt: new Date().toISOString(),
      failedOfflineAttempts: 0,
      refreshToken: response['refreshToken'] as string,
    } satisfies CachedSession);
  }

  set({
    user,
    permissions: toPermissions(user),
    locked: false,
    lockedEmail: null,
    offlineSession: false,
    offlineGraceRemaining: user.offlineDisallowed ? null : OFFLINE_GRACE_DAYS,
  });
}

function graceRemaining(cachedAt: string): number {
  const elapsedDays = (Date.now() - new Date(cachedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(OFFLINE_GRACE_DAYS - elapsedDays));
}

function isOffline(error: unknown): boolean {
  return error instanceof Error && error.name === 'OfflineError';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Sign-in failed.';
}

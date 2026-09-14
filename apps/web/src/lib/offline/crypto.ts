/**
 * Local encryption for the offline store (doc 09 §2).
 *
 * A field device gets stolen. IndexedDB is not encrypted at rest by the
 * browser, so anything identifying is encrypted before it is written.
 *
 * The key hierarchy:
 *
 *   password --PBKDF2--> key-encryption key (KEK)
 *                          |
 *                          +-- unwraps --> data-encryption key (DEK)
 *                                            |
 *                                            +-- AES-GCM --> stored records
 *
 * The DEK is generated once per device and stored only in wrapped form. The
 * unwrapped DEK lives in a JavaScript variable and nowhere else: locking the
 * app, closing the tab, or an idle timeout discards it and the local database
 * becomes ciphertext again.
 *
 * What is NOT encrypted, deliberately: sync status, timestamps, entity types
 * and counts. That is enough to render "14 records pending" on a locked screen
 * without revealing anything about whom.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Held in memory only. Never persisted, never logged. */
let dataKey: CryptoKey | null = null;

export class LocalCryptoLockedError extends Error {
  constructor() {
    super('The local store is locked. Sign in to unlock it.');
    this.name = 'LocalCryptoLockedError';
  }
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Web Crypto is unavailable. The app requires a secure context (https, or localhost) to protect data on this device.',
    );
  }
  return globalThis.crypto.subtle;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKeyEncryptionKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export interface WrappedKey {
  salt: Uint8Array;
  iv: Uint8Array;
  wrapped: ArrayBuffer;
}

/** Generate a device data key and wrap it with a key derived from the password. */
export async function createWrappedDataKey(password: string): Promise<WrappedKey> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await deriveKeyEncryptionKey(password, salt);

  const dek = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  const wrapped = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: iv as BufferSource });
  dataKey = dek;

  return { salt, iv, wrapped };
}

/**
 * Unlock the store with a password.
 *
 * Returns false on a wrong password rather than throwing, because "wrong
 * password" is a normal outcome of offline sign-in, not an exceptional one.
 * It reveals nothing beyond success or failure.
 */
export async function unlockWithPassword(password: string, key: WrappedKey): Promise<boolean> {
  try {
    const kek = await deriveKeyEncryptionKey(password, key.salt);
    dataKey = await subtle().unwrapKey(
      'raw',
      key.wrapped,
      kek,
      { name: 'AES-GCM', iv: key.iv as BufferSource },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    return true;
  } catch {
    // AES-GCM authentication failed: the password is wrong. Nothing else is
    // distinguishable, which is the point.
    dataKey = null;
    return false;
  }
}

export function isUnlocked(): boolean {
  return dataKey !== null;
}

/** Discard the in-memory key. The local database becomes unreadable. */
export function lock(): void {
  dataKey = null;
}

export interface Sealed {
  iv: Uint8Array;
  data: ArrayBuffer;
}

export async function seal(value: unknown): Promise<Sealed> {
  if (!dataKey) throw new LocalCryptoLockedError();

  const iv = randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, dataKey, plaintext);

  return { iv, data };
}

export async function open<T>(sealed: Sealed): Promise<T> {
  if (!dataKey) throw new LocalCryptoLockedError();

  const plaintext = await subtle().decrypt(
    { name: 'AES-GCM', iv: sealed.iv as BufferSource },
    dataKey,
    sealed.data,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** SHA-256 of a blob, for duplicate detection and upload integrity. */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await subtle().digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

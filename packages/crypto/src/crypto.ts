/**
 * Encryption library — Phase 1 stub.
 *
 * Public API surface (runs client-side)
 *
 * Key design:
 *   masterPassword + salt --Argon2id--> masterKey (32 bytes)
 *     --HKDF("auth")-->    authKey        (sent to server on login)
 *     --HKDF("enc")-->     encryptionKey  (never leaves the client)
 */

import { argon2id } from "hash-wasm";

import { COMMON_PASSWORDS } from "./common-passwords.js";

/**
 * The secret fields of a vault entry — the input to encryptVaultItem and
 * the output of decryptVaultItem. Exists only in memory on the client;
 * never sent to or stored on the server in this form.
 *
 * Owned by this package (not a BE/FE DTO): callers map their own view
 * models to/from this shape.
 */
export interface VaultItemSecret {
  siteName: string;
  siteUrl?: string;
  username: string;
  password: string;
  notes?: string;
}

/** Current KdfParams version. Bump when the KDF scheme changes; keep any stored params in sync. */
export const KDF_PARAMS_VERSION = 1;

/** Argon2id parameters */
export interface KdfParams {
  version: typeof KDF_PARAMS_VERSION; // Manage the version of the KDF parameters.
  algorithm: "argon2id";
  memoryKiB: number; // Memory cost in KiB (e.g. 65536 = 64 MiB).
  iterations: number; // Time cost (number of passes).
  parallelism: number;
}
export const DEFAULT_KDF_PARAMS: KdfParams = {
  version: KDF_PARAMS_VERSION,
  algorithm: "argon2id",
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
};

/** Decoded binary form of an encrypted payload. */
export interface EncryptedPayload {
  version: number; // Payload format version
  nonce: Uint8Array<ArrayBuffer>; // AES-GCM nonce, 12 bytes, unique per encryption.
  ciphertext: Uint8Array<ArrayBuffer>; // Ciphertext including the GCM auth tag (as produced by Web Crypto).
}

export const PAYLOAD_VERSION = 1;
export const NONCE_LENGTH = 12;
/** GCM appends a 16-byte auth tag, so no valid ciphertext is shorter than this. */
const MIN_CIPHERTEXT_LENGTH = 16;
/** Minimum salt length. generateSalt() produces 16 bytes; shorter salts are rejected. */
const MIN_SALT_LENGTH = 16;

// ---- binary <-> string helpers ----

/** Encodes bytes as base64 (for salts, auth keys, and payloads sent as JSON strings). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decodes a base64 string back into bytes. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---- key derivation ----

/**
 * Sanity bounds for KdfParams.
 * A corrupted record must be rejected before it reaches the Argon2 WASM
 * (a huge memoryKiB would otherwise hang).
 */
const KDF_LIMITS = {
  memoryKiB: { min: 8, max: 1 << 20 }, // 8 KiB .. 1 GiB
  iterations: { min: 1, max: 64 },
  parallelism: { min: 1, max: 16 },
} as const;

/**
 * HKDF context labels. 
 * Frozen forever: changing a label changes every derived key and would lock all users out of their vaults.
 */
const HKDF_INFO_AUTH = "auth";
const HKDF_INFO_ENC = "enc";

/** Checks that a KdfParams field is an integer in the given range. */
function requireIntInRange(
  name: string,
  value: number,
  range: { min: number; max: number },
): void {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(
      `KdfParams.${name} must be an integer in [${range.min}, ${range.max}], got ${value}`,
    );
  }
}

/** Argon2id: master password + salt -> master key, wrapped for HKDF use. */
async function deriveMasterKey(
  masterPassword: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<CryptoKey> {
  // Validate the KdfParams before passing them to Argon2id.
  if ((params.version as number) !== KDF_PARAMS_VERSION) {
    throw new Error(`Unsupported KDF params version: ${params.version}`);
  }
  requireIntInRange("memoryKiB", params.memoryKiB, KDF_LIMITS.memoryKiB);
  requireIntInRange("iterations", params.iterations, KDF_LIMITS.iterations);
  requireIntInRange("parallelism", params.parallelism, KDF_LIMITS.parallelism);
  // Argon2 also requires memoryKiB >= 8 * parallelism
  if (params.memoryKiB < 8 * params.parallelism) {
    throw new Error(
      `KdfParams.memoryKiB must be at least 8 * parallelism (${8 * params.parallelism}), got ${params.memoryKiB}`,
    );
  }
  if (salt.length < MIN_SALT_LENGTH) {
    throw new Error(`salt must be at least ${MIN_SALT_LENGTH} bytes, got ${salt.length}`);
  }
  const masterKeyBytes = await argon2id({
    password: masterPassword,
    salt,
    hashLength: 32,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    outputType: "binary",
  });
  // Non-extractable: the master key never needs to leave this module.
  return crypto.subtle.importKey("raw", masterKeyBytes as Uint8Array<ArrayBuffer>, "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

function hkdfParams(info: string): HkdfParams {
  return {
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0), // the input key is already high-entropy so no extra salt is needed (per-user separation comes from the Argon2 salt)
    info: new TextEncoder().encode(info),
  };
}

async function hkdfAuthKey(masterKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const bits = await crypto.subtle.deriveBits(hkdfParams(HKDF_INFO_AUTH), masterKey, 256);
  return new Uint8Array(bits);
}

function hkdfEncryptionKey(masterKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    hkdfParams(HKDF_INFO_ENC),
    masterKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

/** Both client-side keys, derived together. */
export interface DerivedKeys {
  /** Login credential — serialize with bytesToBase64() for the request body. */
  authKey: Uint8Array<ArrayBuffer>;
  /** Vault encryption key — non-extractable, never leaves the client. */
  encryptionKey: CryptoKey;
}

/**
 * Derives both keys with a SINGLE Argon2id run (at login/registration).
 * Calling deriveAuthKey and deriveEncryptionKey separately runs the expensive memory-hard KDF twice for no benefit.
 */
export async function deriveKeys(
  masterPassword: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<DerivedKeys> {
  const masterKey = await deriveMasterKey(masterPassword, salt, params);
  const [authKey, encryptionKey] = await Promise.all([
    hkdfAuthKey(masterKey),
    hkdfEncryptionKey(masterKey),
  ]);
  return { authKey, encryptionKey };
}

/**
 * Derives the key sent to the server as the login credential.
 * The server treats it as an opaque password and hashes it again.
 * Use bytesToBase64() to serialize it for the register/login request body.
 * If you also need the encryption key, call deriveKeys() instead.
 */
export async function deriveAuthKey(
  masterPassword: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array<ArrayBuffer>> {
  const masterKey = await deriveMasterKey(masterPassword, salt, params);
  return hkdfAuthKey(masterKey);
}

/**
 * Derives the vault encryption key.
 * Returned as a non-extractable CryptoKey so it cannot be serialized or accidentally sent anywhere.
 * If you also need the auth key, call deriveKeys() instead.
 */
export async function deriveEncryptionKey(
  masterPassword: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<CryptoKey> {
  const masterKey = await deriveMasterKey(masterPassword, salt, params);
  return hkdfEncryptionKey(masterKey);
}

/** Generates a fresh random per-user salt (registration time). */
export function generateSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16));
}


/** Generates a fresh AES-GCM nonce. Must be unique per encryption. */
export function generateNonce(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

/** Encrypts the secret fields of a vault item into an encoded payload string. */
export async function encryptVaultItem(
  item: VaultItemSecret,
  key: CryptoKey,
): Promise<string> {
  const nonce = generateNonce();
  const plaintext = new TextEncoder().encode(JSON.stringify(item));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  return encodeEncryptedPayload({ version: PAYLOAD_VERSION, nonce, ciphertext });
}

/** Decrypts an encoded payload string back into the secret fields. */
export async function decryptVaultItem(
  payload: string,
  key: CryptoKey,
): Promise<VaultItemSecret> {
  const { nonce, ciphertext } = decodeEncryptedPayload(payload);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  } catch {
    throw new Error("Decryption failed: wrong key or corrupted payload");
  }
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as VaultItemSecret;
  } catch {
    throw new Error("Decryption failed: decrypted data is not a valid vault item");
  }
}

/** Encodes version || nonce || ciphertext as base64 for storage/transport. */
export function encodeEncryptedPayload(payload: EncryptedPayload): string {
  // Mirror decodeEncryptedPayload's checks so encode can never produce a
  // string that decode rejects (and version can't silently truncate to a byte).
  if (payload.version !== PAYLOAD_VERSION) {
    throw new Error(`Unsupported payload version: ${payload.version}`);
  }
  if (payload.nonce.length !== NONCE_LENGTH) {
    throw new Error(`nonce must be ${NONCE_LENGTH} bytes, got ${payload.nonce.length}`);
  }
  if (payload.ciphertext.length < MIN_CIPHERTEXT_LENGTH) {
    throw new Error(
      `ciphertext must be at least ${MIN_CIPHERTEXT_LENGTH} bytes (GCM tag included), got ${payload.ciphertext.length}`,
    );
  }
  const bytes = new Uint8Array(1 + NONCE_LENGTH + payload.ciphertext.length);
  bytes[0] = payload.version;
  bytes.set(payload.nonce, 1);
  bytes.set(payload.ciphertext, 1 + NONCE_LENGTH);
  return bytesToBase64(bytes);
}

/** Decodes a base64 payload string back into its binary parts. */
export function decodeEncryptedPayload(encoded: string): EncryptedPayload {
  // Check the length and format of the base64 string to be a strict inverse of encodeEncryptedPayload
  // as atob is lenient (strips whitespace, tolerates missing padding)
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Payload is not valid base64");
  }
  const bytes = base64ToBytes(encoded);
  if (bytes.length < 1 + NONCE_LENGTH + MIN_CIPHERTEXT_LENGTH) {
    throw new Error("Payload is too short to be valid");
  }
  const version = bytes[0]!;
  if (version !== PAYLOAD_VERSION) {
    throw new Error(`Unsupported payload version: ${version}`);
  }
  return {
    version,
    nonce: bytes.slice(1, 1 + NONCE_LENGTH),
    ciphertext: bytes.slice(1 + NONCE_LENGTH),
  };
}

// ---- Phase 3: password quality helpers ----

export interface PasswordGenerationOptions {
  length: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeDigits: boolean;
  includeSymbols: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordGenerationOptions = {
  length: 20,
  includeUppercase: true,
  includeLowercase: true,
  includeDigits: true,
  includeSymbols: true,
};

const LOWERCASE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGIT_CHARS = "0123456789";
const SYMBOL_CHARS = "!@#$%^&*()-_=+[]{}";

/**
 * A uniformly random integer in [0, max) from the CSPRNG.
 * Rejection sampling avoids modulo bias, so no value is favored and the output is harder to guess.
 */
function randomIntBelow(max: number): number {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`max must be a positive integer, got ${max}`);
  }
  const limit = Math.floor(0x1_0000_0000 / max) * max; // largest multiple of max within a uint32
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0]!;
  } while (value >= limit);
  return value % max;
}

/** Picks one character from a set, uniformly and CSPRNG-backed. */
function randomChar(chars: string): string {
  return chars[randomIntBelow(chars.length)]!;
}

/**
 * Generates a random password from the selected character classes (CSPRNG-backed).
 * Guarantees at least one character from every enabled class, then fills the rest from the combined pool and shuffles.
 */
export function generateSuggestedPassword(
  options: PasswordGenerationOptions = DEFAULT_PASSWORD_OPTIONS,
): string {
  if (!Number.isInteger(options.length) || options.length < 1) {
    throw new Error(`length must be a positive integer, got ${options.length}`);
  }

  const selectedClasses: string[] = [];
  if (options.includeLowercase) selectedClasses.push(LOWERCASE_CHARS);
  if (options.includeUppercase) selectedClasses.push(UPPERCASE_CHARS);
  if (options.includeDigits) selectedClasses.push(DIGIT_CHARS);
  if (options.includeSymbols) selectedClasses.push(SYMBOL_CHARS);

  if (selectedClasses.length === 0) {
    throw new Error("At least one character class must be enabled");
  }
  if (options.length < selectedClasses.length) {
    throw new Error(
      `length must be at least ${selectedClasses.length} to fit one of each selected class`,
    );
  }

  const pool = selectedClasses.join("");
  const chars: string[] = selectedClasses.map(randomChar); // one guaranteed char per class
  // fill the rest of the password from the combined pool
  while (chars.length < options.length) {
    chars.push(randomChar(pool));
  }

  // Fisher-Yates shuffle so the guaranteed characters aren't stuck at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIntBelow(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Return True if the password appears in the bundled common-password list. */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Return True if the password matches one already stored in the vault.
 * Takes decrypted items because comparison happens client-side only. 
 * Case-sensitive: "Hunter2" and "hunter2" are genuinely different passwords, not a reuse.
 */
export function isReusedPassword(
  password: string,
  decryptedItems: readonly VaultItemSecret[],
): boolean {
  return decryptedItems.some((item) => item.password === password);
}

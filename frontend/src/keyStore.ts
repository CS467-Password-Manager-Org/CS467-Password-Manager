// Persists the vault encryption key across page reloads.
//
// The key is a non-extractable CryptoKey, so its raw bytes can never be read by
// JavaScript — `crypto.subtle.exportKey` on it rejects. It is still structured
// cloneable, which means IndexedDB can store and return the key handle itself
// without the key material ever being exposed. That is what makes this safe in a
// way that stashing raw bytes in sessionStorage would not be: the zero-knowledge
// property in packages/crypto is preserved.
//
// Lifetime is deliberately tied to the session rather than kept indefinitely.
// clearEncryptionKey() is called whenever the session is no longer valid, so an
// expired token (15 minutes by default) also disposes of the key.
//
// Every function degrades to a no-op if IndexedDB is unavailable — private
// browsing modes and hardened configurations can block it. In that case the app
// behaves exactly as it did before this module existed: the key lives only in
// memory and a reload requires signing in again.

const DB_NAME = 'password-manager';
const DB_VERSION = 1;
const STORE_NAME = 'crypto-keys';
const KEY_ID = 'vault-encryption-key';

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Another tab holding an old version open would block the upgrade forever.
    request.onblocked = () => resolve(null);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    openDatabase().then((db) => {
      if (!db) {
        resolve(null);
        return;
      }

      try {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
        transaction.oncomplete = () => db.close();
      } catch {
        db.close();
        resolve(null);
      }
    });
  });
}

/** Store the vault encryption key so it survives a page reload. */
export async function saveEncryptionKey(key: CryptoKey): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(key, KEY_ID));
}

/** Return the stored vault encryption key, or null if there isn't a usable one. */
export async function loadEncryptionKey(): Promise<CryptoKey | null> {
  const stored = await runTransaction<unknown>('readonly', (store) => store.get(KEY_ID));

  // Guard the shape rather than trusting whatever came back: a stale record from
  // an older format, or a value tampered with in devtools, must not be handed to
  // crypto.subtle as if it were a key.
  if (stored && typeof stored === 'object' && 'algorithm' in stored && 'usages' in stored) {
    return stored as CryptoKey;
  }
  return null;
}

/** Remove the stored key. Called whenever the session is no longer valid. */
export async function clearEncryptionKey(): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(KEY_ID));
}

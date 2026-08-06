# Client-Side Crypto Threat Model

What the browser does before anything reaches the server: how the master password becomes two independent keys, how a vault item becomes ciphertext, and what happens to those keys between page loads. This is the counterpart to [`threat-model.md`](./threat-model.md), which states the central claim — the server cannot read a stored password — and defers the client half of that guarantee to this document.

Scope is `packages/crypto` (key derivation, encryption, payload encoding) and `frontend/src/keyStore.ts` (key persistence across reloads).

## The central claim, from the client's side

**Nothing that can open a vault is ever computed to be sent anywhere.**

`deriveKeys()` in [`packages/crypto/src/crypto.ts`](../packages/crypto/src/crypto.ts) turns a master password and salt into two keys with one Argon2id run, then immediately narrows what each one can do:

- `authKey` — plain bytes, because the server needs to hash them. This is the only key-derived material that ever leaves the browser, and it authenticates; it does not decrypt.
- `encryptionKey` — imported as a **non-extractable** `CryptoKey`. Calling `crypto.subtle.exportKey` on it throws an error. There is no code path, buggy or otherwise, that can turn it back into bytes and hand it to `fetch`.

The two are derived with [HKDF](https://www.rfc-editor.org/rfc/rfc5869) under different `info` labels (`"auth"`, `"enc"`) from the same Argon2id output, so a server that sees `authKey` cannot compute `encryptionKey` from it — HKDF's domain separation makes that a different, non-invertible derivation, not a transformation of the same secret.

## Assets

| Asset | Form | Leaves the client? |
|---|---|---|
| **Master password** | UTF-8 string, briefly in memory during derivation | Never |
| **Master key** | Raw Argon2id output, immediately wrapped as a non-extractable `CryptoKey` for HKDF | Never |
| **Encryption key** | Non-extractable AES-256-GCM `CryptoKey` | Never — not even in principle, `exportKey` rejects |
| **Auth key** | 32 raw bytes | Yes, by design — base64-encoded and sent on register/login. The server treats it as an opaque password and hashes it again |
| **Salt** | 16 bytes, `generateSalt()` | Yes — stored server-side, needed before login to re-derive the keys |
| **Vault plaintext** | `VaultItemSecret` (site, username, password, notes) | Never — only `encryptVaultItem()`'s output leaves |
| **Vault ciphertext** | Versioned, base64-encoded `version‖nonce‖ciphertext` | Yes |

## Threats and mitigations

### Nonce reuse under AES-GCM

**Threat.** AES-GCM's confidentiality and integrity both collapse if the same (key, nonce) pair encrypts two different messages — an attacker who observes both ciphertexts can recover the XOR of the plaintexts and forge an authenticated message. Because `encryptionKey` is long-lived (one per vault, not rotated per item), every encryption under it shares a key, so the nonce is the only thing standing between "safe" and "broken."

**Mitigation.** `generateNonce()` draws 12 fresh bytes from `crypto.getRandomValues()` for every call to `encryptVaultItem()` — there is no counter, no reuse across items, and no path that lets a caller supply their own nonce. At random 96-bit nonces, the collision probability stays negligible for any realistic number of items a single vault would ever hold; encoded ciphertexts are also checked at every re-encrypt boundary (`generateNonce()` is called fresh even when only one field of an item changes, since `encryptVaultItem()` re-encrypts the whole record rather than patching a nonce in place).

### Ciphertext or payload tampering

**Threat.** Encrypted vault items sit in a database the server can write to and pass through a network path. An attacker who can substitute bytes wants to flip a bit in a password field, or splice a ciphertext from one item onto another's nonce, without detection.

**Mitigation.** AES-GCM's authentication tag covers the whole ciphertext, appended by Web Crypto and verified inside `crypto.subtle.decrypt`. `decryptVaultItem()` in [`crypto.ts`](../packages/crypto/src/crypto.ts) does not distinguish a wrong key from a tampered payload at the crypto layer — both throw from `subtle.decrypt` — and it re-wraps that failure as `"Decryption failed: wrong key or corrupted payload"` rather than exposing whatever the browser's crypto implementation says, so a caller cannot use error content to probe which byte was wrong. A payload that decrypts but isn't valid JSON, or doesn't parse into a `VaultItemSecret`, is rejected separately with `"decrypted data is not a valid vault item"` — confirmed by `item-encryption.test.ts`'s tampered-payload and wrong-key cases.

### Payload and KDF parameter downgrade

**Threat.** A stored payload or a stored `KdfParams` record is from a future or foreign format the current code does not actually implement correctly — for instance a `nonce` of the wrong length, or a `memoryKiB` an old client would silently clamp, weakening the derivation without anyone choosing that.

**Mitigation.** Both formats carry an explicit version and every reader checks it before touching the value. `decodeEncryptedPayload()` rejects any `version` byte other than `PAYLOAD_VERSION`; `deriveMasterKey()` rejects any `KdfParams.version` other than `KDF_PARAMS_VERSION`. Beyond the version check, `KdfParams` fields are bounds-checked against `KDF_LIMITS` (`requireIntInRange`) **before** they reach the Argon2 WASM binding — a corrupted or attacker-supplied `memoryKiB` in the gigabytes is rejected outright rather than allowed to hang or exhaust the tab's memory, per `key-derivation.test.ts`'s out-of-range and pre-WASM rejection cases. `encodeEncryptedPayload()` runs the same checks as decode, so this module can never write a payload its own reader would refuse.

### Malformed base64 reaching the decoder

**Threat.** `atob()` is lenient — it tolerates stray whitespace and missing padding — so a naive decode could accept two different byte strings as "the same" payload, or silently truncate one that a stricter reader would reject.

**Mitigation.** `decodeEncryptedPayload()` validates the encoded string against a strict base64 pattern (length a multiple of 4, alphabet-and-padding regex) before calling `atob()`, so inputs `atob` would accept leniently are rejected instead — covered directly in `crypto.test.ts`.

### Weak or reused master passwords

**Threat.** Every other control in this document assumes the master password itself is hard to guess. A short or common one makes offline Argon2id cracking or credential-stuffing viable regardless of how the derivation or encryption is implemented.

**Mitigation.** This is deliberately not solved inside `crypto.ts` — Argon2id's cost parameters (`DEFAULT_KDF_PARAMS`: 64 MiB, 3 iterations) raise the cost per guess but cannot make a weak password strong. The package instead gives the frontend the tools to steer the user away from one before it is ever derived: `evaluatePasswordStrength()` (zxcvbn, with the user's own email tokenized into the dictionary so a password built from it scores accordingly), `isCommonPassword()` against a bundled list, and `isReusedPassword()` so the same password isn't reused across vault entries. Whether the UI treats a weak score as a blocker or a suggestion is a frontend product decision, not a guarantee this package makes.

### Key exposure through persistence across reloads

**Threat.** Without persistence, every page reload would force a re-login; the obvious fix — cache the derived key somewhere durable — is also the obvious way to leak it if done wrong. Raw key bytes in `localStorage` or `sessionStorage` are plain, readable strings: any script that can run on the page (an XSS payload, a malicious extension) can read them out directly.

**Mitigation.** [`frontend/src/keyStore.ts`](../frontend/src/keyStore.ts) stores the `CryptoKey` **handle** in IndexedDB, not its bytes. `CryptoKey` is structured-cloneable, so IndexedDB can hold and return the object itself, but the key stays non-extractable throughout — code that loads it back can call `crypto.subtle.decrypt` with it and nothing else, exactly as before the reload. `loadEncryptionKey()` additionally guards the shape of whatever comes back (`algorithm` and `usages` present) before treating it as a key, so a stale or devtools-tampered IndexedDB record cannot be handed to `crypto.subtle` as if it were valid. Lifetime is tied to the session rather than kept indefinitely: `clearEncryptionKey()` runs whenever the session is no longer valid, so the 15-minute access-token expiry also bounds how long the key persists. If IndexedDB is unavailable (private browsing, a hardened browser config), every function degrades to a no-op and the app falls back to requiring sign-in on every reload — never to a weaker storage location.

## Non-goals

**Cross-site scripting.** If an attacker's script executes in the page, it can call `crypto.subtle.encrypt`/`decrypt` through the same non-extractable key handle the app uses, and read whatever vault items the app decrypts into memory during that session. Non-extractability stops key *theft* — the attacker cannot take the key material anywhere else — but it does not stop *misuse* while the script runs alongside legitimate code. Preventing script injection in the first place (output encoding, CSP) is a frontend-rendering concern, not a `packages/crypto` one.

**Decrypted plaintext in memory.** Once `decryptVaultItem()` returns a `VaultItemSecret`, its fields are ordinary JS strings, subject to normal garbage collection on the engine's own schedule. JavaScript has no supported way to zero memory on demand, so this package makes no claim about how long plaintext lingers in the heap after the last reference is dropped.

**Malicious or compromised browser extensions.** An extension with page access can read anything the DOM or JS runtime can, which includes decrypted vault contents displayed on screen and any in-memory plaintext, by the same reasoning as the XSS case above.

**Quantum resistance.** Argon2id and AES-256-GCM are both classical-secure constructions with no post-quantum hardening. Out of scope for this project's threat model, as it is for essentially every deployed system today.

**Multi-device key sync.** There is no mechanism here for sharing the encryption key across a user's devices beyond re-deriving it from the master password and the server-stored salt at each login. That re-derivation path is the entire mechanism, by design — there is nothing else to synchronize.

## Verification

`packages/crypto/src/__tests__/` exercises every control above against the real `hash-wasm` Argon2id binding and the browser's native Web Crypto (via `happy-dom`/Vitest), not a mock:

| Suite | Covers |
|---|---|
| `key-derivation.test.ts` | Deterministic and independent auth/encryption keys, single Argon2id invocation for both, `KdfParams` version and bounds rejection ahead of the WASM call |
| `item-encryption.test.ts` | Round-trip correctness including Unicode, a fresh nonce every call, tampered-payload and wrong-key rejection, end-to-end from a master password |
| `crypto.test.ts` | Base64 round-tripping and strict validation, payload version/length/nonce-size rejection, encode/decode symmetry |
| `password-quality.test.ts` | Strength scoring, common-password detection, reuse detection, CSPRNG-backed password generation |

Run them with `npm test --workspace=packages/crypto`.

## Related documentation

| Document | What it covers |
|---|---|
| [`threat-model.md`](./threat-model.md) | Server and database security — the half of the zero-knowledge claim this document assumes holds |
| [`api.md`](./api.md) | Endpoint contract and the shape `encryptedData` takes once it reaches the API |

// Argon2id key derivation via hash-wasm.
//
// Why Argon2id over PBKDF2:
//   - PBKDF2 with SHA-256 is cheap on GPUs; an attacker with a single
//     consumer GPU can try ~10^7 PBKDF2 600k attempts per second on a
//     stolen blob. Argon2id is memory-hard — the same attacker is
//     limited to ~10^3 attempts/sec.
//   - Argon2id won the Password Hashing Competition (2015) and is
//     OWASP's current recommendation.
//
// Parameters chosen for browser feasibility (target ~500ms on a 2024
// laptop, ~2s on a 2020 mid-range phone):
//   - memory:        64 MiB
//   - iterations:    3
//   - parallelism:   1  (single-threaded for Safari / iOS reliability)
//
// All parameters are stored alongside the envelope so future tuning
// doesn't break existing vaults.

import { argon2id } from "hash-wasm";

export const ARGON2ID_NAME = "argon2id";

export const ARGON2ID_DEFAULT_PARAMS = Object.freeze({
  memoryKiB: 64 * 1024, // 64 MiB
  iterations: 3,
  parallelism: 1,
  outputLength: 32      // 256-bit key
});

/**
 * Derive a wrapping key from a secret + salt using Argon2id.
 * Returns a non-extractable AES-GCM CryptoKey suitable for wrapping the vault key.
 *
 * @param {string} secret              user passphrase or recovery key
 * @param {Uint8Array} salt            salt bytes (>= 16)
 * @param {object} [params]            override defaults; will be persisted
 * @returns {Promise<CryptoKey>}
 */
export async function deriveArgon2idKey(secret, salt, params = ARGON2ID_DEFAULT_PARAMS) {
  if (!secret) throw new Error("Argon2id: secret is required.");
  if (!(salt instanceof Uint8Array) || salt.length < 16) {
    throw new Error("Argon2id: salt must be a Uint8Array of at least 16 bytes.");
  }

  const merged = { ...ARGON2ID_DEFAULT_PARAMS, ...params };
  const rawKeyHex = await argon2id({
    password: secret,
    salt,
    parallelism: merged.parallelism,
    iterations: merged.iterations,
    memorySize: merged.memoryKiB,
    hashLength: merged.outputLength,
    outputType: "hex"
  });
  const rawKey = hexToBytes(rawKeyHex);
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error("argon2id: hex output has odd length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Lyfos release share crypto.
//
// Build blocks:
//   - Shamir Secret Sharing: secrets.js-grempe (battle-tested, audited
//     implementation of Adi Shamir's 1979 paper)
//   - X25519 + ChaCha20-Poly1305 NaCl box: libsodium-wrappers
//   - Argon2id → HKDF → keypair derivation: hash-wasm + WebCrypto HKDF
//
// What this module exposes (every function is a pure async wrapper —
// no React, no Supabase. UI calls these and pushes the results via
// vaultSync helpers):
//
//   deriveHolderKeypairFromPassphrase(passphrase, userId)
//     → { publicKey, secretKey } as base64 strings.
//     The holder generates this once at invite acceptance, uploads
//     publicKey to key_holders.release_pubkey, and re-derives secretKey
//     on demand by typing the same passphrase.
//
//   splitVaultKey(rawVaultKey32) → 5 Uint8Array shares (3-of-5 threshold)
//   combineShares(shares[]) → Uint8Array rawVaultKey (throws on < 3)
//
//   sealShareToPubkey(share, recipientPubkey)
//     → { ciphertext, ephemeralPub } base64. Anonymous NaCl box —
//     sender unauthenticated (we're encrypting to a known recipient
//     but holders re-encrypting to a nominee don't need sender auth).
//
//   openSealedShare({ciphertext, ephemeralPub}, recipientSecretKey)
//     → Uint8Array share. Throws on tamper.
//
//   makeReleaseProcessKeypair() → { publicKey, secretKey } base64
//     One-shot keypair the nominee generates for her release request.
//
// Concurrency: libsodium needs an explicit ready() before first use.
// readySodium() is idempotent and cached.

// Note: libsodium-wrappers and secrets.js-grempe are dynamic-imported
// inside each function below, NOT statically imported at the top. This
// keeps the ~150kb gzipped libsodium chunk off the critical path — it
// only loads when the user opens an invite or finalizes a release plan.

import { argon2id } from "hash-wasm";

const ARGON2_PARAMS = {
  memoryKiB: 64 * 1024, // 64 MiB — matches vault KDF
  iterations: 3,
  parallelism: 1,
  outputLength: 32
};

let sodiumPromise = null;
async function readySodium() {
  if (!sodiumPromise) {
    sodiumPromise = (async () => {
      const mod = await import("libsodium-wrappers");
      const sodium = mod.default ?? mod;
      await sodium.ready;
      return sodium;
    })();
  }
  return sodiumPromise;
}

let secretsPromise = null;
async function readySecrets() {
  if (!secretsPromise) {
    secretsPromise = import("secrets.js-grempe").then((mod) => mod.default ?? mod);
  }
  return secretsPromise;
}

// ============================================================
// Holder keypair: derived from account passphrase
// ============================================================

/**
 * Derive a stable Curve25519 keypair from a passphrase + per-user salt.
 * Same passphrase + same userId always produces the same keypair, so
 * the holder doesn't need to store the private key — she re-derives it
 * by typing her passphrase whenever she releases.
 */
export async function deriveHolderKeypairFromPassphrase(passphrase, userId) {
  if (!passphrase) throw new Error("passphrase required");
  if (!userId) throw new Error("userId required");
  const sb = await readySodium();

  // Salt = "lyfos-release-key-v1" || userId. Stable, public, no secret
  // entropy — entropy comes from the passphrase. The salt prevents the
  // same passphrase being used elsewhere from producing the same key.
  const salt = encode(`lyfos-release-key-v1:${userId}`);
  // Argon2id with output length 32 = seed for sodium's
  // crypto_sign_seed_keypair OR crypto_kx_keypair. We want X25519 for
  // box(), so use crypto_box_seed_keypair via libsodium.
  const seedHex = await argon2id({
    password: passphrase,
    salt,
    parallelism: ARGON2_PARAMS.parallelism,
    iterations: ARGON2_PARAMS.iterations,
    memorySize: ARGON2_PARAMS.memoryKiB,
    hashLength: ARGON2_PARAMS.outputLength,
    outputType: "hex"
  });
  const seed = hexToBytes(seedHex);
  // libsodium has crypto_box_seed_keypair; check availability across versions
  const kp = sb.crypto_box_seed_keypair
    ? sb.crypto_box_seed_keypair(seed)
    : sb.crypto_box_keypair_from_seed
      ? sb.crypto_box_keypair_from_seed(seed)
      : null;
  if (!kp) {
    // Fallback: derive sign keypair from seed, convert to box keypair
    const signKp = sb.crypto_sign_seed_keypair(seed);
    const boxPub = sb.crypto_sign_ed25519_pk_to_curve25519(signKp.publicKey);
    const boxSec = sb.crypto_sign_ed25519_sk_to_curve25519(signKp.privateKey);
    return {
      publicKey: sb.to_base64(boxPub, sb.base64_variants.ORIGINAL),
      secretKey: sb.to_base64(boxSec, sb.base64_variants.ORIGINAL)
    };
  }
  return {
    publicKey: sb.to_base64(kp.publicKey, sb.base64_variants.ORIGINAL),
    secretKey: sb.to_base64(kp.privateKey, sb.base64_variants.ORIGINAL)
  };
}

/**
 * Fresh keypair for a release-process. Nominee generates this per
 * release request; secretKey never leaves her browser session memory.
 */
export async function makeReleaseProcessKeypair() {
  const sb = await readySodium();
  const kp = sb.crypto_box_keypair();
  return {
    publicKey: sb.to_base64(kp.publicKey, sb.base64_variants.ORIGINAL),
    secretKey: sb.to_base64(kp.privateKey, sb.base64_variants.ORIGINAL)
  };
}

// ============================================================
// Shamir Secret Sharing
// ============================================================

/**
 * Split a 32-byte raw AES key into 5 shares with a 3-of-5 threshold.
 * secrets.js works in hex; we encode/decode at the boundary. Async
 * because secrets.js is dynamic-imported on first use.
 *
 * @param {Uint8Array} rawKey  exactly 32 bytes
 * @returns {Promise<string[]>} 5 share strings (hex)
 */
export async function splitVaultKey(rawKey, { totalShares = 5, threshold = 3 } = {}) {
  if (!(rawKey instanceof Uint8Array)) throw new Error("rawKey must be Uint8Array");
  if (rawKey.length !== 32) throw new Error(`rawKey must be 32 bytes, got ${rawKey.length}`);
  const secrets = await readySecrets();
  const hex = bytesToHex(rawKey);
  return secrets.share(hex, totalShares, threshold);
}

/**
 * Combine 3+ shares back into the original raw key. Order doesn't
 * matter; extras are tolerated.
 *
 * @param {string[]} shareStrings  at least 3 share strings from splitVaultKey
 * @returns {Promise<Uint8Array>} 32-byte rawKey
 */
export async function combineShares(shareStrings) {
  if (!Array.isArray(shareStrings) || shareStrings.length < 3) {
    throw new Error(`need at least 3 shares to combine, got ${shareStrings?.length ?? 0}`);
  }
  const secrets = await readySecrets();
  const hex = secrets.combine(shareStrings);
  return hexToBytes(hex);
}

// ============================================================
// NaCl box: encrypt-to-a-public-key
// ============================================================

/**
 * Anonymous NaCl box: encrypt a payload so only the holder of
 * recipientPubkey can decrypt. We don't authenticate the sender at
 * the crypto layer — that's done at the application layer (RLS +
 * holder_release_share function checks).
 *
 * Returns { ciphertext, ephemeralPub } as base64 strings.
 */
export async function sealShareToPubkey(payloadBytes, recipientPubkeyB64) {
  const sb = await readySodium();
  const pk = sb.from_base64(recipientPubkeyB64, sb.base64_variants.ORIGINAL);

  // Fresh ephemeral keypair per encryption — perfect forward secrecy.
  const ephemeral = sb.crypto_box_keypair();
  const nonce = sb.randombytes_buf(sb.crypto_box_NONCEBYTES);
  const ciphertext = sb.crypto_box_easy(payloadBytes, nonce, pk, ephemeral.privateKey);

  // Bundle nonce + ciphertext: nonce(24) || ct
  const bundle = new Uint8Array(nonce.length + ciphertext.length);
  bundle.set(nonce, 0);
  bundle.set(ciphertext, nonce.length);

  return {
    ciphertext: sb.to_base64(bundle, sb.base64_variants.ORIGINAL),
    ephemeralPub: sb.to_base64(ephemeral.publicKey, sb.base64_variants.ORIGINAL)
  };
}

/**
 * Decrypt with the recipient's secret key + the ephemeralPub that
 * accompanied the ciphertext.
 */
export async function openSealedShare({ ciphertext, ephemeralPub }, recipientSecretKeyB64) {
  const sb = await readySodium();
  const bundle = sb.from_base64(ciphertext, sb.base64_variants.ORIGINAL);
  const senderPk = sb.from_base64(ephemeralPub, sb.base64_variants.ORIGINAL);
  const recipientSk = sb.from_base64(recipientSecretKeyB64, sb.base64_variants.ORIGINAL);

  const NONCE = sb.crypto_box_NONCEBYTES;
  if (bundle.length <= NONCE) throw new Error("sealed share too short");
  const nonce = bundle.subarray(0, NONCE);
  const ct = bundle.subarray(NONCE);

  return sb.crypto_box_open_easy(ct, nonce, senderPk, recipientSk);
}

// ============================================================
// helpers
// ============================================================

function encode(s) {
  return new TextEncoder().encode(s);
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const clean = hex.length % 2 ? "0" + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Convert SSS share strings ↔ bytes for NaCl box sealing.
export function shareStringToBytes(s) {
  return encode(s);
}
export function bytesToShareString(bytes) {
  return new TextDecoder().decode(bytes);
}

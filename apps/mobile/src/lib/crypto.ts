// Mobile crypto primitives — pure-JS so we don't need autolinked
// native modules. Slower than the WASM-backed web equivalents but
// functionally identical and easier to ship.
//
// Layer mapping:
//   web's hash-wasm Argon2id          → @noble/hashes argon2id
//   web's WebCrypto AES-GCM           → @noble/ciphers gcm
//   web's libsodium-wrappers NaCl box → tweetnacl box (curve25519+xsalsa20+poly1305)
//                                       NOTE: tweetnacl uses XSalsa20, not
//                                       ChaCha20. The web app uses libsodium's
//                                       crypto_box (X25519+XSalsa20+Poly1305 by
//                                       default), so this is wire-compatible.
//   web's @scure/bip39                → @scure/bip39 (same)
//   web's secrets.js-grempe           → secrets.js-grempe (same)
//
// All bytes go in / out as Uint8Array. Base64 helpers live at the bottom.

import { argon2idAsync } from "@noble/hashes/argon2";
import { gcm }        from "@noble/ciphers/aes";
import nacl           from "tweetnacl";
import { sha256 }     from "@noble/hashes/sha256";

export interface Argon2Params { m: number; t: number; p: number; dkLen: number; }

// Web-compatible parameters (hash-wasm on web uses the same). Used to read
// any envelope that doesn't carry its own params.
export const ARGON2_PARAMS: Argon2Params = {
  m: 64 * 1024,  // 64 MiB
  t: 3,          // iterations
  p: 1,          // parallelism
  dkLen: 32      // 256-bit output
};

// Lighter parameters for NEW mobile-created vaults. Pure-JS Argon2id at 64 MiB
// is impractical on Hermes (tens of seconds / OOM); 19 MiB + t=2 is an
// OWASP-recommended config that derives in a fraction of the time. The chosen
// params are written into each envelope's kdf.params, and both mobile and web
// read them back on unlock — so vaults stay fully cross-compatible.
export const ARGON2_PARAMS_MOBILE: Argon2Params = {
  m: 19456,      // 19 MiB
  t: 2,
  p: 1,
  dkLen: 32
};

// ============================================================
// AES-GCM (vault payload + envelope wrap)
// ============================================================
export async function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const aead = gcm(key, iv);
  const ct = aead.encrypt(plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(ct) };
}

export async function aesGcmDecrypt(key: Uint8Array, envelope: { iv: string; ciphertext: string }): Promise<Uint8Array> {
  const iv = fromBase64(envelope.iv);
  const ct = fromBase64(envelope.ciphertext);
  const aead = gcm(key, iv);
  return aead.decrypt(ct);
}

// ============================================================
// Argon2id (key derivation from passphrase)
// ============================================================
export async function deriveArgon2idKey(secret: string, salt: Uint8Array, params: Argon2Params = ARGON2_PARAMS): Promise<Uint8Array> {
  // Use the ASYNC variant with asyncTick so the derivation yields to the event
  // loop periodically instead of blocking the JS thread. On Hermes a synchronous
  // Argon2id freezes the entire UI (buttons unresponsive, spinner stuck) for the
  // whole computation; argon2idAsync keeps the app responsive and produces the
  // identical key. asyncTick = max ms of work between yields.
  return argon2idAsync(secret, salt, { ...params, asyncTick: 16 });
}

// ============================================================
// X25519 NaCl box — wire-compatible with libsodium crypto_box
// ============================================================
export interface KeyPair { publicKey: string; secretKey: string; }

export function makeBoxKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: toBase64(kp.publicKey), secretKey: toBase64(kp.secretKey) };
}

/**
 * Derive a stable Curve25519 keypair from passphrase + per-user salt.
 * Matches web's deriveHolderKeypairFromPassphrase exactly so a holder
 * who accepted her invite on web can release on mobile (and vice versa).
 */
export async function deriveHolderKeypairFromPassphrase(passphrase: string, userId: string): Promise<KeyPair> {
  const salt = utf8(`lyfos-release-key-v1:${userId}`);
  const seed = await deriveArgon2idKey(passphrase, salt);
  const kp = nacl.box.keyPair.fromSecretKey(seed);
  return { publicKey: toBase64(kp.publicKey), secretKey: toBase64(kp.secretKey) };
}

export function sealShareToPubkey(payload: Uint8Array, recipientPubkeyB64: string): { ciphertext: string; ephemeralPub: string } {
  const recipientPub = fromBase64(recipientPubkeyB64);
  const ephemeral = nacl.box.keyPair();
  const nonce = randomBytes(nacl.box.nonceLength);
  const ct = nacl.box(payload, nonce, recipientPub, ephemeral.secretKey);
  // bundle: nonce(24) || ct
  const bundle = new Uint8Array(nonce.length + ct.length);
  bundle.set(nonce, 0);
  bundle.set(ct, nonce.length);
  return { ciphertext: toBase64(bundle), ephemeralPub: toBase64(ephemeral.publicKey) };
}

export function openSealedShare(sealed: { ciphertext: string; ephemeralPub: string }, recipientSecretKeyB64: string): Uint8Array {
  const bundle = fromBase64(sealed.ciphertext);
  const senderPub = fromBase64(sealed.ephemeralPub);
  const recipientSec = fromBase64(recipientSecretKeyB64);
  const NONCE = nacl.box.nonceLength;
  if (bundle.length <= NONCE) throw new Error("sealed share too short");
  const nonce = bundle.subarray(0, NONCE);
  const ct = bundle.subarray(NONCE);
  const out = nacl.box.open(ct, nonce, senderPub, recipientSec);
  if (!out) throw new Error("decryption failed");
  return out;
}

export function makeReleaseProcessKeypair(): KeyPair { return makeBoxKeyPair(); }

// ============================================================
// Utilities
// ============================================================
export function randomBytes(n: number): Uint8Array {
  // expo-crypto's getRandomBytes is sync via the polyfill we install at
  // app entry (react-native-get-random-values). globalThis.crypto.getRandomValues
  // works after that.
  const out = new Uint8Array(n);
  const g = (globalThis as any).crypto;
  if (g?.getRandomValues) { g.getRandomValues(out); return out; }
  // Last resort — should never happen if entry polyfill loaded
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
export function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function toBase64(bytes: Uint8Array): string {
  // React Native has native btoa; fall back to a small encoder otherwise.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // @ts-ignore
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
}

export function fromBase64(s: string): Uint8Array {
  // @ts-ignore
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}

export function sha256Hex(bytes: Uint8Array): string {
  const out = sha256(bytes);
  return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Vault record helpers, mobile-side.
// Wire-compatible with the web app's `stage1Crypto.js` so the same
// record loads and unlocks on either surface.

import {
  aesGcmEncrypt, aesGcmDecrypt, deriveArgon2idKey,
  randomBytes, toBase64, fromBase64, utf8, fromUtf8,
  ARGON2_PARAMS, ARGON2_PARAMS_MOBILE, Argon2Params
} from "./crypto";
import { generateMnemonic, validateMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import secrets from "secrets.js-grempe";

export const ARGON2ID = "argon2id";
export const PBKDF2   = "PBKDF2-SHA256";

export interface VaultRecord {
  kind: "os-one-stage1-vault";
  version: number;
  createdAt: string;
  updatedAt: string;
  crypto: { vaultAlgorithm: string; keyWrap: string; note: string };
  plaintextNotice: any;
  keyEnvelopes: {
    passphrase: KeyEnvelope;
    recovery?: KeyEnvelope;
  };
  encryptedVault: { algorithm: string; iv: string; ciphertext: string };
}

export interface KeyEnvelope {
  type: "passphrase" | "recovery";
  kdf: {
    name: string;
    salt: string;             // base64
    params?: any;             // argon2id params
    iterations?: number;      // pbkdf2 iterations (legacy)
  };
  wrappedKey: { algorithm: string; iv: string; ciphertext: string };
}

export async function createVaultRecord(opts: { vault: any; passphrase: string; recoveryPhrase: string }): Promise<{ record: VaultRecord; vaultKey: Uint8Array }> {
  assertUsablePassphrase(opts.passphrase);
  const vaultKey = randomBytes(32);
  const passEnv = await wrapVaultKey(vaultKey, opts.passphrase, "passphrase");
  const recEnv  = await wrapVaultKey(vaultKey, normalizeRecoveryKey(opts.recoveryPhrase), "recovery");
  const enc = await aesGcmEncrypt(vaultKey, utf8(JSON.stringify(opts.vault)));
  const now = new Date().toISOString();
  return {
    record: {
      kind: "os-one-stage1-vault",
      version: 2,
      createdAt: now,
      updatedAt: now,
      crypto: { vaultAlgorithm: "AES-GCM", keyWrap: ARGON2ID, note: "Mobile-created vault." },
      plaintextNotice: {
        accountLoginDecryptsVault: false,
        releaseIsPreviewOnly: false,
        recoveryRequiresUserHeldKey: true
      },
      keyEnvelopes: { passphrase: passEnv, recovery: recEnv },
      encryptedVault: { algorithm: "AES-GCM", ...enc }
    },
    vaultKey
  };
}

export async function decryptWithPassphrase(record: VaultRecord, passphrase: string): Promise<{ vault: any; vaultKey: Uint8Array; usedEnvelope: "passphrase" }> {
  const key = await unwrapVaultKey(record.keyEnvelopes.passphrase, passphrase);
  const pt = await aesGcmDecrypt(key, record.encryptedVault);
  return { vault: JSON.parse(fromUtf8(pt)), vaultKey: key, usedEnvelope: "passphrase" };
}

export async function decryptWithRecoveryPhrase(record: VaultRecord, phrase: string): Promise<{ vault: any; vaultKey: Uint8Array; usedEnvelope: "recovery" }> {
  if (!record.keyEnvelopes.recovery) throw new Error("No recovery envelope on this vault.");
  const key = await unwrapVaultKey(record.keyEnvelopes.recovery, normalizeRecoveryKey(phrase));
  const pt = await aesGcmDecrypt(key, record.encryptedVault);
  return { vault: JSON.parse(fromUtf8(pt)), vaultKey: key, usedEnvelope: "recovery" };
}

export async function reencryptVaultPayload(record: VaultRecord, vaultKey: Uint8Array, vault: any): Promise<VaultRecord> {
  const enc = await aesGcmEncrypt(vaultKey, utf8(JSON.stringify(vault)));
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    encryptedVault: { algorithm: "AES-GCM", ...enc }
  };
}

// Envelope params travel in hash-wasm's shape (what web writes/reads);
// convert to/from @noble/hashes' shape.
interface EnvelopeKdfParams { memoryKiB: number; iterations: number; parallelism: number; outputLength: number; }
function toEnvelopeParams(p: Argon2Params): EnvelopeKdfParams {
  return { memoryKiB: p.m, iterations: p.t, parallelism: p.p, outputLength: p.dkLen };
}
function toNobleParams(p?: EnvelopeKdfParams): Argon2Params {
  if (!p) return ARGON2_PARAMS; // legacy/absent → 64 MiB web default
  return { m: p.memoryKiB, t: p.iterations, p: p.parallelism, dkLen: p.outputLength };
}

async function wrapVaultKey(vaultKey: Uint8Array, secret: string, type: "passphrase" | "recovery"): Promise<KeyEnvelope> {
  const salt = randomBytes(16);
  // New mobile vaults use the lighter, Hermes-practical params, recorded in
  // the envelope so any client (mobile or web) derives the same key on unlock.
  const params = ARGON2_PARAMS_MOBILE;
  const wrappingKey = await deriveArgon2idKey(secret, salt, params);
  const wrapped = await aesGcmEncrypt(wrappingKey, utf8(JSON.stringify({ vaultKey: toBase64(vaultKey) })));
  return {
    type,
    kdf: { name: ARGON2ID, salt: toBase64(salt), params: toEnvelopeParams(params) },
    wrappedKey: { algorithm: "AES-GCM", ...wrapped }
  };
}

async function unwrapVaultKey(envelope: KeyEnvelope, secret: string): Promise<Uint8Array> {
  const salt = fromBase64(envelope.kdf.salt);
  let wrappingKey: Uint8Array;
  if (envelope.kdf.name === ARGON2ID) {
    // Always derive with the params stored in THIS envelope, so we can open
    // vaults created with any params (e.g. 64 MiB web vaults).
    wrappingKey = await deriveArgon2idKey(secret, salt, toNobleParams(envelope.kdf.params as EnvelopeKdfParams | undefined));
  } else if (envelope.kdf.name === PBKDF2) {
    wrappingKey = await derivePbkdf2Key(secret, salt, envelope.kdf.iterations ?? 600000);
  } else {
    throw new Error(`Unknown KDF: ${envelope.kdf.name}`);
  }
  const pt = await aesGcmDecrypt(wrappingKey, envelope.wrappedKey);
  const parsed = JSON.parse(fromUtf8(pt));
  return fromBase64(parsed.vaultKey);
}

// PBKDF2 fallback for legacy vaults — pure JS via @noble/hashes
async function derivePbkdf2Key(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const { pbkdf2Async } = await import("@noble/hashes/pbkdf2");
  const { sha256 } = await import("@noble/hashes/sha256");
  return pbkdf2Async(sha256, utf8(secret), salt, { c: iterations, dkLen: 32 });
}

// ============================================================
// Recovery phrase
// ============================================================
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

export function normalizeRecoveryKey(input: string): string {
  // Trim, lowercase, collapse whitespace. Same logic as web.
  const cleaned = String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return cleaned;
}

export function isValidRecoveryPhrase(input: string): boolean {
  try { return validateMnemonic(normalizeRecoveryKey(input), wordlist); }
  catch { return false; }
}

function assertUsablePassphrase(p: string) {
  if (!p || p.length < 12) throw new Error("Vault passphrase must be at least 12 characters.");
}

// ============================================================
// Shamir share split / combine — wire-compatible with web
// ============================================================
export function splitVaultKey(rawKey: Uint8Array, opts: { total?: number; threshold?: number } = {}): string[] {
  if (rawKey.length !== 32) throw new Error("rawKey must be 32 bytes");
  const hex = Array.from(rawKey).map((b) => b.toString(16).padStart(2, "0")).join("");
  return secrets.share(hex, opts.total ?? 5, opts.threshold ?? 3);
}

export function combineShares(shareStrings: string[]): Uint8Array {
  if (!Array.isArray(shareStrings) || shareStrings.length < 3) {
    throw new Error(`need at least 3 shares, got ${shareStrings?.length ?? 0}`);
  }
  const hex = secrets.combine(shareStrings);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return out;
}

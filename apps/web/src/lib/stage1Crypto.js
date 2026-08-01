import { deriveArgon2idKey, ARGON2ID_NAME, ARGON2ID_DEFAULT_PARAMS } from "./argon2.js";
import { generateRecoveryPhrase, isValidRecoveryPhrase, normalizeRecoveryPhrase } from "./recoveryPhrase.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Legacy KDF (kept readable for backward compat with existing vaults).
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_NAME = "PBKDF2-SHA256";

// Default KDF for new vaults.
const DEFAULT_KDF = ARGON2ID_NAME;

const RECOVERY_GROUPS = 8;
const RECOVERY_GROUP_SIZE = 4;

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is required for OS-One Stage 1 vault encryption.");
  }
  return globalThis.crypto;
}

export function randomId() {
  return getCrypto().randomUUID();
}

// New vaults produce a BIP39 24-word phrase. Existing OS1A-XXXX-... keys
// remain valid forever — see normalizeRecoveryKey().
export function generateRecoveryKey() {
  return generateRecoveryPhrase();
}

// Legacy form for explicit callers/tests that want the old layout.
export function generateLegacyRecoveryKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = getCrypto().getRandomValues(new Uint8Array(RECOVERY_GROUPS * RECOVERY_GROUP_SIZE));
  const groups = [];

  for (let group = 0; group < RECOVERY_GROUPS; group += 1) {
    let value = "";
    for (let index = 0; index < RECOVERY_GROUP_SIZE; index += 1) {
      value += alphabet[bytes[group * RECOVERY_GROUP_SIZE + index] % alphabet.length];
    }
    groups.push(value);
  }

  return `OS1A-${groups.join("-")}`;
}

// Normalize either format. BIP39 phrases (any input containing spaces or
// only a-z) get word-normalized; everything else goes through the legacy
// path so old OS1A-XXXX keys keep unlocking.
export function normalizeRecoveryKey(value) {
  const raw = String(value ?? "").trim();
  if (looksLikeBip39(raw)) return normalizeRecoveryPhrase(raw);

  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const withoutPrefix = cleaned.startsWith("OS1A") ? cleaned.slice(4) : cleaned;
  const groups = withoutPrefix.match(/.{1,4}/g) ?? [];
  return `OS1A-${groups.join("-")}`;
}

function looksLikeBip39(raw) {
  if (!raw) return false;
  // BIP39 wordlist is pure lowercase a-z with spaces. Any digit, dash, or
  // an "OS1A" prefix (case-insensitive) means it's a legacy OS1A-XXXX key.
  if (/\d/.test(raw)) return false;
  if (/[-_]/.test(raw)) return false;
  if (/^os1a/i.test(raw.replace(/\s+/g, ""))) return false;
  // Either has whitespace (multi-word) or is a single 3+ letter word.
  if (/\s/.test(raw)) return true;
  if (/^[a-zA-Z]+$/.test(raw) && raw.length >= 3) return true;
  return false;
}

export { isValidRecoveryPhrase };

export async function createStage1VaultRecord({ vault, passphrase, recoveryKey }) {
  assertUsablePassphrase(passphrase);
  const vaultKey = await generateVaultKey();
  const passphraseEnvelope = await wrapVaultKeyWithSecret({
    vaultKey,
    secret: passphrase,
    type: "passphrase"
  });
  const recoveryEnvelope = recoveryKey
    ? await wrapVaultKeyWithSecret({
      vaultKey,
      secret: normalizeRecoveryKey(recoveryKey),
      type: "recovery"
    })
    : null;

  return {
    kind: "os-one-stage1-vault",
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    crypto: {
      vaultAlgorithm: "AES-GCM",
      keyWrap: DEFAULT_KDF,
      note: "New vaults wrap with Argon2id. Vaults created before the Argon2id migration keep using PBKDF2-SHA256 and will be auto-upgraded on next successful unlock."
    },
    plaintextNotice: {
      accountLoginDecryptsVault: false,
      releaseIsPreviewOnly: true,
      recoveryRequiresUserHeldKey: true
    },
    keyEnvelopes: {
      passphrase: passphraseEnvelope,
      ...(recoveryEnvelope ? { recovery: recoveryEnvelope } : {})
    },
    encryptedVault: await encryptJson(vaultKey, vault)
  };
}

export async function decryptVaultWithPassphrase(record, passphrase) {
  try {
    const vaultKey = await unwrapVaultKeyWithSecret(record.keyEnvelopes.passphrase, passphrase);
    const vault = await decryptJson(vaultKey, record.encryptedVault);
    return { vault, vaultKey, usedEnvelope: "passphrase" };
  } catch {
    throw new Error("Could not unlock vault with this passphrase.");
  }
}

export async function decryptVaultWithRecoveryKey(record, recoveryKey) {
  if (!record?.keyEnvelopes?.recovery) {
    throw new Error("This vault does not have a recovery key envelope.");
  }

  try {
    const vaultKey = await unwrapVaultKeyWithSecret(record.keyEnvelopes.recovery, normalizeRecoveryKey(recoveryKey));
    const vault = await decryptJson(vaultKey, record.encryptedVault);
    return { vault, vaultKey, usedEnvelope: "recovery" };
  } catch {
    throw new Error("Could not unlock vault with this recovery key.");
  }
}

export async function updateEncryptedVault(record, vaultKey, vault) {
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    encryptedVault: await encryptJson(vaultKey, vault)
  };
}

/**
 * Returns true if the named envelope still uses the legacy PBKDF2 KDF.
 * Pre-Argon2id vaults will all return true here; new vaults will
 * return false. Used by the auto-upgrade path.
 */
export function envelopeIsLegacyKdf(record, kind = "passphrase") {
  const envelope = record?.keyEnvelopes?.[kind];
  if (!envelope) return false;
  return envelope.kdf?.name === PBKDF2_NAME;
}

/**
 * Rebuild an envelope with the current default KDF (Argon2id). Requires
 * the secret to be re-supplied because the envelope's wrapping key cannot
 * be derived from the unwrapped vault key alone.
 *
 * Caller is responsible for persisting the returned record.
 */
export async function upgradeEnvelopeKdf({ record, vaultKey, kind, secret }) {
  if (!record || !vaultKey) throw new Error("upgradeEnvelopeKdf: record and vaultKey are required.");
  if (!envelopeIsLegacyKdf(record, kind)) return record;

  const normalizedSecret = kind === "recovery" ? normalizeRecoveryKey(secret) : secret;
  if (!normalizedSecret) throw new Error("upgradeEnvelopeKdf: secret is required to rewrap.");

  const newEnvelope = await wrapVaultKeyWithSecret({
    vaultKey,
    secret: normalizedSecret,
    type: kind,
    kdf: ARGON2ID_NAME
  });

  return {
    ...record,
    updatedAt: new Date().toISOString(),
    crypto: { ...(record.crypto ?? {}), keyWrap: DEFAULT_KDF },
    keyEnvelopes: {
      ...record.keyEnvelopes,
      [kind]: newEnvelope
    }
  };
}

export async function replaceRecoveryKeyEnvelope(record, vaultKey, recoveryKey) {
  if (!record || !vaultKey) {
    throw new Error("The vault must be unlocked before replacing the recovery key.");
  }

  const recoveryEnvelope = await wrapVaultKeyWithSecret({
    vaultKey,
    secret: normalizeRecoveryKey(recoveryKey),
    type: "recovery"
  });

  return {
    ...record,
    updatedAt: new Date().toISOString(),
    keyEnvelopes: {
      ...record.keyEnvelopes,
      recovery: recoveryEnvelope
    }
  };
}

export function validateBackupRecord(record) {
  if (record?.kind !== "os-one-stage1-vault" || record?.version !== 2) {
    return { ok: false, reason: "This is not an OS-One Stage 1 backup." };
  }

  if (!record?.keyEnvelopes?.passphrase?.wrappedKey || !record?.encryptedVault?.ciphertext) {
    return { ok: false, reason: "The backup is missing encrypted vault data or key envelopes." };
  }

  if (record.plaintextNotice?.accountLoginDecryptsVault !== false) {
    return { ok: false, reason: "The backup does not declare the account/vault trust boundary." };
  }

  return { ok: true };
}

async function generateVaultKey() {
  return getCrypto().subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function wrapVaultKeyWithSecret({ vaultKey, secret, type, kdf = DEFAULT_KDF }) {
  const salt = randomBytes(16);
  const wrappingKey = await deriveWrappingKey({ secret, salt, kdf });
  const rawVaultKey = await getCrypto().subtle.exportKey("raw", vaultKey);

  return {
    type,
    kdf: kdfMetadata({ kdf, salt }),
    wrappedKey: await encryptJson(wrappingKey, { vaultKey: toBase64(new Uint8Array(rawVaultKey)) })
  };
}

async function unwrapVaultKeyWithSecret(envelope, secret) {
  const wrappingKey = await deriveWrappingKeyFromEnvelope(envelope, secret);
  const raw = await decryptJson(wrappingKey, envelope.wrappedKey);

  return getCrypto().subtle.importKey(
    "raw",
    fromBase64(raw.vaultKey),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

function kdfMetadata({ kdf, salt }) {
  if (kdf === ARGON2ID_NAME) {
    return {
      name: ARGON2ID_NAME,
      salt: toBase64(salt),
      params: { ...ARGON2ID_DEFAULT_PARAMS }
    };
  }
  // PBKDF2 (legacy and explicit)
  return {
    name: PBKDF2_NAME,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS
  };
}

// Exposed so other modules (e.g. stage2BackupVerification) can decrypt
// envelopes without duplicating the KDF dispatch logic.
export async function deriveWrappingKeyFromEnvelope(envelope, secret) {
  const name = envelope?.kdf?.name;
  const salt = fromBase64(envelope.kdf.salt);
  if (name === ARGON2ID_NAME) {
    return deriveArgon2idKey(secret, salt, envelope.kdf.params ?? ARGON2ID_DEFAULT_PARAMS);
  }
  // Legacy PBKDF2 path (envelope.kdf.iterations is set).
  return derivePBKDF2Key(secret, salt, envelope.kdf.iterations ?? PBKDF2_ITERATIONS);
}

async function deriveWrappingKey({ secret, salt, kdf }) {
  if (kdf === ARGON2ID_NAME) return deriveArgon2idKey(secret, salt);
  return derivePBKDF2Key(secret, salt, PBKDF2_ITERATIONS);
}

async function derivePBKDF2Key(secret, salt, iterations) {
  const baseKey = await getCrypto().subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return getCrypto().subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key, value) {
  const iv = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await getCrypto().subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    algorithm: "AES-GCM",
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
}

async function decryptJson(key, encrypted) {
  const iv = fromBase64(encrypted.iv);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(decoder.decode(plaintext));
}

function randomBytes(size) {
  return getCrypto().getRandomValues(new Uint8Array(size));
}

function assertUsablePassphrase(passphrase) {
  if (String(passphrase ?? "").length < 12) {
    throw new Error("Use at least 12 characters for the vault phrase.");
  }
}

function toBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

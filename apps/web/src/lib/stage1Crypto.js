const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_ITERATIONS = 600000;
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

export function generateRecoveryKey() {
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

export function normalizeRecoveryKey(value) {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const withoutPrefix = cleaned.startsWith("OS1A") ? cleaned.slice(4) : cleaned;
  const groups = withoutPrefix.match(/.{1,4}/g) ?? [];
  return `OS1A-${groups.join("-")}`;
}

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
      keyWrap: "PBKDF2-SHA256",
      note: "Stage 1 beta uses WebCrypto PBKDF2. Production should move to Argon2id."
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

async function wrapVaultKeyWithSecret({ vaultKey, secret, type }) {
  const salt = randomBytes(16);
  const wrappingKey = await deriveWrappingKey(secret, salt, DEFAULT_ITERATIONS);
  const rawVaultKey = await getCrypto().subtle.exportKey("raw", vaultKey);

  return {
    type,
    kdf: {
      name: "PBKDF2-SHA256",
      salt: toBase64(salt),
      iterations: DEFAULT_ITERATIONS
    },
    wrappedKey: await encryptJson(wrappingKey, { vaultKey: toBase64(new Uint8Array(rawVaultKey)) })
  };
}

async function unwrapVaultKeyWithSecret(envelope, secret) {
  const wrappingKey = await deriveWrappingKey(secret, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
  const raw = await decryptJson(wrappingKey, envelope.wrappedKey);

  return getCrypto().subtle.importKey(
    "raw",
    fromBase64(raw.vaultKey),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function deriveWrappingKey(secret, salt, iterations) {
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

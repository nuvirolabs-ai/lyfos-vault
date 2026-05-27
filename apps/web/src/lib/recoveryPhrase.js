// BIP39 24-word recovery phrase. Replaces the legacy OS1A-XXXX-...
// format for new vaults. Legacy keys are still understood for backward
// compatibility — see normalizeRecoveryKey() in stage1Crypto.js.
//
// Why BIP39:
//   - 24 words = 256 bits of entropy (matches our AES-256 key length).
//   - Built-in checksum: a typo on the last word is detected immediately.
//   - The English wordlist is curated so similar-looking words are
//     well-separated (no "advice" vs "advise" pairs).
//   - Industry standard — users may already keep BIP39 phrases for
//     other wallets/keys. Same handwriting habit transfers.

import { generateMnemonic, validateMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

// 256 bits of entropy → 24 words
const ENTROPY_BITS = 256;

export function generateRecoveryPhrase() {
  return generateMnemonic(wordlist, ENTROPY_BITS);
}

/**
 * Normalize a user-typed phrase: trim, lowercase, collapse whitespace.
 * Does NOT validate the checksum — see isValidRecoveryPhrase().
 */
export function normalizeRecoveryPhrase(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function isValidRecoveryPhrase(input) {
  const normalized = normalizeRecoveryPhrase(input);
  if (!normalized) return false;
  try {
    return validateMnemonic(normalized, wordlist);
  } catch {
    return false;
  }
}

/** Words in this phrase. Used by UI to render a grid of slots. */
export function phraseWords(phrase) {
  return normalizeRecoveryPhrase(phrase).split(" ").filter(Boolean);
}

/**
 * 8-char fingerprint for UI display ("which copy of my phrase is this?").
 * Computed from the 32 bytes of entropy, NOT the phrase string, so two
 * normalized representations of the same phrase produce the same fingerprint.
 */
export async function phraseFingerprint(phrase) {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!isValidRecoveryPhrase(normalized)) return null;
  const entropy = mnemonicToEntropy(normalized, wordlist);
  const digest = await crypto.subtle.digest("SHA-256", entropy);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Used by UI autocomplete during entry. Returns up to `limit` candidate
 * words that start with the given prefix.
 */
export function wordSuggestions(prefix, limit = 5) {
  const p = String(prefix ?? "").toLowerCase().trim();
  if (!p) return [];
  const out = [];
  for (const w of wordlist) {
    if (w.startsWith(p)) {
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export { wordlist };

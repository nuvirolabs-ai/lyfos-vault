// Biometric unlock for the vault.
//
// We DON'T store the passphrase under FaceID/TouchID. Instead, we keep
// a SecureStore-backed "biometric envelope": a fresh wrapping key
// (32 random bytes) is stored behind a biometric-protected SecureStore
// item; that wrapping key encrypts the user's vault passphrase. So
// the threat model is: a passcode-protected keychain + Apple/Google's
// biometric attestation.
//
// If biometric auth fails, the user falls back to typing her passphrase.

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { aesGcmEncrypt, aesGcmDecrypt, randomBytes, toBase64, fromBase64, utf8, fromUtf8 } from "./crypto";

const BIO_KEY      = "lyfos-bio-wrapping-key-v1";
const BIO_ENVELOPE = "lyfos-bio-passphrase-envelope-v1";

export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return isEnrolled;
}

export async function enableBiometricUnlock(passphrase: string): Promise<void> {
  if (!(await isBiometricAvailable())) throw new Error("Biometric not available on this device");
  const wrappingKey = randomBytes(32);
  const envelope = await aesGcmEncrypt(wrappingKey, utf8(passphrase));
  await SecureStore.setItemAsync(BIO_KEY, toBase64(wrappingKey), {
    requireAuthentication: true,
    authenticationPrompt: "Confirm to enable Face ID / Touch ID unlock"
  } as any);
  await SecureStore.setItemAsync(BIO_ENVELOPE, JSON.stringify(envelope));
}

export async function disableBiometricUnlock(): Promise<void> {
  await SecureStore.deleteItemAsync(BIO_KEY);
  await SecureStore.deleteItemAsync(BIO_ENVELOPE);
}

export async function unlockWithBiometric(): Promise<string | null> {
  if (!(await isBiometricAvailable())) return null;
  const wrappingB64 = await SecureStore.getItemAsync(BIO_KEY, {
    requireAuthentication: true,
    authenticationPrompt: "Unlock your Lyfos vault"
  } as any);
  if (!wrappingB64) return null;
  const env = await SecureStore.getItemAsync(BIO_ENVELOPE);
  if (!env) return null;
  try {
    const ptBytes = await aesGcmDecrypt(fromBase64(wrappingB64), JSON.parse(env));
    return fromUtf8(ptBytes);
  } catch {
    return null;
  }
}

export async function biometricUnlockConfigured(): Promise<boolean> {
  const envelope = await SecureStore.getItemAsync(BIO_ENVELOPE);
  return Boolean(envelope);
}

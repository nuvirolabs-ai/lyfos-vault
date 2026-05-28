// Hermes / React Native runtime polyfills.
// MUST be imported as the very first line of App.tsx so that
// @supabase/supabase-js, @noble/*, tweetnacl etc all have the globals
// they expect.

import "react-native-get-random-values";       // populates crypto.getRandomValues
import { Buffer } from "buffer";
// @ts-ignore
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

// btoa / atob shims (Hermes ships these in newer versions; safe no-op otherwise)
if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
}
if (typeof globalThis.atob !== "function") {
  globalThis.atob = (b64: string) => Buffer.from(b64, "base64").toString("binary");
}

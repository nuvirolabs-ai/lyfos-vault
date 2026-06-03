// Sign in / sign up / magic link. Single-screen with mode toggle.

import React, { useState } from "react";
import { ScrollView, View, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, Body, Footnote, Field, Input, PrimaryButton, LinkText, Card } from "../../src/ui";
import { signInWithPassword, signUpWithPassword, signInWithMagicLink } from "../../src/lib/auth";

type Mode = "sign-in" | "sign-up" | "magic";

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit() {
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "sign-in")  await signInWithPassword({ email: email.trim(), password });
      else if (mode === "sign-up") {
        if (password.length < 12) throw new Error("Account password must be at least 12 characters. (This is separate from your vault passphrase.)");
        const data = await signUpWithPassword({ email: email.trim(), password });
        if (!data?.session) setInfo(`We sent a confirmation link to ${email}. Open it on this device to finish setting up.`);
      } else {
        await signInWithMagicLink({ email: email.trim() });
        setInfo(`Sent a sign-in link to ${email}. Open it on this device.`);
      }
    } catch (err: any) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 36, flexGrow: 1 }}>
            <Eyebrow>Lyfos</Eyebrow>
            <H1 style={{ marginTop: 14 }}>
              {mode === "sign-up" ? "Create your account." : "Welcome back."}
            </H1>
            <Body style={{ marginTop: 12, color: "#6e6e73" }}>
              {mode === "sign-up"
                ? "Your account lets you open your vault on more than one device. Lyfos never sees your vault contents."
                : "Sign in to sync your vault across devices. Your encrypted vault stays unreadable to Lyfos."}
            </Body>

            <View style={{ flexDirection: "row", gap: 8, marginTop: 24 }}>
              {(["sign-in","sign-up","magic"] as Mode[]).map((m) => (
                <LinkText key={m} onPress={() => { setMode(m); setError(""); setInfo(""); }}
                  style={{ color: mode === m ? "#1d1d1f" : "#86868b", fontWeight: mode === m ? "600" : "400", textDecorationLine: "none" }}>
                  {m === "sign-in" ? "Sign in" : m === "sign-up" ? "Sign up" : "Magic link"}
                </LinkText>
              ))}
            </View>

            <View style={{ marginTop: 24 }}>
              <Field label="Email">
                <Input
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="you@example.com"
                />
              </Field>
              {mode !== "magic" && (
                <Field label={mode === "sign-up" ? "Account password (min 12 chars)" : "Account password"}>
                  <Input
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
              )}
            </View>

            {error ? <Card tone="danger" style={{ marginTop: 8 }}><Body style={{ color: "#b42318" }}>{error}</Body></Card> : null}
            {info  ? <Card tone="success" style={{ marginTop: 8 }}><Body style={{ color: "#0b6b3a" }}>{info}</Body></Card> : null}

            <PrimaryButton
              onPress={submit}
              busy={busy}
              disabled={!email}
              label={mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Email me a link"}
              style={{ marginTop: 20 }}
            />

            <View style={{ alignItems: "center", marginTop: 36 }}>
              <Footnote style={{ textAlign: "center" }}>
                By continuing you agree to the Terms, Privacy and Beta disclaimer.
              </Footnote>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function humanize(err: any): string {
  const raw = err?.message || String(err) || "Something went wrong.";
  if (raw.includes("Invalid login credentials")) return "That email and password don't match an account.";
  if (raw.includes("User already registered")) return "An account already exists for this email. Try signing in instead.";
  if (raw.toLowerCase().includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  return raw;
}

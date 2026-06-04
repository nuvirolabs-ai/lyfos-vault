// Unlock an existing local vault. Biometric path first if configured;
// passphrase otherwise. Recovery phrase as a fallback.

import React, { useEffect, useState } from "react";
import { ScrollView, View, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, Body, Field, Input, PrimaryButton, SecondaryButton, LinkText, Card } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { biometricUnlockConfigured } from "../../src/lib/biometric";

export default function UnlockScreen() {
  const { unlockWithPassphrase, unlockWithRecovery, unlockWithBiometricIfReady, biometricEnabled, enterDemoVault } = useApp();
  const [mode, setMode] = useState<"passphrase" | "recovery">("passphrase");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    biometricUnlockConfigured().then(setBioReady).catch(() => {});
  }, []);

  // Try biometric on mount if enabled
  useEffect(() => {
    (async () => {
      if (biometricEnabled) {
        const ok = await unlockWithBiometricIfReady();
        if (ok) return;
      }
    })();
  }, [biometricEnabled]);

  async function submit() {
    setError(""); setBusy(true);
    try {
      if (mode === "passphrase") await unlockWithPassphrase(text);
      else                       await unlockWithRecovery(text);
    } catch (err: any) {
      setError(err?.message || "Couldn't unlock.");
    } finally {
      setBusy(false);
    }
  }

  async function tryBiometric() {
    const ok = await unlockWithBiometricIfReady();
    if (!ok) setError("Biometric unlock failed. Type your passphrase.");
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 60, flexGrow: 1 }}>
            <Eyebrow>Lyfos</Eyebrow>
            <H1 style={{ marginTop: 14 }}>Welcome back.</H1>
            <Body style={{ marginTop: 12, color: "#6e6e73" }}>
              {mode === "passphrase"
                ? "Type your vault passphrase to unlock."
                : "Type your 24-word recovery phrase to unlock (if you've forgotten the passphrase)."}
            </Body>

            <View style={{ marginTop: 28 }}>
              <Field label={mode === "passphrase" ? "Vault passphrase" : "Recovery phrase"}>
                <Input
                  value={text}
                  onChangeText={setText}
                  secureTextEntry={mode === "passphrase"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline={mode === "recovery"}
                  numberOfLines={mode === "recovery" ? 4 : 1}
                  style={mode === "recovery" ? { minHeight: 96, textAlignVertical: "top" } : undefined}
                  onSubmitEditing={submit}
                />
              </Field>
            </View>

            {error ? <Card tone="danger" style={{ marginTop: 8 }}><Body style={{ color: "#b42318" }}>{error}</Body></Card> : null}

            <PrimaryButton onPress={submit} busy={busy} label="Unlock" style={{ marginTop: 12 }} />

            {bioReady && <SecondaryButton onPress={tryBiometric} label="Use Face ID / Touch ID" style={{ marginTop: 8 }} />}

            <View style={{ alignItems: "center", marginTop: 28 }}>
              <LinkText onPress={() => { setError(""); setText(""); setMode((m) => m === "passphrase" ? "recovery" : "passphrase"); }}>
                {mode === "passphrase" ? "Use recovery phrase instead" : "Use passphrase instead"}
              </LinkText>
            </View>

            <View style={{ alignItems: "center", marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.08)" }}>
              <LinkText onPress={() => { enterDemoVault(); router.replace("/(tabs)/home"); }}>
                Skip — explore a demo vault →
              </LinkText>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

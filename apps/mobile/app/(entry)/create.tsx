// Create a new local vault: passphrase + recovery phrase confirmation
// drill. Mirror of the web's EntryScreen create flow.

import React, { useMemo, useState } from "react";
import { ScrollView, View, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, H2, Body, Footnote, Field, Input, PrimaryButton, LinkText, Card } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { generateRecoveryPhrase, isValidRecoveryPhrase, normalizeRecoveryKey } from "../../src/lib/vaultRecord";
import { colors, radii } from "../../src/theme";

export default function CreateVaultScreen() {
  const { createVault, enterDemoVault } = useApp();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPp, setConfirmPp] = useState("");
  const [phrase] = useState(() => generateRecoveryPhrase());
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dbg, setDbg] = useState("ready");

  const words = useMemo(() => phrase.split(" "), [phrase]);

  // Diagnostic logger — prints to the Metro terminal AND shows on screen so
  // we can see exactly what happens on a real device.
  function log(msg: string) {
    // eslint-disable-next-line no-console
    console.log("[lyfos:create]", msg);
    setDbg(msg);
  }

  async function go() {
    log(`tap · step ${step}`);
    setError("");
    if (step === 1) {
      if (passphrase.length < 12) { log("step1 reject: passphrase < 12"); return setError("At least 12 characters. A memorable phrase is better than a short password."); }
      if (passphrase !== confirmPp) { log("step1 reject: mismatch"); return setError("Passphrases don't match."); }
      log("step1 ok → step2"); setStep(2);
      return;
    }
    if (step === 2) { log("step2 → step3"); setStep(3); return; }
    if (step === 3) {
      const norm = normalizeRecoveryKey(confirmPhrase);
      log(`step3 compare · typed=${norm.split(" ").length}w expected=${phrase.split(" ").length}w match=${norm === phrase}`);
      if (norm !== phrase) {
        return setError("That doesn't match. Type the 24 words exactly as shown, with spaces between them.");
      }
      try {
        setBusy(true);
        log("createVault start (deriving keys…)");
        const t0 = Date.now();
        await createVault({ passphrase, recoveryPhrase: phrase });
        log(`createVault done in ${Date.now() - t0}ms → navigating home`);
        router.replace("/(tabs)/home");
      } catch (err: any) {
        log(`createVault ERROR: ${err?.message || err}`);
        setError(err?.message || "Couldn't create the vault.");
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 36, paddingBottom: 16 }}>
            <Eyebrow>Lyfos · Step {step} of 3</Eyebrow>
            <H1 style={{ marginTop: 14 }}>
              {step === 1 ? "Choose your vault passphrase."
              : step === 2 ? "Write down your recovery phrase."
              :              "Type your phrase to confirm."}
            </H1>

            {step === 1 && (
              <View style={{ marginTop: 24 }}>
                <Body style={{ color: colors.text2 }}>
                  This is the passphrase you'll type every time you open Lyfos on this device. Lyfos cannot recover it for you.
                </Body>
                <View style={{ marginTop: 20 }}>
                  <Field label="Passphrase">
                    <Input value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                  </Field>
                  <Field label="Confirm">
                    <Input value={confirmPp} onChangeText={setConfirmPp} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                  </Field>
                </View>
              </View>
            )}

            {step === 2 && (
              <View style={{ marginTop: 24 }}>
                <Body style={{ color: colors.text2 }}>
                  24 words. The only way to open your vault if you forget your passphrase. Lyfos cannot show this again — write it on paper or store it in a password manager.
                </Body>
                <View style={{ marginTop: 20, padding: 16, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.divider }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {words.map((w, i) => (
                      <View key={i} style={{ width: "33.33%", flexDirection: "row", paddingVertical: 6 }}>
                        <Body style={{ width: 24, color: colors.text4 }}>{String(i + 1).padStart(2,"0")}</Body>
                        <Body style={{ fontWeight: "500" }}>{w}</Body>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={{ alignItems: "center", marginTop: 16 }}>
                  <LinkText onPress={() => Clipboard.setStringAsync(phrase)}>Copy to clipboard</LinkText>
                </View>
              </View>
            )}

            {step === 3 && (
              <View style={{ marginTop: 24 }}>
                <Body style={{ color: colors.text2 }}>
                  Type the 24 words below, in order, separated by spaces. This proves you've saved them.
                </Body>
                <Field label="Phrase">
                  <Input
                    value={confirmPhrase}
                    onChangeText={setConfirmPhrase}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    numberOfLines={4}
                    style={{ minHeight: 96, textAlignVertical: "top" }}
                  />
                </Field>
              </View>
            )}

            {error ? <Card tone="danger" style={{ marginTop: 12 }}><Body style={{ color: "#b42318" }}>{error}</Body></Card> : null}

            <Footnote style={{ textAlign: "center", marginTop: 20, marginBottom: 8, color: colors.text4 }}>debug: {dbg}</Footnote>
            <PrimaryButton
              onPress={go}
              busy={busy}
              label={step === 3 ? "Create vault" : "Continue"}
            />
            {step > 1 && (
              <View style={{ alignItems: "center", marginTop: 16 }}>
                <LinkText onPress={() => { setError(""); setStep((s) => (s - 1) as any); }}>Back</LinkText>
              </View>
            )}

            <View style={{ alignItems: "center", marginTop: 28, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.divider }}>
              <LinkText onPress={() => { log("enterDemoVault"); enterDemoVault(); router.replace("/(tabs)/home"); }}>
                Skip — explore a demo vault →
              </LinkText>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

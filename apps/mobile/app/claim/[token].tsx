// /claim/[token] — nominee files a release claim.

import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { Screen, Eyebrow, H1, Body, Footnote, Field, PrimaryButton, LinkText, Card } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { peekClaim, uploadDeathCertificate, createReleaseRequest } from "../../src/lib/releaseClaim";
import { makeReleaseProcessKeypair } from "../../src/lib/crypto";
import { colors } from "../../src/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";

const RP_KEY_PREFIX = "lyfos-release-process-key-";

export default function ClaimScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useApp();

  const [info, setInfo] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneId, setDoneId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    peekClaim(token)
      .then((r) => setInfo(r ?? null))
      .catch((e) => setLoadError(e?.message ?? "Couldn't load."))
      .finally(() => setLoading(false));
  }, [token]);

  async function pickPdf() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"] });
    if (!r.canceled && r.assets?.[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.name ?? `cert.pdf`, type: a.mimeType ?? "application/pdf" });
    }
  }
  async function pickImg() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!r.canceled && r.assets?.[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.fileName ?? `cert.jpg`, type: a.mimeType ?? "image/jpeg" });
    }
  }

  async function submit() {
    if (!file) { setError("Attach the death/incapacity certificate."); return; }
    setBusy(true); setError("");
    try {
      const kp = makeReleaseProcessKeypair();
      await AsyncStorage.setItem(RP_KEY_PREFIX + token, JSON.stringify(kp));
      const path = await uploadDeathCertificate(file);
      const id = await createReleaseRequest({ claimToken: token!, releaseProcessPubkey: kp.publicKey, deathCertificatePath: path });
      setDoneId(id as string);
    } catch (e: any) { setError(e?.message ?? "Couldn't file claim."); }
    finally { setBusy(false); }
  }

  if (loading) return <Screen><Body style={{ padding: 40 }}>Loading…</Body></Screen>;
  if (!info) {
    return <Screen><SafeAreaView style={{ flex: 1, padding: 20 }}>
      <H1 style={{ marginTop: 40 }}>This claim link is no longer valid.</H1>
      <Footnote style={{ marginTop: 10 }}>{loadError || "It may have been rotated or revoked."}</Footnote>
    </SafeAreaView></Screen>;
  }
  if (!info.plan_active) {
    return <Screen><SafeAreaView style={{ flex: 1, padding: 20 }}>
      <H1 style={{ marginTop: 40 }}>Plan is not active yet.</H1>
      <Footnote style={{ marginTop: 10 }}>
        {info.owner_email.split("@")[0]} hasn't finalized their release plan. Ask them to invite 5 key holders and finalize before you can file a claim.
      </Footnote>
    </SafeAreaView></Screen>;
  }

  if (doneId) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow style={{ color: colors.greenInk }}>Filed</Eyebrow>
          <H1 style={{ marginTop: 10 }}>Your claim is in review.</H1>
          <Footnote style={{ marginTop: 10 }}>
            A Lyfos founder will review your certificate within 24 hours. Then {info.owner_email.split("@")[0]}'s 5 key holders are notified; after 3 release, a 14-day owner-protection hold begins with daily alerts.
          </Footnote>
          <Footnote style={{ marginTop: 10 }}>
            <Body style={{ fontWeight: "600" }}>Keep this device + app installed</Body> — your release process key is stored only on this device.
          </Footnote>
          <Footnote style={{ marginTop: 6, color: colors.text4 }}>Reference: {doneId.slice(0, 8)}…</Footnote>
        </SafeAreaView>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow>Release claim</Eyebrow>
          <H1 style={{ marginTop: 10 }}>File a claim against {info.owner_email.split("@")[0]}'s vault.</H1>
          {info.nominee_email && (
            <Footnote style={{ marginTop: 8 }}>Sign in using {info.nominee_email} — the email {info.owner_email.split("@")[0]} expected.</Footnote>
          )}
          {info.claim_text && (
            <Card style={{ marginTop: 16 }}>
              <Eyebrow>Note from {info.owner_email.split("@")[0]}</Eyebrow>
              <Body style={{ marginTop: 6 }}>{info.claim_text}</Body>
            </Card>
          )}
          <PrimaryButton onPress={() => router.push("/(auth)/sign-in")} label="Sign in / Sign up" style={{ marginTop: 24 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
          <Eyebrow>Step 2 of 2</Eyebrow>
          <H1 style={{ marginTop: 10 }}>Upload proof of death or incapacity.</H1>
          <Footnote style={{ marginTop: 10 }}>
            A Lyfos founder reviews each submission. Accepted: death certificate, hospital incapacity declaration, court order. PDF or image.
          </Footnote>
          <Field label="Certificate file">
            <View style={{ flexDirection: "row", gap: 8 }}>
              <PrimaryButton onPress={pickPdf} label="Pick file" style={{ flex: 1, paddingVertical: 12 }} />
              <PrimaryButton onPress={pickImg} label="Pick photo" style={{ flex: 1, paddingVertical: 12 }} />
            </View>
            {file && <Footnote style={{ marginTop: 6 }}>{file.name}</Footnote>}
          </Field>
          <Card tone="amber">
            <Footnote style={{ color: colors.amberInk }}>
              Filing a fraudulent claim is a crime. {info.owner_email.split("@")[0]} gets daily alerts for 14 days after 3 key holders release. If alive, they will abort.
            </Footnote>
          </Card>
          {error ? <Footnote style={{ marginTop: 8, color: colors.redInk }}>{error}</Footnote> : null}
          <PrimaryButton onPress={submit} busy={busy} disabled={!file} label="File claim" style={{ marginTop: 16 }} />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

// Capture — paste a note (or attach an image via image picker),
// run a regex extractor on the text, present a one-shot draft,
// save as a vault record. No OCR on mobile in v1 (Expo OCR is
// flaky on managed); we accept an attachment but extract from text.

import React, { useState } from "react";
import { ScrollView, View, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { Screen, Eyebrow, H1, H3, Body, Footnote, Field, Input, PrimaryButton, SecondaryButton, LinkText, Card, Divider, StatusPill } from "../src/ui";
import { useApp } from "../src/AppContext";
import { analyzeMessyInput } from "../src/lib/extract";
import { colors, radii } from "../src/theme";

export default function CaptureScreen() {
  const { vault, save, entitlements } = useApp();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<{ uri: string; name: string } | null>(null);

  async function pickAttachment() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9
    });
    if (!res.canceled && res.assets?.[0]) {
      const a = res.assets[0];
      setAttachment({ uri: a.uri, name: a.fileName ?? `capture-${Date.now()}.jpg` });
    }
  }

  function structure() {
    if (!text.trim()) return;
    setDraft(analyzeMessyInput(text));
  }

  async function saveDraft() {
    if (!draft) return;
    if (Number.isFinite(entitlements.vaultItemLimit) && (vault?.items ?? []).length >= entitlements.vaultItemLimit) {
      Alert.alert(
        "Free plan limit",
        `You're on the ${entitlements.label} plan (${entitlements.vaultItemLimit}-item limit). Upgrade to keep adding records.`,
        [{ text: "OK" }, { text: "Upgrade", onPress: () => router.push("/settings") }]
      );
      return;
    }
    setBusy(true);
    try {
      const id = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      const now = new Date().toISOString();
      const record = {
        id, ...draft, createdAt: now, updatedAt: now,
        attachments: attachment ? [{
          id: (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
          name: attachment.name, type: "image/*", size: 0, dataUrl: attachment.uri
        }] : []
      };
      await save((v) => ({ ...v, items: [record, ...(v.items ?? [])] }), `Captured record: ${record.title}`);
      router.replace("/(tabs)/vault");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Back</LinkText>
            <Eyebrow>Capture</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 20 }}>Drop in the mess.</H1>
          <Footnote style={{ marginTop: 8 }}>Paste a note or attach a photo. We propose a draft; you decide what becomes a record.</Footnote>

          <View style={{ marginTop: 16 }}>
            <Input
              value={text}
              onChangeText={setText}
              multiline
              numberOfLines={6}
              placeholder="HDFC bank account ending 5678, IFSC HDFC0001234, balance Rs 845000, netbanking password Demo@2026, nominee Priya."
              style={{ minHeight: 140, textAlignVertical: "top" }}
            />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <LinkText onPress={pickAttachment}>{attachment ? `Attached · ${attachment.name}` : "Attach photo"}</LinkText>
            <PrimaryButton onPress={structure} disabled={!text.trim()} label="Structure this" style={{ paddingHorizontal: 18, paddingVertical: 10 }} />
          </View>

          {draft && (
            <Card style={{ marginTop: 20 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <H3>{draft.title}</H3>
                <StatusPill label={draft.emergencyEligible ? "Emergency" : "Owner only"} tone={draft.emergencyEligible ? "green" : "neutral"} />
              </View>
              <Divider space={12} />
              <Row label="Type" value={draft.type.replace(/_/g, " ")} />
              <Row label="Identifier" value={draft.username || "—"} />
              <Row label="Sensitive" value={draft.secret ? "(stored)" : "—"} />
              <Row label="Bank details" value={draft.bankDetails || "—"} />
              <PrimaryButton onPress={saveDraft} busy={busy} label="Save as protected record" style={{ marginTop: 14 }} />
              <Footnote style={{ marginTop: 8, textAlign: "center", color: colors.text4 }}>
                Lyfos never saves AI output without confirmation.
              </Footnote>
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
      <Footnote style={{ color: colors.text3 }}>{label}</Footnote>
      <Body style={{ flexShrink: 1, marginLeft: 12, textAlign: "right" }}>{value}</Body>
    </View>
  );
}

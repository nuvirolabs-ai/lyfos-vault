// Area workspace — Life Map dossier category. Lists records for the
// area, opens a detail/edit sheet for any of them, and exposes Add.

import React, { useMemo, useState } from "react";
import { ScrollView, View, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { Screen, Eyebrow, H1, H3, Body, Footnote, Field, Input, PrimaryButton, SecondaryButton, LinkText, Card, Divider, StatusPill } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { colors, radii } from "../../src/theme";

const AREAS: Record<string, { label: string; types: string[]; description: string }> = {
  identity:  { label: "Identity",  types: ["identity_document"], description: "IDs, certificates, legal proof of who you are." },
  money:     { label: "Money",     types: ["bank_account", "card"], description: "Accounts, cards, balances, obligations." },
  access:    { label: "Access",    types: ["password", "pin", "email_account"], description: "Passwords, PINs, recovery routes." },
  insurance: { label: "Insurance", types: ["insurance_policy"], description: "Policies, claims, nominee evidence." },
  documents: { label: "Documents", types: ["important_document"], description: "Property, tax, legal records." },
  emergency: { label: "Emergency", types: ["emergency_instruction"], description: "First 72 hours plan." }
};

const TYPES = [
  ["password",            "Password"],
  ["bank_account",        "Bank account"],
  ["pin",                 "PIN or code"],
  ["email_account",       "Email account"],
  ["card",                "Card"],
  ["identity_document",   "ID document"],
  ["insurance_policy",    "Insurance policy"],
  ["important_document",  "Important document"],
  ["emergency_instruction","Emergency instruction"]
];

export default function AreaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { vault, save, entitlements } = useApp();
  const area = AREAS[id ?? ""] ?? null;
  const [editing, setEditing] = useState<any | null>(null);

  if (!vault || !area) return null;
  const records = (vault.items ?? []).filter((it: any) => area.types.includes(it.type));

  async function saveRecord(rec: any) {
    const exists = (vault.items ?? []).some((i: any) => i.id === rec.id);
    if (!exists && Number.isFinite(entitlements.vaultItemLimit) && (vault.items ?? []).length >= entitlements.vaultItemLimit) {
      Alert.alert(
        "Free plan limit",
        `You're on the ${entitlements.label} plan (${entitlements.vaultItemLimit}-item limit). Upgrade to keep adding records.`,
        [{ text: "OK" }, { text: "Upgrade", onPress: () => router.push("/settings") }]
      );
      return;
    }
    const now = new Date().toISOString();
    const next = {
      ...rec, id: rec.id || ((globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)),
      updatedAt: now, createdAt: rec.createdAt || now
    };
    await save((v) => ({
      ...v,
      items: exists ? v.items.map((i: any) => i.id === next.id ? next : i) : [next, ...(v.items ?? [])]
    }), exists ? "Record updated" : "Record created");
    setEditing(null);
  }

  async function deleteRecord(rec: any) {
    Alert.alert(`Delete "${rec.title}"?`, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await save((v) => ({ ...v, items: (v.items ?? []).filter((i: any) => i.id !== rec.id) }), "Record deleted");
        setEditing(null);
      }}
    ]);
  }

  if (editing) {
    return <RecordEditor record={editing} area={area} onCancel={() => setEditing(null)} onSave={saveRecord} onDelete={() => deleteRecord(editing)} />;
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Vault</LinkText>
            <Eyebrow>{area.label}</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 20 }}>{area.label}</H1>
          <Footnote style={{ marginTop: 8, color: colors.text2 }}>{area.description}</Footnote>

          <PrimaryButton
            onPress={() => setEditing({ title: "", type: area.types[0], username: "", secret: "", notes: "", emergencyEligible: true, attachments: [] })}
            label="Add record"
            style={{ marginTop: 20 }}
          />

          <Divider space={24} />

          {records.length === 0 ? (
            <Card>
              <Body style={{ color: colors.text2 }}>No records yet. Add one above.</Body>
            </Card>
          ) : records.map((r: any) => (
            <Pressable key={r.id} onPress={() => setEditing(r)}>
              <Card style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <H3>{r.title || "Untitled"}</H3>
                  <StatusPill label={r.emergencyEligible ? "Emergency" : "Owner only"} tone={r.emergencyEligible ? "green" : "neutral"} />
                </View>
                {!!r.username && <Footnote style={{ marginTop: 4 }}>{r.username}</Footnote>}
                {!!r.notes && <Footnote numberOfLines={2} style={{ marginTop: 6, color: colors.text2 }}>{r.notes}</Footnote>}
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function RecordEditor({ record, area, onCancel, onSave, onDelete }: {
  record: any; area: { label: string; types: string[] };
  onCancel: () => void; onSave: (rec: any) => Promise<void>; onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<any>(record);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function commit() {
    if (!draft.title?.trim()) return;
    setBusy(true);
    try { await onSave(draft); } finally { setBusy(false); }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={onCancel}>‹ Back</LinkText>
            <Eyebrow>{record.id ? "Edit record" : "New record"}</Eyebrow>
            <View style={{ width: 60 }} />
          </View>

          <View style={{ marginTop: 16, gap: 4 }}>
            <Field label="Title">
              <Input value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="HDFC salary account" />
            </Field>
            <Field label="Type">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {TYPES.filter(([t]) => area.types.includes(t as string)).map(([t, label]) => (
                  <Pressable key={t} onPress={() => setDraft({ ...draft, type: t })}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
                      backgroundColor: draft.type === t ? colors.text : "transparent",
                      borderWidth: 1, borderColor: draft.type === t ? colors.text : colors.divider
                    }}>
                    <Footnote style={{ color: draft.type === t ? "#fff" : colors.text }}>{label}</Footnote>
                  </Pressable>
                ))}
              </ScrollView>
            </Field>
            <Field label="Identifier · username / account / policy">
              <Input value={draft.username} onChangeText={(t) => setDraft({ ...draft, username: t })} />
            </Field>
            <Field label="Sensitive value · password / PIN / key" hint={reveal ? undefined : "Tap reveal to see"}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Input value={draft.secret} onChangeText={(t) => setDraft({ ...draft, secret: t })} secureTextEntry={!reveal} style={{ flex: 1 }} />
                <Pressable onPress={() => setReveal((v) => !v)} style={{ paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderColor: colors.divider, borderRadius: radii.sm }}>
                  <Footnote>{reveal ? "Hide" : "Reveal"}</Footnote>
                </Pressable>
                {!!draft.secret && (
                  <Pressable onPress={() => Clipboard.setStringAsync(draft.secret).catch(() => {})} style={{ paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderColor: colors.divider, borderRadius: radii.sm }}>
                    <Footnote>Copy</Footnote>
                  </Pressable>
                )}
              </View>
            </Field>
            <Field label="Notes">
              <Input value={draft.notes} onChangeText={(t) => setDraft({ ...draft, notes: t })} multiline numberOfLines={5}
                style={{ minHeight: 110, textAlignVertical: "top" }} />
            </Field>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View>
                  <Body style={{ fontWeight: "600" }}>Include in emergency release</Body>
                  <Footnote style={{ marginTop: 2 }}>If you die or are incapacitated, this record goes to your nominee. Off = owner only.</Footnote>
                </View>
                <Pressable
                  onPress={() => setDraft({ ...draft, emergencyEligible: !draft.emergencyEligible })}
                  style={{
                    width: 44, height: 26, borderRadius: 13, padding: 3,
                    backgroundColor: draft.emergencyEligible ? colors.greenInk : "#c7c7cc",
                    justifyContent: "center", alignItems: draft.emergencyEligible ? "flex-end" : "flex-start"
                  }}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
                </Pressable>
              </View>
            </Card>
          </View>

          <PrimaryButton onPress={commit} busy={busy} disabled={!draft.title?.trim()} label="Save" style={{ marginTop: 20 }} />
          {record.id && onDelete && (
            <View style={{ alignItems: "center", marginTop: 16 }}>
              <LinkText onPress={onDelete} style={{ color: colors.redInk }}>Delete record</LinkText>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

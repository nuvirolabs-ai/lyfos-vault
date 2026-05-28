// Vault tab — Life Map + Capture + Release in a top sub-nav.
// Day 3 fills in the workspace; Day 5 fills in Release.

import React, { useState, useMemo } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, H2, H3, Body, Footnote, PrimaryButton, LinkText, Card, StatusPill, Divider } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { colors, radii } from "../../src/theme";

const TABS = ["life", "capture", "release"] as const;
type SubTab = typeof TABS[number];

export default function VaultTab() {
  const [tab, setTab] = useState<SubTab>("life");
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Vault</Eyebrow>
          <Pressable onPress={() => router.push("/settings")}><Footnote style={{ color: colors.text3 }}>Settings →</Footnote></Pressable>
        </View>

        <View style={{ alignItems: "center", paddingVertical: 8 }}>
          <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.divider, padding: 4 }}>
            {TABS.map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 6, borderRadius: radii.pill,
                  backgroundColor: tab === t ? colors.text : "transparent"
                }}
              >
                <Footnote style={{ color: tab === t ? "#fff" : colors.text2, fontWeight: "600" }}>
                  {t === "life" ? "Life Map" : t === "capture" ? "Capture" : "Release"}
                </Footnote>
              </Pressable>
            ))}
          </View>
        </View>

        {tab === "life"    && <LifeMapPane />}
        {tab === "capture" && <CapturePane />}
        {tab === "release" && <ReleasePane />}
      </SafeAreaView>
    </Screen>
  );
}

// ============================================================
// Life Map — 6 dossier categories
// ============================================================
const LIFE_AREAS = [
  { id: "identity",  label: "Identity",  promise: "IDs, certificates, legal proof", types: ["identity_document"] },
  { id: "money",     label: "Money",     promise: "Accounts, cards, balances, obligations", types: ["bank_account", "card"] },
  { id: "access",    label: "Access",    promise: "Passwords, PINs, recovery routes", types: ["password", "pin", "email_account"] },
  { id: "insurance", label: "Insurance", promise: "Policies, claims, nominee evidence", types: ["insurance_policy"] },
  { id: "documents", label: "Documents", promise: "Property, tax, legal records", types: ["important_document"] },
  { id: "emergency", label: "Emergency", promise: "First 72 hours plan", types: ["emergency_instruction"] }
];

function LifeMapPane() {
  const { vault } = useApp();
  if (!vault) return null;
  const items = vault.items ?? [];

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const area of LIFE_AREAS) {
      out[area.id] = items.filter((i: any) => area.types.includes(i.type)).length;
    }
    return out;
  }, [items]);

  const totalProtected = items.length > 0 ? LIFE_AREAS.filter((a) => counts[a.id] > 0).length : 0;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
      <View style={{ alignItems: "center", marginTop: 12 }}>
        <H1 style={{ textAlign: "center" }}>{totalProtected} of {LIFE_AREAS.length} areas protected</H1>
        <Footnote style={{ marginTop: 6, color: colors.text3 }}>
          {totalProtected === LIFE_AREAS.length ? "Every life area has at least one record." : "Tap an area to add records."}
        </Footnote>
      </View>

      <View style={{ marginTop: 28, flexDirection: "row", flexWrap: "wrap" }}>
        {LIFE_AREAS.map((a, i) => (
          <View key={a.id} style={{ width: "50%", padding: 6 }}>
            <Pressable
              onPress={() => router.push(`/area/${a.id}`)}
              style={{
                backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.divider,
                padding: 14, minHeight: 130
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: counts[a.id] > 0 ? colors.greenInk : colors.text4 }} />
                <Footnote style={{ color: colors.text4 }}>{String(i + 1).padStart(2, "0")}</Footnote>
              </View>
              <H3 style={{ marginTop: 28 }}>{a.label}</H3>
              <Footnote style={{ marginTop: 4 }} numberOfLines={2}>{a.promise}</Footnote>
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, alignItems: "center" }}>
                <Footnote style={{ color: colors.text3 }}>{counts[a.id]} {counts[a.id] === 1 ? "record" : "records"}</Footnote>
                <Footnote style={{ color: counts[a.id] > 0 ? colors.greenInk : colors.text3, fontWeight: "500" }}>
                  {counts[a.id] > 0 ? "Protected" : "Empty"}
                </Footnote>
              </View>
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function CapturePane() {
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 60 }}>
      <H1>Drop in the mess.</H1>
      <Body style={{ marginTop: 12, color: colors.text2 }}>
        Paste a note or attach proof. We propose a draft; you decide what becomes a record.
      </Body>
      <PrimaryButton onPress={() => router.push("/capture")} label="Start a capture" style={{ marginTop: 32 }} />
    </ScrollView>
  );
}

function ReleasePane() {
  const { session, entitlements } = useApp();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 60 }}>
      {!session ? (
        <Card tone="amber">
          <Footnote style={{ color: colors.amberInk, fontWeight: "600" }}>PLANNING MODE</Footnote>
          <Body style={{ marginTop: 6, color: colors.amberInk }}>
            Sign in to activate the real release service. Without an account this is a planning tool only.
          </Body>
        </Card>
      ) : !entitlements.releaseEnabled ? (
        <Card tone="amber">
          <Footnote style={{ color: colors.amberInk, fontWeight: "600" }}>UPGRADE REQUIRED</Footnote>
          <Body style={{ marginTop: 6, color: colors.amberInk }}>
            The release service requires the Vault or Family plan. Open Settings → Billing to upgrade.
          </Body>
          <PrimaryButton onPress={() => router.push("/settings")} label="Go to Settings" style={{ marginTop: 16 }} />
        </Card>
      ) : (
        <View>
          <H1>Build your circle of five.</H1>
          <Body style={{ marginTop: 12, color: colors.text2 }}>
            Five trusted humans. Three of them, plus a 14-day hold, are required to release your vault.
          </Body>
          <PrimaryButton onPress={() => router.push("/release-plan")} label="Open release plan" style={{ marginTop: 24 }} />
        </View>
      )}
    </ScrollView>
  );
}

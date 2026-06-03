// Monthly update — bulk mode by default on mobile (one-step-per-account
// is too tap-heavy on a small screen).

import React, { useMemo, useState } from "react";
import { ScrollView, View, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { Screen, Eyebrow, H1, Body, Footnote, PrimaryButton, LinkText, Card, Divider } from "../src/ui";
import { useApp } from "../src/AppContext";
import { BALANCE_SHEET_CATEGORIES, monthKey, monthLabel, snapshotForMonth, netWorthFromValues } from "../src/lib/balanceSheet";
import { formatCurrency, formatCompact } from "../src/lib/currency";
import { colors, radii, typography } from "../src/theme";

export default function UpdateScreen() {
  const { vault, save } = useApp();
  const params = useLocalSearchParams<{ mode?: string }>();
  if (!vault) return null;

  const bs = vault.balanceSheet ?? { accounts: [], snapshots: [] };
  const accounts = bs.accounts ?? [];
  const key = monthKey();
  const existing = snapshotForMonth(bs.snapshots ?? [], key);
  const sortedSnaps = [...(bs.snapshots ?? [])].sort((a: any, b: any) => b.month.localeCompare(a.month));
  const previousSnap = existing ? sortedSnaps.find((s: any) => s.month < key) : sortedSnaps[0];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const acc of accounts) {
      const prev = existing?.values?.[acc.id] ?? previousSnap?.values?.[acc.id] ?? 0;
      seed[acc.id] = String(prev || "");
    }
    return seed;
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const numericValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of accounts) out[a.id] = Number(values[a.id]) || 0;
    return out;
  }, [values, accounts]);

  const preview = netWorthFromValues(accounts, numericValues);
  const prevNet = previousSnap ? netWorthFromValues(accounts, previousSnap.values).net : 0;
  const delta = previousSnap ? preview.net - prevNet : 0;

  function setCurrent(id: string, raw: string) {
    setValues((prev) => ({ ...prev, [id]: raw.replace(/[^0-9]/g, "") }));
  }

  async function commit() {
    setBusy(true);
    try {
      const finalValues: Record<string, number> = {};
      for (const a of accounts) finalValues[a.id] = Number(values[a.id]) || 0;
      const others = (bs.snapshots ?? []).filter((s: any) => s.month !== key);
      const snapshot = {
        id: existing?.id ?? ((globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)),
        month: key, takenAt: new Date().toISOString(), values: finalValues
      };
      await save((v) => ({ ...v, balanceSheet: { ...bs, snapshots: [...others, snapshot] } }), `Updated ${monthLabel(key)} numbers`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
            <Eyebrow>{monthLabel(key)} · saved</Eyebrow>
            <H1 style={{ ...typography.hero, marginTop: 16, fontSize: 48 }}>
              {delta >= 0 ? "+" : "−"}{formatCurrency(Math.abs(delta))}
            </H1>
            <Footnote style={{ marginTop: 6 }}>{delta >= 0 ? "Net worth up this month" : "Net worth down this month"}</Footnote>
            <Body style={{ marginTop: 24 }}>
              New net worth · <Body style={{ fontWeight: "600" }}>{formatCurrency(preview.net)}</Body>
            </Body>
            <PrimaryButton onPress={() => router.replace("/(tabs)/home")} label="Done" style={{ marginTop: 32 }} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  if (accounts.length === 0) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Body>Set up your accounts first.</Body>
          <PrimaryButton onPress={() => router.replace("/setup")} label="Set up balance sheet" style={{ marginTop: 16 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 160 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Home</LinkText>
            <Eyebrow>{monthLabel(key)}</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 16 }}>{existing ? "Revise" : "Update"} all numbers.</H1>

          <View style={{ marginTop: 24, gap: 16 }}>
            {BALANCE_SHEET_CATEGORIES.map((cat) => {
              const list = accounts.filter((a: any) => a.category === cat.id);
              if (list.length === 0) return null;
              return (
                <View key={cat.id}>
                  <Footnote style={{ ...typography.caption, color: colors.text3, paddingHorizontal: 4, marginBottom: 6 }}>
                    {cat.label.toUpperCase()}
                  </Footnote>
                  <Card style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
                    {list.map((acc: any, idx: number) => {
                      const prev = previousSnap?.values?.[acc.id] ?? 0;
                      const current = Number(values[acc.id]) || 0;
                      const d = current - prev;
                      return (
                        <View
                          key={acc.id}
                          style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                            paddingHorizontal: 14, paddingVertical: 10,
                            borderBottomWidth: idx === list.length - 1 ? 0 : 1, borderBottomColor: colors.divider2
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Body numberOfLines={1} style={{ fontWeight: "500" }}>{acc.name}</Body>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                              {prev > 0 ? <Footnote>Last · {formatCurrency(prev)}</Footnote> : <Footnote style={{ color: colors.text4 }}>First entry</Footnote>}
                              {prev > 0 && (
                                <Pressable onPress={() => setCurrent(acc.id, String(prev))}>
                                  <Footnote style={{ color: colors.text2, textDecorationLine: "underline" }}>same</Footnote>
                                </Pressable>
                              )}
                              {prev > 0 && current > 0 && d !== 0 && (
                                <Footnote style={{ color: d > 0 ? colors.greenInk : colors.redInk }}>
                                  {d > 0 ? "▲" : "▼"} {formatCompact(Math.abs(d))}
                                </Footnote>
                              )}
                            </View>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                            <Body style={{ color: colors.text4 }}>₹</Body>
                            <TextInput
                              value={values[acc.id] ?? ""}
                              onChangeText={(t) => setCurrent(acc.id, t)}
                              keyboardType="number-pad"
                              placeholder="0"
                              placeholderTextColor={colors.text4}
                              style={{
                                minWidth: 100, textAlign: "right",
                                color: acc.kind === "liability" ? colors.redInk : colors.text,
                                fontVariant: ["tabular-nums"], fontSize: 16, fontWeight: "500", paddingVertical: 4
                              }}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </Card>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Sticky save bar */}
        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28,
            borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.bg
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Footnote style={{ ...typography.caption, color: colors.text3 }}>NET WORTH</Footnote>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Body style={{ fontVariant: ["tabular-nums"], fontWeight: "600", fontSize: 18 }}>{formatCurrency(preview.net)}</Body>
                {previousSnap && delta !== 0 && (
                  <Footnote style={{ color: delta > 0 ? colors.greenInk : colors.redInk, fontWeight: "500" }}>
                    {delta > 0 ? "▲" : "▼"} {formatCompact(Math.abs(delta))}
                  </Footnote>
                )}
              </View>
            </View>
            <PrimaryButton onPress={commit} busy={busy} label={existing ? "Save changes" : "Save month"} style={{ minWidth: 140 }} />
          </View>
        </View>
      </SafeAreaView>
    </Screen>
  );
}

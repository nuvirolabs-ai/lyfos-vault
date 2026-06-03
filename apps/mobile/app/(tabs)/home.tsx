// Home — net worth + 12-month sparkline + breakdown + update CTA.
// Mirror of the web HomeScreen, adapted for mobile.

import React, { useMemo } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, H2, H3, Body, Footnote, PrimaryButton, SecondaryButton, LinkText, Card, Divider, StatusPill } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { buildMonthlySeries, monthKey, monthLabel, shortMonthLabel, snapshotForMonth } from "../../src/lib/balanceSheet";
import { formatCurrency, formatCompact } from "../../src/lib/currency";
import { colors, radii, typography } from "../../src/theme";

export default function HomeScreen() {
  const { vault, lock, signOut, session } = useApp();
  if (!vault) return null;

  const bs = vault.balanceSheet ?? { accounts: [], snapshots: [] };
  const hasAccounts = (bs.accounts ?? []).length > 0;
  const currentKey = monthKey();
  const currentSnap = snapshotForMonth(bs.snapshots ?? [], currentKey);
  const needsUpdate = !currentSnap;
  const series = useMemo(() => buildMonthlySeries(bs, 12), [bs]);
  const last = series[series.length - 1];
  const prev = [...series].slice(0, -1).reverse().find((s) => !s.empty);
  const delta = prev ? last.net - prev.net : 0;

  if (!hasAccounts) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 40, paddingBottom: 80 }}>
            <Eyebrow>Welcome</Eyebrow>
            <H1 style={{ marginTop: 16 }}>Your wealth, in one number.</H1>
            <Body style={{ marginTop: 14, color: colors.text2 }}>
              Add your accounts once. Update them in five minutes each month. Watch the line move.
            </Body>
            <PrimaryButton onPress={() => router.push("/setup")} label="Set up balance sheet" style={{ marginTop: 32 }} />
            <View style={{ alignItems: "center", marginTop: 24 }}>
              <LinkText onPress={() => router.push("/(tabs)/vault")}>Or open the vault directly →</LinkText>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 36, paddingBottom: 100 }}>
          {/* Top bar */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <Eyebrow>{monthLabel(currentKey)}</Eyebrow>
            <Pressable onPress={() => router.push("/settings")}>
              <Footnote style={{ color: colors.text3 }}>Settings →</Footnote>
            </Pressable>
          </View>

          {/* Hero */}
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <H1 style={{ ...typography.hero, fontSize: 56, color: colors.text }}>
              {formatCurrency(last.net)}
            </H1>
            <Footnote style={{ marginTop: 6, color: colors.text2 }}>Net worth</Footnote>
            {prev && delta !== 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                <StatusPill label={`${delta >= 0 ? "▲" : "▼"} ${formatCompact(Math.abs(delta))} this month`} tone={delta >= 0 ? "green" : "red"} />
              </View>
            )}
          </View>

          {/* Sparkline */}
          <View style={{ marginTop: 12 }}>
            <NetWorthSparkline series={series} />
          </View>

          <Divider space={28} />

          <BreakdownRow label="Assets" value={last.assets} />
          <BreakdownRow label="Liabilities" value={-last.liabilities} muted />

          <View style={{ marginTop: 32, alignItems: "center" }}>
            <PrimaryButton
              onPress={() => router.push(needsUpdate ? "/update" : "/update?mode=revise")}
              label={needsUpdate ? `Update ${shortMonthLabel(currentKey)} numbers` : `Revise ${shortMonthLabel(currentKey)} numbers`}
              style={{ minWidth: 220 }}
            />
            {needsUpdate && (
              <Footnote style={{ marginTop: 12, color: colors.text4 }}>
                Five minutes once a month. Your sparkline keeps moving.
              </Footnote>
            )}
          </View>

          <Divider space={36} />

          <H3>Breakdown</H3>
          <CategoryBreakdown bs={bs} values={(currentSnap ?? (prev ? snapshotForMonth(bs.snapshots, prev.month) : null))?.values ?? {}} />

          <View style={{ marginTop: 12, alignItems: "center" }}>
            <LinkText onPress={() => router.push("/setup")}>Manage accounts</LinkText>
          </View>

          <Divider space={36} />

          <View style={{ alignItems: "center" }}>
            <LinkText onPress={() => router.push("/(tabs)/vault")}>
              Life Map · {vault.items?.length ?? 0} {vault.items?.length === 1 ? "dossier" : "dossiers"} →
            </LinkText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function BreakdownRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <Footnote style={{ ...typography.caption, color: colors.text3 }}>{label.toUpperCase()}</Footnote>
      <Body style={{ fontVariant: ["tabular-nums"], fontWeight: "600", color: muted ? colors.text2 : colors.text }}>{formatCurrency(value)}</Body>
    </View>
  );
}

function CategoryBreakdown({ bs, values }: { bs: any; values: Record<string, number> }) {
  const grouped = useMemo(() => {
    const byCat = new Map<string, { label: string; kind: string; total: number; count: number }>();
    for (const a of bs.accounts ?? []) {
      const v = Number(values?.[a.id] ?? 0) || 0;
      const slot = byCat.get(a.category) ?? { label: a.category, kind: a.kind, total: 0, count: 0 };
      slot.total += v; slot.count += 1; slot.label = a.category; slot.kind = a.kind;
      byCat.set(a.category, slot);
    }
    return [...byCat.entries()].filter(([_, g]) => g.count > 0);
  }, [bs, values]);

  if (grouped.length === 0) return null;
  return (
    <View style={{ marginTop: 12 }}>
      {grouped.map(([id, g]) => (
        <View key={id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: g.kind === "liability" ? colors.redInk : colors.text }} />
            <Body>{labelForCategory(id)}</Body>
            <Footnote style={{ color: colors.text4 }}>{g.count}</Footnote>
          </View>
          <Body style={{ fontVariant: ["tabular-nums"], fontWeight: "600", color: g.kind === "liability" ? colors.redInk : colors.text }}>
            {g.kind === "liability" ? "−" : ""}{formatCurrency(g.total).replace("−","")}
          </Body>
        </View>
      ))}
    </View>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash & bank", investments: "Investments", real_estate: "Real estate",
  gold: "Gold & jewellery", vehicles: "Vehicles", crypto: "Crypto",
  other_asset: "Other assets", home_loan: "Home loan", personal_loan: "Personal loan",
  car_loan: "Vehicle loan", credit_card: "Credit card", other_debt: "Other debt"
};
function labelForCategory(id: string) { return CATEGORY_LABELS[id] ?? id; }

// ============================================================
// Sparkline — SVG, no external chart lib
// ============================================================
function NetWorthSparkline({ series }: { series: any[] }) {
  const nonEmpty = series.filter((s) => !s.empty);
  if (nonEmpty.length < 2) {
    return <Footnote style={{ textAlign: "center" }}>A line will appear after your second monthly update.</Footnote>;
  }
  const W = 320, H = 80, P = 6;
  const values = series.map((s) => s.net);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = (W - P * 2) / (series.length - 1);
  const points = series.map((s, i) => {
    const x = P + i * step;
    const y = P + (H - P * 2) * (1 - (s.net - min) / range);
    return { x, y, ...s };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${points[points.length - 1].x.toFixed(1)} ${H - P} L ${P} ${H - P} Z`;
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={colors.text} stopOpacity="0.10" />
          <Stop offset="100%" stopColor={colors.text} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#g)" />
      <Path d={path} stroke={colors.text} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3 : (p.carried ? 1.2 : 1.6)} fill={p.carried ? "#c7c7cc" : colors.text} />
      ))}
    </Svg>
  );
}

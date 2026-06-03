// Manage accounts — add / rename / remove per category.
// Doubles as first-time setup when balance sheet is empty.

import React, { useMemo, useState } from "react";
import { ScrollView, View, Alert, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, H3, Body, Footnote, Field, Input, PrimaryButton, LinkText, Card } from "../src/ui";
import { useApp } from "../src/AppContext";
import { BALANCE_SHEET_CATEGORIES, categoryById, monthKey, snapshotForMonth } from "../src/lib/balanceSheet";
import { colors, radii } from "../src/theme";

export default function SetupScreen() {
  const { vault, save } = useApp();
  if (!vault) return null;
  const existing = vault.balanceSheet?.accounts ?? [];
  const isManage = existing.length > 0;
  const [accounts, setAccounts] = useState<any[]>(existing);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const byCat = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const c of BALANCE_SHEET_CATEGORIES) m.set(c.id, []);
    for (const a of accounts) m.get(a.category)?.push(a);
    return m;
  }, [accounts]);

  function addAccount(catId: string) {
    if (!draftName.trim()) return;
    const cat = categoryById(catId);
    if (!cat) return;
    setAccounts((prev) => [...prev, {
      id: `acc_${(globalThis as any).crypto?.randomUUID?.().slice(0,8) ?? Math.random().toString(36).slice(2,10)}`,
      category: catId, kind: cat.kind, name: draftName.trim(),
      createdAt: new Date().toISOString()
    }]);
    setDraftName("");
  }

  function removeAccount(id: string) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    const hasHistory = vault?.balanceSheet?.snapshots?.some((s: any) => (s.values?.[id] ?? 0) > 0);
    if (hasHistory) {
      Alert.alert(
        `Remove "${acc.name}"?`,
        `Past values stay in your monthly history but stop counting toward future net worth.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => setAccounts((prev) => prev.filter((a) => a.id !== id)) }
        ]
      );
    } else {
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    }
  }

  async function finish() {
    if (accounts.length === 0) return;
    setBusy(true);
    try {
      const bs = vault.balanceSheet ?? { accounts: [], snapshots: [], goal: null };
      await save((v) => ({ ...v, balanceSheet: { ...bs, accounts } }), "Balance sheet accounts updated");
      // Route into the update flow if any newly added accounts lack a current-month value
      const currentSnap = snapshotForMonth(bs.snapshots ?? [], monthKey());
      const hasUnseen = accounts.some((a) => {
        const isNew = !existing.find((e: any) => e.id === a.id);
        return isNew && !currentSnap?.values?.[a.id];
      });
      router.replace(hasUnseen ? "/update" : "/(tabs)/home");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Back</LinkText>
            <Eyebrow>{isManage ? "Manage accounts" : "Set up balance sheet"}</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 20 }}>
            {isManage ? "Rename, add, or remove." : "List what you own and what you owe."}
          </H1>
          <Footnote style={{ marginTop: 12 }}>
            {isManage
              ? "Past monthly history stays attached to each account. Removed accounts stop counting from this month forward."
              : "Add an account name under each category. Values come next."}
          </Footnote>

          <View style={{ marginTop: 24, gap: 8 }}>
            {BALANCE_SHEET_CATEGORIES.map((cat) => {
              const list = byCat.get(cat.id) ?? [];
              const open = openCategory === cat.id;
              return (
                <Card key={cat.id} style={{ paddingVertical: 0, paddingHorizontal: 0 }}>
                  <Pressable
                    onPress={() => { setOpenCategory(open ? null : cat.id); setDraftName(""); }}
                    style={{ paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cat.kind === "liability" ? colors.redInk : colors.text }} />
                      <View>
                        <Body style={{ fontWeight: "600" }}>{cat.label}</Body>
                        <Footnote style={{ color: colors.text4 }}>{cat.hint}</Footnote>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {list.length > 0 && <Body style={{ fontWeight: "600", color: colors.text }}>{list.length}</Body>}
                      <Body style={{ color: colors.text3, transform: [{ rotate: open ? "90deg" : "0deg" }] }}>›</Body>
                    </View>
                  </Pressable>
                  {open && (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.divider2, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                      {list.map((acc) => (
                        <View key={acc.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.sm }}>
                          {renamingId === acc.id ? (
                            <Input
                              value={renameDraft}
                              onChangeText={setRenameDraft}
                              autoFocus
                              onBlur={() => { if (renameDraft.trim()) setAccounts((p) => p.map((a) => a.id === acc.id ? { ...a, name: renameDraft.trim() } : a)); setRenamingId(null); setRenameDraft(""); }}
                              style={{ flex: 1, paddingVertical: 6 }}
                            />
                          ) : (
                            <Pressable style={{ flex: 1 }} onPress={() => { setRenamingId(acc.id); setRenameDraft(acc.name); }}>
                              <Body>{acc.name}</Body>
                            </Pressable>
                          )}
                          <Pressable onPress={() => removeAccount(acc.id)}>
                            <Footnote style={{ color: colors.redInk }}>remove</Footnote>
                          </Pressable>
                        </View>
                      ))}
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Input
                          value={draftName}
                          onChangeText={setDraftName}
                          onSubmitEditing={() => addAccount(cat.id)}
                          placeholder={cat.id === "cash" ? "HDFC savings" : cat.id === "investments" ? "Equity mutual funds" : "Account name"}
                          style={{ flex: 1 }}
                        />
                        <Pressable
                          onPress={() => addAccount(cat.id)}
                          style={{ backgroundColor: colors.text, paddingHorizontal: 16, justifyContent: "center", borderRadius: radii.sm }}
                        >
                          <Body style={{ color: "#fff", fontWeight: "600" }}>Add</Body>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </Card>
              );
            })}
          </View>

          <PrimaryButton
            onPress={finish}
            disabled={accounts.length === 0}
            busy={busy}
            label={accounts.length === 0
              ? "Add at least one account"
              : isManage
                ? `Save · ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`
                : `Continue · ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
            style={{ marginTop: 28 }}
          />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

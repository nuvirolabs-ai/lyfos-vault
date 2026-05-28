// Settings — mirror of the web's SettingsDrawer. Stacked sections:
// Account · Billing · Devices · Balance sheet goal · Biometric ·
// Vault · Danger zone.

import React, { useEffect, useState } from "react";
import { ScrollView, View, Alert, Pressable, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Linking from "expo-linking";

import { Screen, Eyebrow, H1, H3, Body, Footnote, Field, Input, PrimaryButton, SecondaryButton, LinkText, Card, Divider, DangerButton, StatusPill } from "../src/ui";
import { useApp } from "../src/AppContext";
import {
  fetchMyBillingEvents, fetchInvoiceUrl,
  startUpgrade, openCheckoutInBrowser, cancelSubscriptionAtPeriodEnd, resumeSubscription
} from "../src/lib/billing";
import { listDevices, renameDevice, revokeDevice } from "../src/lib/vaultSync";
import { planFor, daysLeftFor } from "../src/lib/plans";
import {
  isBiometricAvailable, enableBiometricUnlock, disableBiometricUnlock, biometricUnlockConfigured
} from "../src/lib/biometric";
import { deleteAccount } from "../src/lib/auth";
import { formatCurrency } from "../src/lib/currency";
import { getDeviceToken } from "../src/lib/storage";
import { colors, radii } from "../src/theme";

export default function SettingsScreen() {
  const { session, subscription, entitlements, refreshSubscription, signOut, deleteLocalVault,
          autoLockMs, setAutoLockMs, biometricEnabled, setBiometricEnabled,
          vault, save } = useApp();

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Back</LinkText>
            <Eyebrow>Settings</Eyebrow>
            <View style={{ width: 60 }} />
          </View>

          {session && <AccountSection email={session.user?.email ?? ""} onSignOut={signOut} />}
          {session && (
            <BillingSection
              subscription={subscription}
              entitlements={entitlements}
              onChanged={refreshSubscription}
            />
          )}
          {session && <DevicesSection />}

          <GoalSection vault={vault} onSave={save} />

          <SecuritySection
            autoLockMs={autoLockMs}
            setAutoLockMs={setAutoLockMs}
            biometricEnabled={biometricEnabled}
            setBiometricEnabled={setBiometricEnabled}
          />

          <Divider space={28} />

          <Eyebrow>Danger zone</Eyebrow>
          <View style={{ marginTop: 10, gap: 10 }}>
            <Card tone="danger">
              <Body style={{ fontWeight: "600", color: colors.redInk }}>Delete this local vault</Body>
              <Footnote style={{ marginTop: 4 }}>Without an export, you'll lose everything on this device. Doesn't touch your account or other devices.</Footnote>
              <DangerButton
                onPress={() => Alert.alert(
                  "Delete local vault?",
                  "This cannot be undone.",
                  [{ text: "Cancel", style: "cancel" },
                   { text: "Delete", style: "destructive", onPress: deleteLocalVault }]
                )}
                label="Delete local vault"
              />
            </Card>
            {session && <DeleteAccountCard />}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

// ============================================================
// Account
// ============================================================
function AccountSection({ email, onSignOut }: { email: string; onSignOut: () => Promise<void> }) {
  return (
    <View style={{ marginTop: 24 }}>
      <Eyebrow>Account</Eyebrow>
      <Card style={{ marginTop: 10 }}>
        <Body style={{ fontWeight: "600" }}>{email || "Signed in"}</Body>
        <Footnote style={{ marginTop: 4 }}>Cloud sync is live. Your vault is encrypted locally before upload — Lyfos cannot read it.</Footnote>
        <SecondaryButton onPress={() => onSignOut()} label="Sign out" style={{ marginTop: 12 }} />
      </Card>
    </View>
  );
}

// ============================================================
// Billing
// ============================================================
function BillingSection({ subscription, entitlements, onChanged }: { subscription: any; entitlements: any; onChanged: () => Promise<void> }) {
  const [events, setEvents] = useState<any[]>([]);
  const [showPlans, setShowPlans] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetchMyBillingEvents().then(setEvents).catch(() => {}); }, []);
  const days = daysLeftFor(subscription);

  async function upgrade(plan: "vault" | "family") {
    setBusy(true); setError("");
    try {
      const result = await startUpgrade({ plan });
      if (result?.checkoutUrl) await openCheckoutInBrowser(result.checkoutUrl);
      else setError("Upgrade started but no checkout URL was returned.");
    } catch (e: any) { setError(e?.message || "Upgrade failed."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    Alert.alert("Cancel at period end?", "You'll keep access until then.", [
      { text: "Keep", style: "cancel" },
      { text: "Cancel subscription", style: "destructive", onPress: async () => {
        try { await cancelSubscriptionAtPeriodEnd(); await onChanged(); }
        catch (e: any) { setError(e?.message); }
      }}
    ]);
  }
  async function resume() {
    try { await resumeSubscription(); await onChanged(); }
    catch (e: any) { setError(e?.message); }
  }
  async function openInvoice(path: string) {
    try { const url = await fetchInvoiceUrl(path); if (url) await Linking.openURL(url); }
    catch (e: any) { setError(e?.message); }
  }

  return (
    <View style={{ marginTop: 24 }}>
      <Eyebrow>Billing</Eyebrow>
      <Card style={{ marginTop: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <Body style={{ fontWeight: "600" }}>Lyfos {entitlements.label}</Body>
            <Footnote style={{ marginTop: 2 }}>
              {(!subscription || subscription.plan === "free")
                ? "Free tier · upgrade to enable the release service"
                : subscription.status === "active"     ? `Active${days !== null ? ` · renews in ${days} day${days === 1 ? "" : "s"}` : ""}`
                : subscription.status === "past_due"   ? `Past due · ${days ?? "?"} days of grace remain`
                : subscription.status === "trialing"   ? `Trialing${days !== null ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}`
                : subscription.status === "cancelled"  ? `Cancelled · access until ${days} day${days === 1 ? "" : "s"}`
                : `Status · ${subscription.status}`}
            </Footnote>
            {subscription?.cancel_at_period_end && (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8 }}>
                <Footnote style={{ color: colors.redInk, fontWeight: "500" }}>Will not renew.</Footnote>
                <LinkText onPress={resume}>Resume</LinkText>
              </View>
            )}
          </View>
          {(!subscription || subscription.plan === "free")
            ? <PrimaryButton onPress={() => setShowPlans((v) => !v)} busy={busy} label="Upgrade" style={{ paddingVertical: 10, paddingHorizontal: 18 }} />
            : <SecondaryButton onPress={cancel} disabled={busy || subscription?.cancel_at_period_end} label="Cancel" />
          }
        </View>

        {error ? <Footnote style={{ marginTop: 6, color: colors.redInk }}>{error}</Footnote> : null}

        {showPlans && (
          <View style={{ marginTop: 12, gap: 12, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 }}>
            {(["vault", "family"] as const).map((pid) => {
              const p = planFor(pid);
              return (
                <Card key={pid} style={{ backgroundColor: colors.bg }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                    <Body style={{ fontWeight: "600" }}>Lyfos {p.label}</Body>
                    <Body style={{ fontWeight: "600" }}>{formatCurrency(p.amountInr / 100, "INR")}<Footnote> / year</Footnote></Body>
                  </View>
                  <Footnote style={{ marginTop: 2 }}>{p.summary}</Footnote>
                  <View style={{ marginTop: 8 }}>
                    {p.bullets.map((b) => <Footnote key={b}>• {b}</Footnote>)}
                  </View>
                  <PrimaryButton onPress={() => upgrade(pid)} busy={busy} label={`Choose ${p.label}`} style={{ marginTop: 10 }} />
                </Card>
              );
            })}
          </View>
        )}
      </Card>

      <Eyebrow style={{ marginTop: 16 }}>Invoices</Eyebrow>
      {events.length === 0 ? (
        <Footnote style={{ marginTop: 6, paddingHorizontal: 4 }}>No invoices yet.</Footnote>
      ) : (
        <View style={{ marginTop: 8, gap: 6 }}>
          {events.filter((e) => e.invoice_pdf_path).map((e) => (
            <Pressable key={e.id} onPress={() => openInvoice(e.invoice_pdf_path)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <View>
                    <Body style={{ fontWeight: "500" }}>{e.invoice_number}</Body>
                    <Footnote>{new Date(e.created_at).toLocaleDateString()}</Footnote>
                  </View>
                  <Body style={{ fontVariant: ["tabular-nums"], fontWeight: "600" }}>
                    {e.amount_paise != null ? formatCurrency(e.amount_paise / 100, e.currency || "INR") : "—"}
                  </Body>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ============================================================
// Devices
// ============================================================
function DevicesSection() {
  const [devices, setDevices] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [currentToken, setCurrentToken] = useState<string | null>(null);

  async function refresh() {
    setDevices(await listDevices().catch(() => []));
    setCurrentToken(await getDeviceToken());
  }
  useEffect(() => { refresh(); }, []);

  async function commitRename(id: string) {
    const label = draft.trim();
    if (label) await renameDevice(id, label).catch(() => {});
    setEditingId(null); setDraft(""); await refresh();
  }
  async function revoke(id: string) {
    Alert.alert("Sign out this device?", "It can sign back in with the account password and the vault phrase.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: async () => { await revokeDevice(id); await refresh(); } }
    ]);
  }

  return (
    <View style={{ marginTop: 24 }}>
      <Eyebrow>Devices</Eyebrow>
      <View style={{ marginTop: 10, gap: 8 }}>
        {devices.length === 0 ? (
          <Footnote style={{ paddingHorizontal: 4 }}>No other devices signed in.</Footnote>
        ) : devices.map((d) => {
          const isCurrent = d.device_token === currentToken;
          return (
            <Card key={d.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  {editingId === d.id ? (
                    <Input value={draft} onChangeText={setDraft} autoFocus onBlur={() => commitRename(d.id)} />
                  ) : (
                    <Pressable onPress={() => { setEditingId(d.id); setDraft(d.label ?? ""); }}>
                      <Body style={{ fontWeight: "500" }}>{d.label || "Untitled device"}</Body>
                    </Pressable>
                  )}
                  <Footnote style={{ marginTop: 2 }}>
                    Last seen {new Date(d.last_seen_at).toLocaleString()} {isCurrent ? "· this device" : ""}
                  </Footnote>
                </View>
                {!isCurrent && (
                  <Pressable onPress={() => revoke(d.id)}>
                    <Footnote style={{ color: colors.redInk }}>Sign out</Footnote>
                  </Pressable>
                )}
              </View>
            </Card>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================
// Balance sheet goal
// ============================================================
function GoalSection({ vault, onSave }: { vault: any; onSave: (m: (v: any) => any, label?: string) => Promise<void> }) {
  const goal = vault?.balanceSheet?.goal ?? null;
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(goal?.label ?? "");
  const [target, setTarget] = useState(goal?.targetNet ? String(goal.targetNet) : "");
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const [busy, setBusy] = useState(false);

  async function commit() {
    const n = Number(target);
    if (!n || n <= 0) return;
    setBusy(true);
    try {
      await onSave((v) => ({
        ...v,
        balanceSheet: { ...(v.balanceSheet ?? { accounts: [], snapshots: [] }), goal: {
          id: goal?.id ?? ((globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)),
          label: label.trim() || null,
          targetNet: n,
          targetDate: date || null,
          createdAt: goal?.createdAt ?? new Date().toISOString()
        } }
      }), "Goal updated");
      setEditing(false);
    } finally { setBusy(false); }
  }
  async function clear() {
    await onSave((v) => ({ ...v, balanceSheet: { ...v.balanceSheet, goal: null } }), "Goal removed");
    setEditing(false);
  }

  return (
    <View style={{ marginTop: 24 }}>
      <Eyebrow>Balance sheet</Eyebrow>
      <Card style={{ marginTop: 10 }}>
        {!editing ? (
          <View>
            <Body style={{ fontWeight: "600" }}>{goal ? "Goal" : "Set a net-worth goal"}</Body>
            <Footnote style={{ marginTop: 4 }}>
              {goal ? `${goal.label || "Reach"} · ${formatCurrency(goal.targetNet)} by ${goal.targetDate ?? "no deadline"}` : "One goal at a time. Tracked on Home."}
            </Footnote>
            <SecondaryButton onPress={() => setEditing(true)} label={goal ? "Edit" : "Set goal"} style={{ marginTop: 12 }} />
          </View>
        ) : (
          <View>
            <Field label="Label · optional"><Input value={label} onChangeText={setLabel} placeholder="House down payment" /></Field>
            <Field label="Target net worth"><Input value={target} onChangeText={(t) => setTarget(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="10000000" /></Field>
            <Field label="By · YYYY-MM-DD"><Input value={date} onChangeText={setDate} placeholder="2027-12-31" autoCapitalize="none" autoCorrect={false} /></Field>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <LinkText onPress={() => setEditing(false)}>Cancel</LinkText>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {goal && <LinkText onPress={clear} style={{ color: colors.redInk }}>Remove</LinkText>}
                <PrimaryButton onPress={commit} busy={busy} disabled={!target} label="Save" style={{ paddingVertical: 8, paddingHorizontal: 16 }} />
              </View>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

// ============================================================
// Security · auto-lock + biometric
// ============================================================
function SecuritySection({ autoLockMs, setAutoLockMs, biometricEnabled, setBiometricEnabled }: {
  autoLockMs: number; setAutoLockMs: (ms: number) => Promise<void>;
  biometricEnabled: boolean; setBiometricEnabled: (b: boolean) => Promise<void>;
}) {
  const [bioAvail, setBioAvail] = useState(false);
  const [bioConfigured, setBioConfigured] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setBioAvail).catch(() => setBioAvail(false));
    biometricUnlockConfigured().then(setBioConfigured).catch(() => setBioConfigured(false));
  }, [biometricEnabled]);

  async function onToggleBio(v: boolean) {
    if (v) {
      Alert.prompt?.(
        "Enable Face ID / Touch ID",
        "Confirm your vault passphrase to enable biometric unlock.",
        async (pp) => {
          if (!pp) return;
          try {
            await enableBiometricUnlock(pp);
            await setBiometricEnabled(true);
            setBioConfigured(true);
          } catch (e: any) {
            Alert.alert("Couldn't enable", e?.message ?? "Try again.");
          }
        },
        "secure-text"
      );
    } else {
      await disableBiometricUnlock();
      await setBiometricEnabled(false);
      setBioConfigured(false);
    }
  }

  const lockOptions: { label: string; ms: number }[] = [
    { label: "1 minute",  ms: 60_000 },
    { label: "5 minutes", ms: 300_000 },
    { label: "15 minutes", ms: 900_000 },
    { label: "1 hour",    ms: 3_600_000 }
  ];

  return (
    <View style={{ marginTop: 24 }}>
      <Eyebrow>Security</Eyebrow>
      <Card style={{ marginTop: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Body style={{ fontWeight: "600" }}>Face ID / Touch ID unlock</Body>
            <Footnote style={{ marginTop: 2 }}>
              {bioAvail ? "Use biometrics to unlock without typing your passphrase." : "Biometric hardware not detected on this device."}
            </Footnote>
          </View>
          <Switch value={biometricEnabled && bioConfigured} disabled={!bioAvail} onValueChange={onToggleBio} />
        </View>
      </Card>
      <Card style={{ marginTop: 8 }}>
        <Body style={{ fontWeight: "600" }}>Auto-lock</Body>
        <Footnote style={{ marginTop: 2 }}>Locks after this much idle time, or instantly when the app goes to background.</Footnote>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {lockOptions.map((opt) => (
            <Pressable key={opt.ms} onPress={() => setAutoLockMs(opt.ms)}
              style={{
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
                backgroundColor: autoLockMs === opt.ms ? colors.text : "transparent",
                borderWidth: 1, borderColor: autoLockMs === opt.ms ? colors.text : colors.divider
              }}>
              <Footnote style={{ color: autoLockMs === opt.ms ? "#fff" : colors.text }}>{opt.label}</Footnote>
            </Pressable>
          ))}
        </View>
      </Card>
    </View>
  );
}

// ============================================================
// Delete account
// ============================================================
function DeleteAccountCard() {
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function doIt() {
    if (text !== "delete my account") { setError("Type exactly: delete my account"); return; }
    setBusy(true);
    try {
      await deleteAccount();
      router.replace("/(auth)/sign-in");
    } catch (e: any) { setError(e?.message ?? "Couldn't complete."); setBusy(false); }
  }

  if (!confirming) {
    return (
      <Pressable onPress={() => setConfirming(true)}>
        <Card tone="danger">
          <Body style={{ fontWeight: "600", color: colors.redInk }}>Delete account entirely</Body>
          <Footnote style={{ marginTop: 4 }}>
            Permanently removes your account and the encrypted blob from our servers. DPDPA / GDPR right to erasure.
          </Footnote>
        </Card>
      </Pressable>
    );
  }
  return (
    <Card tone="danger">
      <Body style={{ color: colors.redInk, fontWeight: "600" }}>This deletes everything.</Body>
      <Footnote style={{ marginTop: 6, color: colors.redInk }}>
        Your account, the encrypted vault on our servers, every device record, the audit log, and the local vault on this device.
      </Footnote>
      <Field label='Type "delete my account"'><Input value={text} onChangeText={setText} placeholder="delete my account" autoCapitalize="none" /></Field>
      {error ? <Footnote style={{ color: colors.redInk }}>{error}</Footnote> : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
        <LinkText onPress={() => { setConfirming(false); setText(""); setError(""); }}>Cancel</LinkText>
        <DangerButton onPress={doIt} busy={busy} label="Delete account" />
      </View>
    </Card>
  );
}

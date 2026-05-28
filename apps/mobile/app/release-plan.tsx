// Release plan — owner-side cloud flow. Mirror of CloudKeyHolders +
// FinalizeModal + ClaimUrlPanel on web.

import React, { useEffect, useState } from "react";
import { ScrollView, View, Pressable, Alert, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";

import { Screen, Eyebrow, H1, H2, H3, Body, Footnote, Field, Input, PrimaryButton, SecondaryButton, LinkText, Card, Divider, StatusPill, DangerButton } from "../src/ui";
import { useApp } from "../src/AppContext";
import {
  listMyKeyHolders, createKeyHolderInvite, revokeKeyHolder, sendInviteEmail, finalizeReleasePlan
} from "../src/lib/releasePlan";
import { loadMyReleaseSettings, upsertMyReleaseSettings, rotateMyClaimToken } from "../src/lib/releaseClaim";
import { useVaultKey } from "../src/useVaultKey";
import { colors, radii } from "../src/theme";

export default function ReleasePlanScreen() {
  const { entitlements, session } = useApp();
  const vaultKey = useVaultKey();

  const [holders, setHolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedbackUrl, setFeedbackUrl] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const accepted = holders.filter((h) => h.status === "accepted").length + holders.filter((h) => h.status === "verified").length;
  const verified = holders.filter((h) => h.status === "verified").length;
  const planActive = verified >= 5;
  const canPay = entitlements.releaseEnabled;
  const canFinalize = !planActive && holders.length === 5 && accepted === 5 && canPay;

  async function refresh() {
    setLoading(true); setError("");
    try { setHolders(await listMyKeyHolders()); }
    catch (e: any) { setError(e?.message || "Couldn't load."); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function invite(input: { label: string; email: string; phone?: string }) {
    setBusy(true); setError("");
    try {
      const created = await createKeyHolderInvite({ label: input.label, holderEmail: input.email, holderPhone: input.phone });
      const appUrl = (Constants?.expoConfig?.extra as any)?.APP_URL ?? "https://lyfos.signorvale.com";
      const url = `${appUrl}/invite/${created.invite_token}`;
      try { await sendInviteEmail(created.id); } catch {}
      setFeedbackUrl(url);
      setShowInvite(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Couldn't create invite.");
    } finally { setBusy(false); }
  }

  async function revoke(holder: any) {
    Alert.alert("Revoke invite?", `${holder.label} will no longer be a key holder.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => {
        try { await revokeKeyHolder(holder.id); await refresh(); } catch (e: any) { setError(e?.message); }
      }}
    ]);
  }

  if (!session) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 20 }}>
            <LinkText onPress={() => router.back()}>‹ Back</LinkText>
            <Card tone="amber" style={{ marginTop: 24 }}>
              <Footnote style={{ color: colors.amberInk, fontWeight: "600" }}>SIGN IN REQUIRED</Footnote>
              <Body style={{ marginTop: 6, color: colors.amberInk }}>
                Sign in to activate the real release service. Without an account this page is a planning tool only.
              </Body>
            </Card>
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Vault</LinkText>
            <Eyebrow>Release plan</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 18, textAlign: "center" }}>
            {planActive ? "Your circle is active." : "Build your circle of five."}
          </H1>
          <Footnote style={{ marginTop: 10, textAlign: "center", color: colors.text2 }}>
            Five trusted humans. Three of them, plus a 14-day hold, are required to release your vault to your nominee.
          </Footnote>

          {/* Readiness row */}
          <Card style={{ marginTop: 18 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Stat label="Invited"   value={String(holders.length)} good={holders.length === 5} />
              <Stat label="Accepted"  value={String(accepted)}       good={accepted === 5} />
              <Stat label="Verified"  value={String(verified)}       good={verified === 5} />
            </View>
          </Card>

          {error ? <Card tone="danger" style={{ marginTop: 12 }}><Body style={{ color: colors.redInk }}>{error}</Body></Card> : null}

          {feedbackUrl && (
            <Card tone="success" style={{ marginTop: 12 }}>
              <Footnote style={{ color: colors.greenInk, fontWeight: "600" }}>INVITE CREATED</Footnote>
              <Body style={{ marginTop: 4, color: colors.greenInk }}>
                We tried to email them. If it doesn't arrive, share this URL directly:
              </Body>
              <Body style={{ marginTop: 6, fontFamily: "Courier", fontSize: 11 }} selectable>{feedbackUrl}</Body>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                <LinkText onPress={() => Clipboard.setStringAsync(feedbackUrl).catch(() => {})}>Copy</LinkText>
                <LinkText onPress={() => setFeedbackUrl(null)}>Close</LinkText>
              </View>
            </Card>
          )}

          {/* Holders list */}
          <View style={{ marginTop: 20, gap: 10 }}>
            {holders.length === 0 && !loading && (
              <Card><Body style={{ color: colors.text2 }}>No key holders yet. Invite five people.</Body></Card>
            )}
            {holders.map((h) => (
              <Card key={h.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Body style={{ fontWeight: "600" }}>{h.label}</Body>
                    <Footnote numberOfLines={1}>{h.holder_email}</Footnote>
                  </View>
                  <StatusPill
                    label={h.status}
                    tone={h.status === "verified" ? "green" : h.status === "accepted" ? "green" : h.status === "revoked" ? "red" : "amber"}
                  />
                </View>
                <View style={{ alignItems: "flex-end", marginTop: 8 }}>
                  <Pressable onPress={() => revoke(h)}><Footnote style={{ color: colors.redInk }}>Revoke</Footnote></Pressable>
                </View>
              </Card>
            ))}
          </View>

          {/* Actions */}
          <View style={{ marginTop: 24, alignItems: "center" }}>
            {!planActive && holders.length < 5 && !showInvite && (
              <PrimaryButton onPress={() => setShowInvite(true)} label={`Invite key holder ${holders.length + 1} of 5`} />
            )}
            {showInvite && <InviteForm busy={busy} onCancel={() => setShowInvite(false)} onSubmit={invite} />}
            {!planActive && accepted === 5 && holders.length === 5 && !canPay && (
              <Card tone="amber" style={{ marginTop: 12 }}>
                <Footnote style={{ color: colors.amberInk, fontWeight: "600" }}>UPGRADE TO FINALIZE</Footnote>
                <Body style={{ marginTop: 4, color: colors.amberInk }}>
                  All 5 accepted. Finalizing splits your vault key into shares. Open Settings → Billing to upgrade.
                </Body>
                <PrimaryButton onPress={() => router.push("/settings")} label="Go to Settings" style={{ marginTop: 12 }} />
              </Card>
            )}
            {canFinalize && (
              <View style={{ alignItems: "center" }}>
                <PrimaryButton onPress={() => setFinalizeOpen(true)} label="Finalize plan" />
                <Footnote style={{ marginTop: 10, color: colors.text3, textAlign: "center" }}>
                  All 5 accepted. Finalize to split your vault key into shares.
                </Footnote>
              </View>
            )}
            {planActive && (
              <Footnote style={{ color: colors.greenInk, textAlign: "center" }}>
                Your circle is active. If something happens to you, 3 of 5 plus a 14-day hold are required to release.
              </Footnote>
            )}
          </View>

          {planActive && <ClaimUrlPanel />}
        </ScrollView>
      </SafeAreaView>

      <FinalizeModal
        open={finalizeOpen}
        acceptedHolders={holders.filter((h) => h.status === "accepted")}
        hasVaultKey={!!vaultKey}
        onCancel={() => setFinalizeOpen(false)}
        onConfirm={async () => {
          if (!vaultKey) { setError("Unlock your vault first."); return; }
          setBusy(true);
          try {
            const rawKey = vaultKey;
            await finalizeReleasePlan({ rawVaultKey: rawKey, holders: holders.filter((h) => h.status === "accepted") });
            setFinalizeOpen(false);
            await refresh();
          } catch (e: any) {
            setError(e?.message || "Couldn't finalize.");
          } finally { setBusy(false); }
        }}
        busy={busy}
      />
    </Screen>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <H2 style={{ color: good ? colors.greenInk : colors.text }}>{value}</H2>
      <Footnote style={{ marginTop: 2 }}>{label}</Footnote>
    </View>
  );
}

function InviteForm({ busy, onCancel, onSubmit }: {
  busy: boolean; onCancel: () => void; onSubmit: (input: { label: string; email: string; phone?: string }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <Card style={{ width: "100%" }}>
      <Footnote style={{ fontWeight: "600", color: colors.text3 }}>INVITE A KEY HOLDER</Footnote>
      <Field label="Label"><Input value={label} onChangeText={setLabel} placeholder="Vikram Sharma (brother)" autoCapitalize="words" /></Field>
      <Field label="Their email"><Input value={email} onChangeText={setEmail} placeholder="vikram@example.com" keyboardType="email-address" autoCapitalize="none" /></Field>
      <Field label="Their phone · optional, for SMS alerts">
        <Input value={phone} onChangeText={setPhone} placeholder="+91 98765 43210" keyboardType="phone-pad" />
      </Field>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
        <LinkText onPress={onCancel}>Cancel</LinkText>
        <PrimaryButton onPress={() => onSubmit({ label, email, phone })} disabled={!label || !email} busy={busy} label="Send invite" style={{ paddingVertical: 8, paddingHorizontal: 16 }} />
      </View>
    </Card>
  );
}

function ClaimUrlPanel() {
  const [settings, setSettings] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(""); const [email, setEmail] = useState(""); const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const s = await loadMyReleaseSettings().catch(() => null);
    setSettings(s); setLabel(s?.nominee_label ?? ""); setEmail(s?.nominee_email ?? ""); setText(s?.claim_text ?? "");
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    setBusy(true);
    try {
      const next = await upsertMyReleaseSettings({ nomineeLabel: label || undefined, nomineeEmail: email || undefined, claimText: text || undefined });
      setSettings(next); setEditing(false);
    } finally { setBusy(false); }
  }
  async function rotate() {
    Alert.alert("Rotate claim link?", "The old URL will stop working.", [
      { text: "Cancel", style: "cancel" },
      { text: "Rotate", style: "destructive", onPress: async () => { const n = await rotateMyClaimToken(); setSettings(n); } }
    ]);
  }

  const appUrl = (Constants?.expoConfig?.extra as any)?.APP_URL ?? "https://lyfos.signorvale.com";
  const url = settings?.claim_token ? `${appUrl}/claim/${settings.claim_token}` : null;

  return (
    <Card style={{ marginTop: 28 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Footnote style={{ fontWeight: "600", color: colors.text3 }}>CLAIM LINK FOR YOUR NOMINEE</Footnote>
        {settings && !editing && <LinkText onPress={() => setEditing(true)}>Edit</LinkText>}
      </View>
      {!settings && !editing && (
        <View style={{ marginTop: 12 }}>
          <Body style={{ color: colors.text2 }}>Generate a stable URL you share once with your nominee.</Body>
          <PrimaryButton onPress={() => setEditing(true)} label="Set up claim link" style={{ marginTop: 16 }} />
        </View>
      )}
      {settings && !editing && (
        <View style={{ marginTop: 8 }}>
          <Body>Nominee · <Body style={{ fontWeight: "600" }}>{settings.nominee_label || "—"}</Body></Body>
          {!!settings.claim_text && <Footnote style={{ marginTop: 6, color: colors.text2 }}>"{settings.claim_text}"</Footnote>}
          {url && (
            <View style={{ marginTop: 12 }}>
              <Body style={{ fontFamily: "Courier", fontSize: 11 }} selectable>{url}</Body>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                <LinkText onPress={() => Clipboard.setStringAsync(url).catch(() => {})}>Copy</LinkText>
                <LinkText onPress={rotate} style={{ color: colors.redInk }}>Rotate</LinkText>
              </View>
            </View>
          )}
        </View>
      )}
      {editing && (
        <View style={{ marginTop: 8, gap: 6 }}>
          <Field label="Nominee label"><Input value={label} onChangeText={setLabel} placeholder="Priya Sharma (spouse)" /></Field>
          <Field label="Nominee email · optional"><Input value={email} onChangeText={setEmail} placeholder="priya@example.com" keyboardType="email-address" autoCapitalize="none" /></Field>
          <Field label="Note for them · optional">
            <Input value={text} onChangeText={setText} multiline numberOfLines={4} style={{ minHeight: 90, textAlignVertical: "top" }} />
          </Field>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <LinkText onPress={() => { setEditing(false); refresh(); }}>Cancel</LinkText>
            <PrimaryButton onPress={save} busy={busy} label="Save" style={{ paddingVertical: 8, paddingHorizontal: 16 }} />
          </View>
        </View>
      )}
    </Card>
  );
}

function FinalizeModal({ open, acceptedHolders, hasVaultKey, onCancel, onConfirm, busy }: {
  open: boolean; acceptedHolders: any[]; hasVaultKey: boolean;
  onCancel: () => void; onConfirm: () => void; busy: boolean;
}) {
  const [text, setText] = useState("");
  const ready = text.trim().toLowerCase() === "finalize";
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}>
        <View style={{ flex: 1, marginTop: 80, backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 }}>
          <Eyebrow>FINALIZE</Eyebrow>
          <H2 style={{ marginTop: 6 }}>Activate your release plan.</H2>
          <Footnote style={{ marginTop: 10, color: colors.text2 }}>
            Lyfos will split your vault key into 5 cryptographic shares and seal one to each holder. Release will require:
          </Footnote>
          <View style={{ marginTop: 8, gap: 4 }}>
            <Body style={{ color: colors.text2 }}>• Your nominee files a claim with proof</Body>
            <Body style={{ color: colors.text2 }}>• Lyfos approves the claim</Body>
            <Body style={{ color: colors.text2 }}>• 3 of 5 holders approve their share</Body>
            <Body style={{ color: colors.text2 }}>• 14-day hold with daily alerts; one-tap abort</Body>
          </View>
          {!hasVaultKey && (
            <Card tone="danger" style={{ marginTop: 16 }}>
              <Body style={{ color: colors.redInk }}>Unlock your vault first. The raw key never leaves this device.</Body>
            </Card>
          )}
          <Field label='Type "finalize" to confirm'>
            <Input value={text} onChangeText={setText} placeholder="finalize" autoCapitalize="none" editable={hasVaultKey && !busy} />
          </Field>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
            <LinkText onPress={onCancel}>Cancel</LinkText>
            <PrimaryButton onPress={onConfirm} disabled={!ready || !hasVaultKey} busy={busy} label="Activate plan" style={{ paddingVertical: 10, paddingHorizontal: 22 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

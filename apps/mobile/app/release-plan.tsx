// Release plan — owner-side recipient-gated circle setup.

import React, { useEffect, useState } from "react";
import { ScrollView, View, Pressable, Alert, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";

import { Screen, Eyebrow, H1, H2, Body, Footnote, Field, Input, PrimaryButton, LinkText, Card, StatusPill } from "../src/ui";
import { useApp } from "../src/AppContext";
import {
  listMyKeyHolders, createKeyHolderInvite, requeueKeyHolderInvite, revokeKeyHolder, sendInviteEmail, finalizeReleasePlan
} from "../src/lib/releasePlan";
import { useVaultKey } from "../src/useVaultKey";
import { colors, radii } from "../src/theme";
import { publicAppOrigin } from "../src/lib/appUrls";

export default function ReleasePlanScreen() {
  const { entitlements, session } = useApp();
  const vaultKey = useVaultKey();

  const [holders, setHolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedbackUrl, setFeedbackUrl] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackOk, setFeedbackOk] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const accepted = holders.filter((h) => h.status === "accepted").length + holders.filter((h) => h.status === "verified").length;
  const verified = holders.filter((h) => h.status === "verified").length;
  const planActive = verified >= 5;
  const canPay = entitlements.releaseEnabled;
  const rolesReady = holders.filter((h) => h.role === "primary").length === 1
    && holders.filter((h) => h.role === "backup").length === 1;
  const canFinalize = !planActive && holders.length === 5 && accepted === 5 && rolesReady && canPay;

  async function refresh() {
    setLoading(true); setError("");
    try { setHolders(await listMyKeyHolders()); }
    catch (e: any) { setError(e?.message || "Couldn't load."); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function invite(input: { label: string; email: string; phone?: string; role: "primary" | "backup" | "trusted" }) {
    setBusy(true); setError("");
    try {
      const created = await createKeyHolderInvite({ label: input.label, holderEmail: input.email, holderPhone: input.phone, role: input.role });
      const appUrl = publicAppOrigin((Constants?.expoConfig?.extra as any)?.APP_URL);
      const url = `${appUrl}/invite/${created.invite_token}`;
      try {
        const delivery = await sendInviteEmail(created.delivery_id);
        setFeedbackOk(delivery?.state !== "failed");
        setFeedbackMessage(delivery?.state === "failed"
          ? delivery?.reason || "The email provider rejected this invite."
          : "The email provider accepted the invite. Delivery confirmation may take a moment.");
      } catch (sendError: any) {
        setFeedbackOk(false);
        setFeedbackMessage(sendError?.message || "The invite was created, but the email could not be sent.");
      }
      setFeedbackUrl(url);
      setShowInvite(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Couldn't create invite.");
    } finally { setBusy(false); }
  }

  async function resend(holder: any) {
    setResendingId(holder.id); setError("");
    let url: string | null = null;
    try {
      const next = await requeueKeyHolderInvite(holder.id);
      const appUrl = publicAppOrigin((Constants?.expoConfig?.extra as any)?.APP_URL);
      url = `${appUrl}/invite/${next.invite_token}`;
      const delivery = await sendInviteEmail(next.delivery_id);
      setFeedbackOk(delivery?.state !== "failed");
      setFeedbackMessage(delivery?.state === "failed"
        ? delivery?.reason || "The email provider rejected this invite."
        : "A fresh invite was accepted by the email provider.");
      setFeedbackUrl(url);
      await refresh();
    } catch (e: any) {
      if (url) {
        setFeedbackOk(false);
        setFeedbackMessage(e?.message || "The email could not be sent. Share this fresh link directly.");
        setFeedbackUrl(url);
        await refresh();
      } else {
        setError(e?.message || "Couldn't create a fresh invite.");
      }
    } finally { setResendingId(null); }
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
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <LinkText onPress={() => router.back()}>‹ Vault</LinkText>
            <Eyebrow>Release plan</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 18, textAlign: "center" }}>
            {planActive ? "Your circle is active." : "Build your circle of five."}
          </H1>
          <Footnote style={{ marginTop: 10, textAlign: "center", color: colors.text2 }}>
            Choose one primary, one backup, and three trusted nominees. The recovery recipient still needs two other nominees plus a 14-day hold.
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
            <Card tone={feedbackOk ? "success" : "amber"} style={{ marginTop: 12 }}>
              <Footnote style={{ color: feedbackOk ? colors.greenInk : colors.amberInk, fontWeight: "600" }}>
                {feedbackOk ? "INVITE SENT" : "EMAIL NEEDS ATTENTION"}
              </Footnote>
              <Body style={{ marginTop: 4, color: feedbackOk ? colors.greenInk : colors.amberInk }}>
                {feedbackMessage} The link below is always available as a fallback:
              </Body>
              <Body style={{ marginTop: 6, fontFamily: "Courier", fontSize: 11 }} selectable>{feedbackUrl}</Body>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                <LinkText onPress={() => Clipboard.setStringAsync(feedbackUrl).catch(() => {})}>Copy</LinkText>
                <LinkText onPress={() => { setFeedbackUrl(null); setFeedbackMessage(""); }}>Close</LinkText>
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
                    <Footnote numberOfLines={1}>{h.holder_email} · {h.role || "trusted"}</Footnote>
                  </View>
                  <StatusPill
                    label={h.status === "pending" && h.delivery_state ? h.delivery_state : h.status}
                    tone={["verified", "accepted", "delivered", "sent"].includes(h.status === "pending" && h.delivery_state ? h.delivery_state : h.status) ? "green" : h.status === "revoked" || ["failed", "bounced", "suppressed"].includes(h.delivery_state) ? "red" : "amber"}
                  />
                </View>
                {!!h.delivery_failure_reason && <Footnote style={{ marginTop: 6, color: colors.redInk }}>{h.delivery_failure_reason}</Footnote>}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 8 }}>
                  {h.status === "pending" && (
                    <Pressable disabled={resendingId === h.id} onPress={() => resend(h)}>
                      <Footnote style={{ color: colors.text }}>{resendingId === h.id ? "Sending…" : "Send email again"}</Footnote>
                    </Pressable>
                  )}
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
                Your circle is active. Primary or backup still needs two other nominees and the 14-day owner-protection hold.
              </Footnote>
            )}
          </View>

          {planActive && <RecoveryAccessPanel />}
        </ScrollView>
      </SafeAreaView>

      <FinalizeModal
        open={finalizeOpen}
        hasVaultKey={!!vaultKey}
        onCancel={() => setFinalizeOpen(false)}
        onConfirm={async (instructions) => {
          if (!vaultKey) { setError("Unlock your vault first."); return; }
          setBusy(true);
          try {
            const rawKey = vaultKey;
            await finalizeReleasePlan({ rawVaultKey: rawKey, holders: holders.filter((h) => ["accepted", "verified"].includes(h.status)), instructions });
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
  busy: boolean; onCancel: () => void; onSubmit: (input: { label: string; email: string; phone?: string; role: "primary" | "backup" | "trusted" }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"primary" | "backup" | "trusted">("trusted");
  return (
    <Card style={{ width: "100%" }}>
      <Footnote style={{ fontWeight: "600", color: colors.text3 }}>INVITE A KEY HOLDER</Footnote>
      <Field label="Label"><Input value={label} onChangeText={setLabel} placeholder="Vikram Sharma (brother)" autoCapitalize="words" /></Field>
      <Field label="Their email"><Input value={email} onChangeText={setEmail} placeholder="vikram@example.com" keyboardType="email-address" autoCapitalize="none" /></Field>
      <Field label="Their phone · optional, for SMS alerts">
        <Input value={phone} onChangeText={setPhone} placeholder="+91 98765 43210" keyboardType="phone-pad" />
      </Field>
      <Field label="Their role">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["primary", "backup", "trusted"] as const).map((value) => (
            <Pressable key={value} onPress={() => setRole(value)} style={{ flex: 1, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: role === value ? colors.text : colors.surface }}>
              <Footnote style={{ textAlign: "center", color: role === value ? colors.bg : colors.text2, fontWeight: "600", textTransform: "capitalize" }}>{value}</Footnote>
            </Pressable>
          ))}
        </View>
      </Field>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
        <LinkText onPress={onCancel}>Cancel</LinkText>
        <PrimaryButton onPress={() => onSubmit({ label, email, phone, role })} disabled={!label || !email} busy={busy} label="Send invite" style={{ paddingVertical: 8, paddingHorizontal: 16 }} />
      </View>
    </Card>
  );
}

function RecoveryAccessPanel() {
  const appUrl = publicAppOrigin((Constants?.expoConfig?.extra as any)?.APP_URL);
  return (
    <Card tone="success" style={{ marginTop: 28 }}>
      <Footnote style={{ color: colors.greenInk, fontWeight: "600" }}>RECOVERY ACCESS</Footnote>
      <Body style={{ marginTop: 6, color: colors.greenInk }}>
        Primary and backup nominees sign in to their own accounts at {appUrl}/claim. No separate claim token or owner login is used.
      </Body>
    </Card>
  );
}

function FinalizeModal({ open, hasVaultKey, onCancel, onConfirm, busy }: {
  open: boolean; hasVaultKey: boolean;
  onCancel: () => void; onConfirm: (instructions: string) => void; busy: boolean;
}) {
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState("");
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
            <Body style={{ color: colors.text2 }}>• Primary or backup uses their private key</Body>
            <Body style={{ color: colors.text2 }}>• Two other nominees independently release support</Body>
            <Body style={{ color: colors.text2 }}>• 14-day hold with daily alerts; one-tap abort</Body>
          </View>
          {!hasVaultKey && (
            <Card tone="danger" style={{ marginTop: 16 }}>
              <Body style={{ color: colors.redInk }}>Unlock your vault first. The raw key never leaves this device.</Body>
            </Card>
          )}
          <Field label="Private instructions for primary and backup · optional">
            <Input value={instructions} onChangeText={setInstructions} multiline numberOfLines={4} style={{ minHeight: 90, textAlignVertical: "top" }} placeholder="What should they do first when the vault is released?" />
          </Field>
          <Field label='Type "finalize" to confirm'>
            <Input value={text} onChangeText={setText} placeholder="finalize" autoCapitalize="none" editable={hasVaultKey && !busy} />
          </Field>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
            <LinkText onPress={onCancel}>Cancel</LinkText>
            <PrimaryButton onPress={() => onConfirm(instructions)} disabled={!ready || !hasVaultKey} busy={busy} label="Activate plan" style={{ paddingVertical: 10, paddingHorizontal: 22 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

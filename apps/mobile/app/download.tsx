// /download — nominee combines released shares and downloads the
// emergency bundle. Same flow as web's NomineeDownloadScreen.

import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
// SDK 54: the classic documentDirectory/writeAsStringAsync API moved to the
// /legacy entry (the default export is now the new File/Directory API).
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen, Eyebrow, H1, Body, Footnote, PrimaryButton, LinkText, Card } from "../src/ui";
import { useApp } from "../src/AppContext";
import { fetchMyReleaseRequests, fetchSharesReleasedFor } from "../src/lib/releaseClaim";
import { openSealedShare, fromUtf8, aesGcmDecrypt, fromBase64 } from "../src/lib/crypto";
import { combineShares } from "../src/lib/vaultRecord";
import { getSupabase } from "../src/lib/supabase";
import { colors } from "../src/theme";

const RP_KEY_PREFIX = "lyfos-release-process-key-";

export default function DownloadScreen() {
  const { session } = useApp();
  const [request, setRequest] = useState<any | null>(null);
  const [shares, setShares] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true); setError("");
    try {
      const all = await fetchMyReleaseRequests();
      const inflight = all.find((r: any) => ["pending_review","approved","awaiting_shares","holding","ready_to_release"].includes(r.state));
      const req = inflight ?? all[0] ?? null;
      setRequest(req);
      if (req) setShares(await fetchSharesReleasedFor(req.id));
      else setShares([]);
    } catch (e: any) { setError(e?.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (session) refresh(); else setLoading(false); }, [session?.user?.id]);

  async function combineAndSave() {
    if (!request) return;
    setBusy(true); setError("");
    try {
      // 1. Find the release-process secret key we stashed at claim time.
      //    It was keyed by RP_KEY_PREFIX + claim_token, but we don't have
      //    the claim_token here — so we walk all such keys and pick the
      //    only candidate (a nominee at most has one in-flight claim).
      const keys = await AsyncStorage.getAllKeys();
      const rpKeys = keys.filter((k) => k.startsWith(RP_KEY_PREFIX));
      if (rpKeys.length === 0) throw new Error("Couldn't find your release process key on this device. You must use the same device + app install you used to file the claim.");
      const rpRaw = await AsyncStorage.getItem(rpKeys[0]);
      if (!rpRaw) throw new Error("Release process key not found.");
      const rp = JSON.parse(rpRaw);

      // 2. Decrypt + collect shares
      const shareStrings: string[] = [];
      for (const s of shares) {
        const bytes = openSealedShare({ ciphertext: s.ciphertext, ephemeralPub: s.ephemeral_pub }, rp.secretKey);
        shareStrings.push(fromUtf8(bytes));
      }
      if (shareStrings.length < 3) throw new Error(`Only ${shareStrings.length} shares released. Need 3.`);

      // 3. Combine via SSS → raw vault key
      const rawVaultKey = combineShares(shareStrings);

      // 4. Fetch the owner's encrypted vault blob via the RPC
      const sb = getSupabase()!;
      const { data: blobRows, error: blobErr } = await sb.rpc("nominee_get_vault_blob", { p_request_id: request.id });
      if (blobErr) throw blobErr;
      if (!blobRows || blobRows.length === 0) throw new Error("Couldn't fetch the encrypted vault.");
      const blob = blobRows[0];

      // 5. Decrypt the inner vault payload
      const encryptedVault = blob.encrypted_record?.encryptedVault;
      if (!encryptedVault?.iv || !encryptedVault?.ciphertext) throw new Error("Encrypted vault payload missing.");
      const pt = await aesGcmDecrypt(rawVaultKey, encryptedVault);
      // Zero the raw key buffer
      for (let i = 0; i < rawVaultKey.length; i++) rawVaultKey[i] = 0;
      const vault = JSON.parse(fromUtf8(pt));

      // 6. Filter to emergency-eligible records + build bundle
      const items = (vault.items ?? []).filter((it: any) => it.emergencyEligible);
      setRecordCount(items.length);
      const bundle = {
        kind: "lyfos-emergency-bundle",
        version: 1,
        released_at: new Date().toISOString(),
        items
      };
      const path = `${FileSystem.documentDirectory}lyfos-emergency-${new Date().toISOString().slice(0,10)}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(bundle, null, 2));
      try { await Sharing.shareAsync(path, { mimeType: "application/json" }); } catch {}

      // 7. Mark completed
      await sb.rpc("nominee_mark_completed", { p_request_id: request.id });
      try { await AsyncStorage.removeItem(rpKeys[0]); } catch {}
      setDone(true);
    } catch (e: any) { setError(e?.message ?? "Couldn't combine."); }
    finally { setBusy(false); }
  }

  if (!session) {
    return <Screen><SafeAreaView style={{ flex: 1, padding: 20 }}>
      <Eyebrow>Nominee download</Eyebrow>
      <H1 style={{ marginTop: 10 }}>Sign in to download.</H1>
      <Footnote style={{ marginTop: 10 }}>Use the same email and the same device + app install you used to file the claim.</Footnote>
      <PrimaryButton onPress={() => router.push("/(auth)/sign-in")} label="Sign in" style={{ marginTop: 20 }} />
    </SafeAreaView></Screen>;
  }
  if (loading) return <Screen><Body style={{ padding: 40 }}>Loading…</Body></Screen>;
  if (!request) return <Screen><SafeAreaView style={{ flex: 1, padding: 20 }}>
    <H1 style={{ marginTop: 40 }}>No release request found for this account.</H1>
    <PrimaryButton onPress={() => router.replace("/(tabs)/home")} label="Go home" style={{ marginTop: 16 }} />
  </SafeAreaView></Screen>;

  const daysLeft = request.ready_at ? Math.max(0, Math.ceil((new Date(request.ready_at).getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ padding: 20 }}>
          <Eyebrow>Lyfos · Nominee</Eyebrow>
          <H1 style={{ marginTop: 8 }}>Release download</H1>

          <Card style={{ marginTop: 16 }}>
            <Eyebrow>State</Eyebrow>
            <Body style={{ marginTop: 4, fontWeight: "500" }}>{request.state.replace(/_/g, " ")}</Body>
            <Footnote style={{ marginTop: 4 }}>{shares.length} of 5 shares released</Footnote>
            {request.state === "holding" && daysLeft !== null && (
              <Footnote style={{ marginTop: 4 }}>{daysLeft} day{daysLeft === 1 ? "" : "s"} until the hold expires</Footnote>
            )}
          </Card>

          {error ? <Card tone="danger" style={{ marginTop: 12 }}><Body style={{ color: colors.redInk }}>{error}</Body></Card> : null}

          {done ? (
            <Card tone="success" style={{ marginTop: 12 }}>
              <Eyebrow style={{ color: colors.greenInk }}>Download saved</Eyebrow>
              <Body style={{ marginTop: 4 }}>
                Your emergency bundle was saved with {recordCount} record{recordCount === 1 ? "" : "s"}.
              </Body>
              <Footnote style={{ marginTop: 6, color: colors.greenInk }}>
                Store the file somewhere safe. Lyfos cannot regenerate it.
              </Footnote>
            </Card>
          ) : request.state === "ready_to_release" && shares.length >= 3 ? (
            <PrimaryButton onPress={combineAndSave} busy={busy} label="Combine shares and download" style={{ marginTop: 16 }} />
          ) : (
            <Footnote style={{ marginTop: 16, color: colors.text2 }}>
              {request.state === "pending_review"   && "Lyfos is reviewing the death certificate. Check back in a few hours."}
              {request.state === "approved"         && "The claim is approved. Key holders are being notified."}
              {request.state === "awaiting_shares" && `${shares.length} of 3 minimum shares released. Waiting for the rest.`}
              {request.state === "holding"          && "Three shares released. The 14-day owner-protection hold is now active."}
              {request.state === "cancelled"        && "Your owner aborted this release. The vault stays sealed."}
              {request.state === "rejected"         && `Your claim was rejected: ${request.rejection_reason ?? "no reason given"}.`}
              {request.state === "completed"        && "This release has already been completed."}
            </Footnote>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

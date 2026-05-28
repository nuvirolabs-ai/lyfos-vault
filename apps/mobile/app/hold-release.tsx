// /hold-release — list of release requests this user is a verified
// holder for. Per-request passphrase → derive privkey → unwrap share →
// re-encrypt to nominee → upload via holder_release_share RPC.

import React, { useEffect, useState } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, H3, Body, Footnote, Field, Input, PrimaryButton, LinkText, Card, StatusPill } from "../src/ui";
import { useApp } from "../src/AppContext";
import { listReleasesAwaitingMyAction, releaseMyShare } from "../src/lib/releasePlan";
import { colors } from "../src/theme";

export default function HoldReleaseScreen() {
  const { session } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try { setItems(await listReleasesAwaitingMyAction()); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (session) refresh(); else setLoading(false); }, [session?.user?.id]);

  if (!session) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow>Key holder release</Eyebrow>
          <H1 style={{ marginTop: 12 }}>Sign in to act on a release.</H1>
          <PrimaryButton onPress={() => router.push("/(auth)/sign-in")} label="Sign in" style={{ marginTop: 24 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 80 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <LinkText onPress={() => router.back()}>‹ Back</LinkText>
            <Eyebrow>Lyfos · Key holder</Eyebrow>
            <View style={{ width: 60 }} />
          </View>
          <H1 style={{ marginTop: 16 }}>Releases awaiting you</H1>
          {loading && <Footnote style={{ marginTop: 12 }}>Loading…</Footnote>}
          {!loading && items.length === 0 && (
            <Card style={{ marginTop: 24 }}>
              <Body style={{ fontWeight: "600" }}>Nothing to do.</Body>
              <Footnote style={{ marginTop: 4 }}>If someone you keep a key for files a release claim, it'll appear here.</Footnote>
            </Card>
          )}
          <View style={{ gap: 12, marginTop: 16 }}>
            {items.map((req) => <HolderCard key={req.id} req={req} userId={session.user.id} onChanged={refresh} />)}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function HolderCard({ req, userId, onChanged }: { req: any; userId: string; onChanged: () => Promise<void> }) {
  const [pp, setPp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (req.iAlreadyReleased || done) {
    return (
      <Card tone="success">
        <Eyebrow style={{ color: colors.greenInk }}>You released — thank you</Eyebrow>
        <Body style={{ marginTop: 6, fontWeight: "600" }}>{req.myLabel}</Body>
        <Footnote style={{ marginTop: 4 }}>Filed by: {req.nominee_email_at_request}. State: {req.state.replace(/_/g, " ")}.</Footnote>
      </Card>
    );
  }

  async function release() {
    if (pp.length < 12) { setError("Type the same passphrase you used at invite-accept."); return; }
    setBusy(true); setError("");
    try {
      await releaseMyShare({
        requestId: req.id, holderId: req.myHolderId, ownerId: req.owner_id,
        releaseProcessPubkey: req.release_process_pubkey, passphrase: pp, holderUserId: userId
      });
      setDone(true);
      await onChanged();
    } catch (e: any) { setError(e?.message ?? "Couldn't release."); }
    finally { setBusy(false); }
  }

  return (
    <Card tone="amber">
      <Eyebrow style={{ color: colors.amberInk }}>Awaiting your release</Eyebrow>
      <H3 style={{ marginTop: 6 }}>{req.myLabel}</H3>
      <Footnote style={{ marginTop: 6, color: colors.amberInk }}>
        Filed by <Body style={{ fontWeight: "600" }}>{req.nominee_email_at_request}</Body>. State: {req.state.replace(/_/g, " ")}.
      </Footnote>
      <Footnote style={{ marginTop: 4, color: colors.amberInk }}>
        Three of five holders must release before the 14-day hold begins. Your owner gets daily alerts during the hold and can abort.
      </Footnote>
      <Field label="Your release passphrase">
        <Input value={pp} onChangeText={setPp} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      </Field>
      {error ? <Footnote style={{ color: colors.redInk }}>{error}</Footnote> : null}
      <PrimaryButton onPress={release} busy={busy} disabled={pp.length < 12} label="Release my share" style={{ marginTop: 10 }} />
    </Card>
  );
}

// /release/abort — panic button reached from push notification or
// deep link. Same logic as web's AbortScreen.

import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Screen, Eyebrow, H1, Body, Footnote, PrimaryButton, LinkText, Card, DangerButton } from "../../src/ui";
import { fetchActiveReleaseAgainstMe, ownerAbortRelease } from "../../src/lib/releaseClaim";
import { useApp } from "../../src/AppContext";
import { colors } from "../../src/theme";

export default function AbortScreen() {
  const { session } = useApp();
  const [req, setReq] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    fetchActiveReleaseAgainstMe()
      .then((r) => setReq(r ?? null))
      .catch((e) => setError(e?.message))
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

  async function abort() {
    if (!req) return;
    setBusy(true); setError("");
    try { await ownerAbortRelease(req.id, "owner_abort_from_alert"); setDone(true); }
    catch (e: any) { setError(e?.message ?? "Couldn't abort."); }
    finally { setBusy(false); }
  }

  if (!session) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 20, paddingTop: 40 }}>
            <Eyebrow style={{ color: colors.redInk }}>Release abort</Eyebrow>
            <H1 style={{ marginTop: 14 }}>Sign in to abort.</H1>
            <Footnote style={{ marginTop: 10 }}>Once signed in you'll see one button. Tap it and your vault stays sealed.</Footnote>
            <PrimaryButton onPress={() => router.push("/(auth)/sign-in")} label="Sign in" style={{ marginTop: 24 }} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  if (loading) return <Screen><Body style={{ padding: 40 }}>Loading…</Body></Screen>;

  if (done) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <Eyebrow style={{ color: colors.greenInk }}>Aborted</Eyebrow>
          <H1 style={{ marginTop: 12 }}>Your vault stays sealed.</H1>
          <Footnote style={{ marginTop: 10 }}>The release request has been cancelled. Your nominee will be notified.</Footnote>
          <PrimaryButton onPress={() => router.replace("/(tabs)/home")} label="Open Lyfos" style={{ marginTop: 24 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  if (!req) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <H1 style={{ marginTop: 40 }}>No active release.</H1>
          <Footnote style={{ marginTop: 10 }}>Nothing in flight against your account. The alert that brought you here may have been an older one.</Footnote>
          <PrimaryButton onPress={() => router.replace("/(tabs)/home")} label="Go home" style={{ marginTop: 24 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  if (req.state === "ready_to_release" || req.state === "completed") {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow style={{ color: colors.redInk }}>Too late</Eyebrow>
          <H1 style={{ marginTop: 12 }}>The hold has expired.</H1>
          <Footnote style={{ marginTop: 10 }}>
            The 14-day window has passed; the release is now in your nominee's hands. If this happened in error, email hello@lyfos.in immediately.
          </Footnote>
        </SafeAreaView>
      </Screen>
    );
  }

  const daysLeft = req.ready_at ? Math.max(0, Math.ceil((new Date(req.ready_at).getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, padding: 20 }}>
        <Eyebrow style={{ color: colors.redInk }}>Active release</Eyebrow>
        <H1 style={{ marginTop: 12 }}>Are you alive?</H1>
        <Footnote style={{ marginTop: 10, color: colors.text2 }}>
          Someone (<Body style={{ fontWeight: "600" }}>{req.nominee_email_at_request}</Body>) filed a release of your vault.
          The hold expires in <Body style={{ fontWeight: "600" }}>{daysLeft ?? "?"} day{daysLeft === 1 ? "" : "s"}</Body>.
        </Footnote>
        <Footnote style={{ marginTop: 10, color: colors.text2 }}>
          If you're reading this, abort right now. Your vault stays sealed. Your key holders are released. The claim is closed.
        </Footnote>
        {error ? <Card tone="danger" style={{ marginTop: 12 }}><Body style={{ color: colors.redInk }}>{error}</Body></Card> : null}

        <View style={{ alignItems: "center", marginTop: 40 }}>
          <DangerButton onPress={abort} busy={busy} label="Abort — I'm fine" />
          <Footnote style={{ marginTop: 12, color: colors.text4 }}>One tap. Reversible only by filing a new claim.</Footnote>
        </View>
      </SafeAreaView>
    </Screen>
  );
}

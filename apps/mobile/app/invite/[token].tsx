// /invite/[token] — key-holder invite acceptance.

import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { Screen, Eyebrow, H1, Body, Footnote, Field, Input, PrimaryButton, LinkText, Card } from "../../src/ui";
import { useApp } from "../../src/AppContext";
import { peekInvite, acceptInvite } from "../../src/lib/releasePlan";
import { deriveHolderKeypairFromPassphrase } from "../../src/lib/crypto";
import { signOut } from "../../src/lib/auth";
import { colors } from "../../src/theme";

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useApp();
  const [invite, setInvite] = useState<any | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pp, setPp] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    peekInvite(token)
      .then((row) => setInvite(row ?? null))
      .catch((e) => setLoadError(e?.message ?? "Couldn't load invite."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Screen><Body style={{ padding: 40 }}>Loading…</Body></Screen>;
  if (loadError || !invite) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <H1 style={{ marginTop: 40 }}>Invite not available.</H1>
          <Footnote style={{ marginTop: 10 }}>{loadError || "It may have been revoked or already used."}</Footnote>
        </SafeAreaView>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow style={{ color: colors.greenInk }}>Accepted</Eyebrow>
          <H1 style={{ marginTop: 10 }}>You're set up.</H1>
          <Footnote style={{ marginTop: 10 }}>
            {invite.owner_email.split("@")[0]} has been notified. They'll finalize their release plan and provision your share.
          </Footnote>
          <PrimaryButton onPress={() => router.replace("/(tabs)/home")} label="Open Lyfos" style={{ marginTop: 24 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  // Wrong account
  if (session && session.user?.email && session.user.email.toLowerCase() !== invite.holder_email.toLowerCase()) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow>Wrong account</Eyebrow>
          <H1 style={{ marginTop: 10 }}>Sign in as {invite.holder_email}</H1>
          <Footnote style={{ marginTop: 10 }}>
            You're signed in as {session.user.email}. This invite was sent to {invite.holder_email}.
          </Footnote>
          <PrimaryButton onPress={() => signOut()} label="Sign out" style={{ marginTop: 16 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: 20 }}>
          <Eyebrow>Key holder invite</Eyebrow>
          <H1 style={{ marginTop: 10 }}>{invite.owner_email.split("@")[0]} invited you.</H1>
          <Body style={{ marginTop: 8 }}>Label: <Body style={{ fontWeight: "600" }}>{invite.label}</Body></Body>
          <Footnote style={{ marginTop: 10 }}>
            Sign in or create your Lyfos account using {invite.holder_email} to continue.
          </Footnote>
          <PrimaryButton onPress={() => router.push("/(auth)/sign-in")} label="Sign in / Sign up" style={{ marginTop: 20 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  async function submit() {
    if (pp.length < 12) { setError("Use the same passphrase you use for your own Lyfos vault. At least 12 characters."); return; }
    setBusy(true); setError("");
    try {
      const kp = await deriveHolderKeypairFromPassphrase(pp, session!.user.id);
      await acceptInvite({ token: token!, releasePubkey: kp.publicKey });
      setDone(true);
    } catch (e: any) { setError(e?.message ?? "Couldn't accept."); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
          <Eyebrow>Step 2 of 2</Eyebrow>
          <H1 style={{ marginTop: 12 }}>Set up your release key.</H1>
          <Footnote style={{ marginTop: 10 }}>
            Type the passphrase you use (or will use) to open your own Lyfos vault. We use it to derive a release key — Lyfos never sees the passphrase or the key.
          </Footnote>
          <Field label="Your vault passphrase">
            <Input value={pp} onChangeText={setPp} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          </Field>
          <Card tone="amber">
            <Footnote style={{ color: colors.amberInk }}>
              Remember this passphrase. If you forget it, you cannot release {invite.owner_email.split("@")[0]}'s vault when needed — your share becomes inert.
            </Footnote>
          </Card>
          {error ? <Footnote style={{ marginTop: 8, color: colors.redInk }}>{error}</Footnote> : null}
          <PrimaryButton onPress={submit} busy={busy} disabled={pp.length < 12} label="Accept invite" style={{ marginTop: 16 }} />
          <View style={{ alignItems: "center", marginTop: 16 }}>
            <LinkText onPress={() => signOut()}>Use a different account</LinkText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

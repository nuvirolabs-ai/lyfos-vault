// Root layout. Mounts the AppProvider + decides whether to push the
// user to AuthScreen, EntryScreen, or the (tabs) group based on
// session + storedRecord + unlocked state.

import React, { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AppProvider, useApp } from "../src/AppContext";
import { registerForPushNotifications, attachNotificationTapHandler } from "../src/lib/notifications";
import { isSupabaseConfigured } from "../src/lib/auth";
import { nextRoute } from "../src/lib/routing";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Routing />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Routing() {
  const { session, sessionLoaded, storedRecord, unlocked } = useApp();
  const router = useRouter();
  const segments = useSegments();

  // Register push + attach tap handler when signed in
  useEffect(() => {
    if (!session) return;
    registerForPushNotifications().catch(() => {});
    return attachNotificationTapHandler();
  }, [session?.user?.id]);

  useEffect(() => {
    const target = nextRoute({
      sessionLoaded,
      supabaseConfigured: isSupabaseConfigured(),
      hasSession: Boolean(session),
      hasStoredRecord: Boolean(storedRecord),
      unlocked,
      first: segments[0] ?? ""
    });
    if (target) router.replace(target as any);
  }, [sessionLoaded, session?.user?.id, storedRecord, unlocked, segments[0]]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#fbfbfd" }
      }}
    />
  );
}

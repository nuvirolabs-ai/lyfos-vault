// Root layout. Mounts the AppProvider + decides whether to push the
// user to AuthScreen, EntryScreen, or the (tabs) group based on
// session + storedRecord + unlocked state.

import React, { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter, useSegments, useRootNavigationState } from "expo-router";
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
  // Becomes truthy only once the root navigator has actually mounted. Calling
  // router.replace() before that throws "Attempted to navigate before mounting
  // the Root Layout component", so we gate all redirects on it.
  const navState = useRootNavigationState();
  const navReady = Boolean(navState?.key);

  // Register push + attach tap handler when signed in
  useEffect(() => {
    if (!session) return;
    registerForPushNotifications().catch(() => {});
    return attachNotificationTapHandler();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!navReady) return;
    const target = nextRoute({
      sessionLoaded,
      supabaseConfigured: isSupabaseConfigured(),
      hasSession: Boolean(session),
      hasStoredRecord: Boolean(storedRecord),
      unlocked,
      first: segments[0] ?? ""
    });
    if (!target) return;
    // Defer to the next macrotask: even once navState has a key, the navigator
    // may not be fully committed on the very first tick, which throws
    // "Attempted to navigate before mounting the Root Layout". A 0ms timeout
    // lands after the commit and navigates reliably.
    const id = setTimeout(() => router.replace(target as any), 0);
    return () => clearTimeout(id);
  }, [navReady, sessionLoaded, session?.user?.id, storedRecord, unlocked, segments[0]]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#fbfbfd" }
      }}
    />
  );
}

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
    if (!sessionLoaded) return;
    const first = segments[0] ?? "";
    // Public routes (no auth needed) — let them stay
    const PUBLIC = new Set(["invite", "claim", "release", "hold-release", "download", "admin", "auth"]);
    if (PUBLIC.has(first)) return;

    // Decide based on app state
    if (isSupabaseConfigured() && !session && !storedRecord) {
      if (first !== "(auth)") router.replace("/(auth)/sign-in");
      return;
    }
    if (storedRecord && !unlocked) {
      if (first !== "(entry)") router.replace("/(entry)/unlock");
      return;
    }
    if (!storedRecord && session) {
      if (first !== "(entry)") router.replace("/(entry)/create");
      return;
    }
    if (unlocked && (first === "(auth)" || first === "(entry)" || first === "")) {
      router.replace("/(tabs)/home");
    }
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

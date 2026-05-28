// Push notifications. Most-critical channel for the release-hold abort.
//
// On first run after auth, we:
//   1. Ask permission
//   2. Get an Expo push token
//   3. Upsert it into a `push_tokens` table the server reads when
//      dispatching the release alert (Day 5 of Phase 5 — Edge Function
//      change). For mobile, the alert dispatcher SHOULD fan out across
//      every registered push token in addition to email/SMS/WhatsApp.
//
// The push_tokens table isn't created in Phase 3 — the migration lands
// here as a TODO when we wire the dispatcher. For now we register +
// store the token; the server work catches up.

import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { ensureDeviceToken } from "./storage";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true
  })
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Constants.isDevice && Platform.OS !== "web") {
    // Simulator: bail quietly.
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("release-alerts", {
      name: "Release alerts",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 300, 200, 300],
      lightColor: "#b42318"
    });
  }

  const projectId =
    (Constants?.expoConfig?.extra as any)?.eas?.projectId ?? Constants?.easConfig?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await upsertPushToken(token);
  return token;
}

async function upsertPushToken(token: string) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) return;
  const deviceToken = await ensureDeviceToken();
  // Best-effort: table may not exist yet — Day 5 Edge Function patch lands later.
  try {
    await sb.from("push_tokens").upsert(
      { user_id: u.user.id, device_token: deviceToken, expo_token: token, platform: Platform.OS },
      { onConflict: "user_id,device_token" }
    );
  } catch {}
}

/**
 * Tap handler: when the user taps a push notification, the payload is
 * expected to carry a `route` (e.g. "/release/abort"). We deep-link to it.
 */
export function attachNotificationTapHandler() {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = (response.notification.request.content.data as any)?.route as string | undefined;
    if (route) {
      const url = Linking.createURL(route.startsWith("/") ? route.slice(1) : route);
      Linking.openURL(url).catch(() => {});
    }
  });
  return () => sub.remove();
}

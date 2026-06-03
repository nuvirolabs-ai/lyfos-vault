// Pure routing decision for the root layout. Extracted so it can be unit
// tested exhaustively (see routing.test.ts). Given the current app state and
// the active top-level segment, returns the route to redirect to, or null to
// stay put.

export interface RouteState {
  sessionLoaded: boolean;
  supabaseConfigured: boolean;
  hasSession: boolean;
  hasStoredRecord: boolean;
  unlocked: boolean;
  /** segments[0] of the current route ("" for the index route). */
  first: string;
}

const PUBLIC = new Set(["invite", "claim", "release", "hold-release", "download", "admin", "auth"]);

export function nextRoute(s: RouteState): string | null {
  if (!s.sessionLoaded) return null;
  if (PUBLIC.has(s.first)) return null;

  // No account yet + nothing stored, but cloud is available → sign in.
  if (s.supabaseConfigured && !s.hasSession && !s.hasStoredRecord) {
    return s.first === "(auth)" ? null : "/(auth)/sign-in";
  }
  // A vault exists on this device but is sealed → unlock (works offline).
  if (s.hasStoredRecord && !s.unlocked) {
    return s.first === "(entry)" ? null : "/(entry)/unlock";
  }
  // Fresh device: create a vault. Reachable when signed in OR in local-only
  // mode (no Supabase configured), where there is never a session to wait for.
  if (!s.hasStoredRecord && (s.hasSession || !s.supabaseConfigured)) {
    return s.first === "(entry)" ? null : "/(entry)/create";
  }
  // Unlocked but parked on a pre-app screen → enter the app.
  if (s.unlocked && (s.first === "(auth)" || s.first === "(entry)" || s.first === "")) {
    return "/(tabs)/home";
  }
  return null;
}

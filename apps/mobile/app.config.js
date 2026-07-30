// Dynamic config that reads EAS environment variables at build time
// + falls back to apps/mobile/.env.local for local dev. Replaces
// app.json's static `extra` values at runtime — keeps secrets out of
// the repo while letting EAS Build inject per-channel values.

const base = require("./app.json").expo;

module.exports = () => ({
  ...base,
  extra: {
    ...(base.extra ?? {}),
    SUPABASE_URL:      process.env.EXPO_PUBLIC_SUPABASE_URL      ?? base.extra?.SUPABASE_URL      ?? "",
    SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? base.extra?.SUPABASE_ANON_KEY ?? "",
    APP_URL:           process.env.EXPO_PUBLIC_APP_URL           ?? base.extra?.APP_URL           ?? "https://app.lyfos.in",
    eas: base.extra?.eas ?? {}
  }
});

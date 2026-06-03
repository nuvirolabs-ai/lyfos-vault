# Lyfos Mobile

React Native + Expo SDK 54. Shares the same Supabase backend +
release engine as `apps/web`. Same crypto wire format — a holder
who accepted on web can release on mobile (and vice versa).

## Local dev

```bash
cd apps/mobile
cp .env.example .env.local        # fill in SUPABASE_URL + ANON_KEY
npm install
npx expo start --dev-client
```

Use the Expo Go app on your phone for the quickest loop (any feature
that needs `expo-secure-store` or `expo-local-authentication` will
fall back to in-memory dev shims; for the real keychain path you
need a development build via `npx expo run:ios` or `eas build -p ios
--profile development`).

## Build & ship

```bash
npm install -g eas-cli
eas login
eas init                          # creates the EAS project, writes projectId back
eas build:configure
```

Set the per-channel env vars in EAS:

```bash
eas env:create --environment production EXPO_PUBLIC_SUPABASE_URL=...
eas env:create --environment production EXPO_PUBLIC_SUPABASE_ANON_KEY=...
eas env:create --environment production EXPO_PUBLIC_APP_URL=https://lyfos.signorvale.com
```

Build for stores:

```bash
eas build --profile production --platform ios
eas build --profile production --platform android
```

Submit:

```bash
eas submit --platform ios --latest
eas submit --platform android --latest
```

Apple credentials live in `eas.json` under `submit.production.ios.*`;
Google needs a service-account JSON at `./google-play-service-account.json`
(generated in Google Play Console → API access).

## Push notifications

The release-alert-dispatcher Edge Function (`supabase/functions/
release-alert-dispatcher`) fans out to every row of `push_tokens` for
the owner. Mobile registers a token on first sign-in (see
`src/lib/notifications.ts`).

Tap a release-alert push → app opens to `/release/abort` via Expo's
notification response listener.

## Deep links

Universal Links + custom scheme are configured in `app.json`. Any of
these URLs opens the right route:

| URL                                          | Route                       |
|----------------------------------------------|-----------------------------|
| `https://lyfos.signorvale.com/invite/:token` | `app/invite/[token].tsx`    |
| `https://lyfos.signorvale.com/claim/:token`  | `app/claim/[token].tsx`     |
| `https://lyfos.signorvale.com/release/abort` | `app/release/abort.tsx`     |
| `https://lyfos.signorvale.com/hold-release`  | `app/hold-release.tsx`      |
| `https://lyfos.signorvale.com/download`      | `app/download.tsx`          |
| `lyfos://...` (custom scheme)                | Same paths as above         |

The web's matching public routes (in `apps/web`) are still served at
the same URLs — Universal Links means iOS opens the app if installed,
falls back to web otherwise.

## Store listing & submit checklist

See [store/listing.md](./store/listing.md).

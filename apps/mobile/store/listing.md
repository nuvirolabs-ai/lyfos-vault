# Lyfos — App Store + Play Store listing

This file is the source-of-truth for the listing text. Update here,
then copy into App Store Connect / Play Console.

## Name

```
Lyfos: Vault + Net Worth
```

## Subtitle (iOS, 30 chars max)

```
Encrypted vault, monthly worth
```

## Short description (Play, 80 chars max)

```
Encrypted vault for sensitive records + monthly net worth tracking. Zero-knowledge.
```

## Promotional text (iOS, 170 chars max)

```
Lyfos is a zero-knowledge vault for the records your family would need if something happened to you — passwords, IDs, bank details — plus a calm monthly balance sheet.
```

## Full description

```
Lyfos is two things in one calm app:

1. A monthly balance sheet. Add your bank accounts, investments, property and loans once. Update the numbers in five minutes each month. Watch your net worth move on a clean 12-month chart.

2. A zero-knowledge vault for the sensitive records your family would need if something happened to you. Passwords, bank account details, insurance policies, locker codes, Aadhaar / passport scans. Encrypted on your device with a passphrase only you know.

When Lyfos Vault launches, paid users will be able to build a Release Plan: five trusted humans hold encrypted shares of your vault key. If something happens to you, your nominee files a claim, three of the five release their shares, and after a mandatory owner-protection hold, your nominee can download an emergency bundle.

Designed in India for India:
• Free Forever for essential vault entries
• Lyfos Vault launching this fall
• GST-compliant tax invoices
• Multi-channel release alerts (email + SMS + WhatsApp + push)

Lyfos cannot read your vault. Even if our servers were breached, your ciphertext stays unreadable. We hold the encrypted blob and the metadata of the release process — never your passphrase, never your keys, never your records.

If Lyfos as a company ever shuts down, your encrypted vault export is a portable JSON envelope you can hold and move yourself.

For our security model, see:
https://lyfos.in/security/

Legal:
• Privacy Policy: https://app.lyfos.in/legal/privacy.html
• Terms of Service: https://app.lyfos.in/legal/terms.html
• Beta Disclaimer: https://app.lyfos.in/legal/beta-disclaimer.html
```

## Keywords (iOS, 100 chars max, comma-separated)

```
vault,encryption,net worth,balance sheet,wealth,passwords,nominee,inheritance,family,planner
```

## Category

- iOS: **Finance**, secondary **Productivity**
- Play: **Finance**, content rating: Everyone

## Age rating

- iOS: 17+ (the Release feature involves death/incapacity content)
- Play: PEGI 12 / Everyone — adjust to "Suitable for adults" if reviewers push back on the death-claim language

## Privacy questionnaire (App Store Connect)

Data we collect that links to the user identity:
- **Email** (account creation only; sign-in)
- **Anonymous analytics** (Plausible if enabled; no cookies, no user IDs)
- **Device tokens** (push notification routing)

Data we do NOT collect:
- ❌ Vault contents (encrypted on device, ciphertext-only on server)
- ❌ Passphrases or derived keys
- ❌ Plaintext financial records
- ❌ Location, contacts, photo library content beyond what the user explicitly attaches
- ❌ Advertising identifiers

Use of biometric data: only Face ID / Touch ID via OS-mediated APIs. Lyfos never stores biometric data itself.

Tracking transparency (iOS): we DO NOT track users across apps or websites. The ATT prompt is not required.

## Encryption export classification

- iOS: ITSAppUsesNonExemptEncryption = NO (already set in app.json). We use standard AES-GCM / Curve25519 / SHA-256 for protecting user data; this falls under TSU exception 740.17(b)(1) — no annual self-classification report required.

## Screenshots checklist (5 per device class)

Build these from a populated demo vault (use the web `?demo=1` flag to seed equivalent data on a desktop preview, then take screen recordings on a paired device):

1. **Home / net worth hero** — large currency number, sparkline, recent month delta
2. **Update flow** — bulk edit, sticky save bar at bottom
3. **Vault → Life Map** — 6 dossier cards in a 2-col grid
4. **Release plan** — your circle of five, status pills, "Finalize plan"
5. **Settings → Billing** — current plan and upgrade interest

iPhone 6.7" (1290×2796) is the primary; export the same screens at:
- iPhone 5.5" (1242×2208) — required by Apple for older device coverage
- iPad 12.9" (2048×2732) — required if `supportsTablet: true` (we do support tablet)
- Android phone (1080×1920) and tablet (1600×2560)

## App Store reviewer notes (iOS, every submission)

```
Lyfos is a personal-data vault + financial tracker for individuals in India.

Test account (TestFlight reviewers): username/email and password provided via App Review messaging.

The Release feature is planned as a paid Lyfos Vault feature. It is not required to test the Free Forever app experience.

We use Resend for transactional emails. Auth is via Supabase (Postgres + email/password / magic link). No advertising SDKs, no tracking SDKs.

Encryption / export compliance: declared via ITSAppUsesNonExemptEncryption=NO in Info.plist. Our cryptography is standard (AES-256-GCM, X25519 Curve, SHA-256, BIP39, Shamir's Secret Sharing) implemented with open-source libraries (@noble/ciphers, tweetnacl, @scure/bip39, secrets.js-grempe).

There is NO health / medical / location data collected.
```

## Submit checklist

- [ ] App icon (1024×1024 PNG, no transparency)
- [ ] Adaptive icon background + foreground (Play)
- [ ] Screenshots × 5 for each device class
- [ ] App preview videos (optional but boosts conversion)
- [ ] Privacy policy URL: https://app.lyfos.in/legal/privacy.html
- [ ] Support URL: https://lyfos.in
- [ ] Marketing URL: https://lyfos.in
- [ ] Reviewer notes (above)
- [ ] In-app purchases? **No** — paid Lyfos Vault is not active in this build.
- [ ] App Store privacy nutrition labels filled (see Privacy questionnaire above)
- [ ] Encryption export classification answered (Standard cryptography — TSU exception)
- [ ] TestFlight beta review completed before public release

## TestFlight / Internal track invite list

| Role      | Name | Email | Notes |
|-----------|------|-------|-------|
| Founder   |      |       |       |
| Beta wave |      |       | Early testers |

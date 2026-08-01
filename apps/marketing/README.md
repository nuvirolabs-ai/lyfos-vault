# Lyfos — Marketing Site

Static site for `https://lyfos.in` (the marketing surface, separate from
the app at `https://app.lyfos.in`).

## What's in here

```
apps/marketing/
├── index.html                          home
├── style.css                           shared design system
├── icon.svg                            wordmark / favicon
├── security/index.html                 security model + audit posture
├── pricing/index.html                  three plans + multi-currency table
├── press/index.html                    fact sheet + quotes + assets
├── blog/
│   ├── index.html                      blog index
│   ├── we-released-a-vault.html        public death-recovery test (launch post)
│   ├── why-no-nominee-kyc.html
│   └── zero-knowledge-mobile.html
└── README.md                           this file
```

There is no build step. Drop the directory on any static host and it
serves as-is.

## Deploy

### Vercel (recommended)

```bash
cd apps/marketing
vercel --prod
```

Point `lyfos.in` (and `www.lyfos.in`) at the Vercel project. Configure
the redirects:
- `lyfos.in` → `lyfos.in` (canonical)
- `www.lyfos.in` → 301 → `lyfos.in`

Add a `_headers` file for security headers:

```
/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### Cloudflare Pages

```bash
cd apps/marketing
npx wrangler pages deploy . --project-name lyfos-marketing
```

## Editing copy

Each page is a single hand-written HTML file. No template engine, no
component library. Keep it that way — the marketing site should be readable
in a year without remembering a stack.

The CSS variables are aligned with the app's design language (same
backgrounds, same colours, same typographic rhythm) so the move from
marketing to product feels seamless.

## Press assets

The `/press/assets/*` URLs referenced from the press page are placeholders.
Drop the real assets in `apps/marketing/press/assets/` and they'll resolve.
Suggested set:
- `lyfos-wordmark.zip` (SVG + PNG, white + black)
- `lyfos-icon.png` (1024×1024)
- `screenshots.zip` (web + iOS + Android)
- `founder.jpg` (1500×1500)
- `architecture.png` (release-engine diagram)

## Sitemap + robots

For SEO, add `sitemap.xml` and `robots.txt` at the root:

```
# robots.txt
User-agent: *
Allow: /
Sitemap: https://lyfos.in/sitemap.xml
```

## Analytics

Privacy-first only. If you add analytics, keep it minimal and document it in the privacy page.

## OpenGraph image

The hero pages reference `/og.png`. Create a 1200×630 image at
`apps/marketing/og.png` with the wordmark + tagline before public launch.

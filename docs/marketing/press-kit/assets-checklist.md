# Press-Kit Binary Assets

These need to ship as actual image / archive files. Drop them in
`apps/marketing/press/assets/` before launch.

| File                       | Spec                                                | Status |
|----------------------------|------------------------------------------------------|--------|
| `lyfos-wordmark.zip`       | SVG + PNG × (white + black + colour), `≤ 5 MB`        | TODO   |
| `lyfos-icon.png`           | 1024×1024 PNG, transparent + filled variants          | TODO   |
| `lyfos-icon-rounded.png`   | 1024×1024 with iOS-style corner radius                | TODO   |
| `screenshots-web.zip`      | 1280×800, 6 hero shots (home, vault, capture, release, settings, security panel) | TODO |
| `screenshots-ios.zip`      | 6.7" + 6.5" + 5.5" device frames, 6 shots each       | TODO   |
| `screenshots-android.zip`  | Pixel 7 + Pixel 7 Pro frames, 6 shots each            | TODO   |
| `founder.jpg`              | 1500×1500 colour headshot, plain background           | TODO   |
| `founder-landscape.jpg`    | 2400×1600 environmental portrait                      | TODO   |
| `architecture.png`         | 1600×900 release-engine diagram                       | TODO   |
| `og.png`                   | 1200×630 OpenGraph image with wordmark + tagline      | TODO   |

## How to capture web screenshots

```bash
# Use Playwright or a manual flow with browser dev tools at 1280×800.
# Set theme to default (#fbfbfd background), seed with the demo vault
# (?demo=1) so the screenshots are populated but anonymised.
```

## How to capture mobile screenshots

Use the Xcode simulator and Android emulator at the required device
sizes. iOS: use `xcrun simctl io booted screenshot screenshot.png`.
Android: use `adb shell screencap -p > screenshot.png`.

Frame them with the Apple + Google official mockup tools (`pictureframer`
or `device-shots`).

## Where these are referenced

- `apps/marketing/press/index.html` — assets table
- `apps/marketing/index.html` — `<meta property="og:image">`
- App Store + Play Store listings (separate copies under `apps/mobile/store/`)

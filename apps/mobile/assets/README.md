# Mobile assets

Drop the following PNG files in this directory before running
`eas build`:

| File              | Size       | Notes                                              |
|-------------------|------------|----------------------------------------------------|
| `icon.png`        | 1024×1024  | App icon. No transparency, no rounded corners.     |
| `splash.png`      | 1284×2778  | Splash for iOS hero. Match `#fbfbfd` bg.           |
| `adaptive-icon.png`| 1024×1024 | Android foreground layer of the adaptive icon.     |
| `notification-icon.png` | 96×96 | Monochrome icon for Android push notifications.    |

For the launch, generate them from the web icon at
`apps/web/public/icon.svg` rendered onto the same `#fbfbfd` background
as the web app. Keep it deliberately simple — Apple's HIG rejects
"text inside icon" so use the wordmark only in the splash, not the icon.

A 30-second preview video for App Store + Play Store is optional
but boosts conversion meaningfully. Record it after a fresh
populated-demo state. Keep it under 30 seconds and silent.

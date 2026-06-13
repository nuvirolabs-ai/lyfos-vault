# Launch-readiness: the 10 must-haves (new-user walkthrough)

I created a brand-new vault from zero and walked the product as a first-time
user would. These are the 10 things that must be true to launch *right now* —
a mix of bugs that embarrass on day one, conversion killers in the create
flow, and trust/safety gaps a mainstream user will hit in the first 5 minutes.

| # | Must-have | Why it blocks launch | Type |
|---|---|---|---|
| 1 | Capture box empty by default | A new user's "Add a record" box is **prefilled with fake "HDFC … password Demo@2026" data**. Looks broken/unsafe. | bug |
| 2 | Honest notification counts | Empty 0-record vault shows **"6 records need a look"** — those are setup tasks, not records. False alarms erode trust instantly. | bug |
| 3 | Passphrase strength meter | Zero-knowledge means a weak passphrase = a breakable vault. Mainstream users pick weak ones with no feedback. | safety |
| 4 | Low-friction recovery confirm | Creating a vault forces **re-typing all 24 recovery words**. Brutal drop-off. Replace with Copy/Download + a 3-word check. | conversion |
| 5 | Mobile-usable app | India is mobile-first; the unlocked shell must work on a 375px phone, not just the marketing site. | reach |
| 6 | Empty-home quick start | First-run needs an obvious "add your first record" path with starter suggestions, not just stat zeros. | activation |
| 7 | In-app help / contact | A product holding your will needs a visible way to reach a human. | trust |
| 8 | Honest release-plan state | When cloud sync is off, the release plan is a **local draft** — holders can't be invited. Must be unmistakable, never implied live. | honesty |
| 9 | No internal "OS-One" naming | Backup/error messages still say "OS-One" — the internal codename leaking to users. | polish |
| 10 | Graceful unknown route | Cold deep-links / bad URLs shouldn't show a blank or broken screen. | robustness |

## Status
Executing all 10 in `apps/web/src/main.jsx` (+ EntryScreen), rebuilding the
committed `dist/`, running the test suite, and pushing live. The app auto-deploys
to lyfos.signorvale.com on push.

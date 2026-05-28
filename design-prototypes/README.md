# Design Prototypes

Two design directions for Lyfos, prototyped at fidelity on the Home
screen. These are static HTML, no build step. Open `index.html` to flip
between them.

## How to view

### Locally
Open `design-prototypes/index.html` in a browser directly. Or:

```bash
cd design-prototypes
python3 -m http.server 8000
# open http://localhost:8000
```

### On the deployed site (Vercel)
The repo's `vercel.json` skips this directory by default. To preview
publicly, either:
1. Copy the prototypes to `apps/web/public/design/` and redeploy, or
2. Deploy `design-prototypes/` as a separate Vercel project (faster):
   ```bash
   cd design-prototypes
   npx vercel --prod
   ```

## What's here

| File                                | Direction                                      |
|-------------------------------------|------------------------------------------------|
| `index.html`                        | Picker page — links to A and B                 |
| `a-quiet-archive/index.html`        | A · Quiet Archive (editorial minimalism)       |
| `b-soft-concierge/index.html`       | B · Soft Concierge (warm, mobile-first)        |

## How to decide

1. View each at full-screen (desktop). Notice the typographic rhythm.
2. Resize the window to ~400px wide. Notice how the mobile case feels.
3. Spend 30 seconds in each just *being* there — don't analyse, react.

The right direction is the one that, after 30 seconds, feels like a
place you'd want to visit twice a year about your sensitive records.

## What's not in the prototype

These are Home-screen only — the decision the directions force is most
visible there. If you commit to a direction, the next screens to build
are: Vault (Life Map), Release Plan, and the unlock/auth flow. About a
day per screen per direction.

## Real-product copy

Both prototypes use realistic Indian-context content (HDFC, Kotak, SIP
in Parag Parikh Flexicap, INR formatting with lakhs/crores). The
typography rhythm — not just the colors or shapes — is the actual
production target if either is chosen.

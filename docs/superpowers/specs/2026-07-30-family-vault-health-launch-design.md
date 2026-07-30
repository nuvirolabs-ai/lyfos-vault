# Family Vault Health Launch Design

**Status:** Approved direction
**Product thesis:** Lyfos is a family vault health product with a personal balance sheet inside it.

## Intent

The first screen should answer one human question quickly: “Is my family protected?” It should reassure before it asks for work. Supporting information should establish trust without requiring comparison across several cards, and actions should be progressive: one clear next step first, deeper detail on demand.

The product is a desktop application. The composition should use a wide workspace, a slim collapsible navigation rail, generous spacing, and a primary/secondary hierarchy. It must not look like a mobile card stack stretched across a desktop viewport.

## Approved experience

### Home

- Use a horizontal desktop header with a contextual greeting and the sentence “Your family vault is in good shape.”
- Make family cover the dominant visual signal. Show one health percentage with a short explanation, such as “4 of 6 areas are protected.”
- Show only one recommended action in the first viewport. When nominee email is missing, the action is to add it; otherwise derive the most important unfinished vault action.
- Keep Circle of Trust, Balance Sheet, and freshness as quiet supporting signals below the primary area. They are entry points, not competing dashboard metrics.
- Preserve existing data and navigation affordances. Home health should be derived from the current vault model, not stored as a second source of truth.

### Circle of Trust and release

- Keep the owner setup flow for exactly five key holders because the existing cryptographic release plan requires five shares and a three-share threshold.
- Make the setup screen communicate the distinction clearly: five people hold keys, and any three accepted key holders are required to release the vault.
- Key-holder invites require a name/label and email. Email is sent after invite creation; the UI must show pending, accepted, verified, and invite failure states with a retry/manual-link fallback.
- A key holder must have a separate “someone else’s vault” release screen. It must identify the vault owner, show the three-of-five requirement, list the key-holder names, and clearly mark which keys have arrived and which are still needed.
- Do not claim that a release is complete until the backend has accepted at least three valid shares for the same release request and the existing release state reaches its ready state.
- Reuse the existing `releasePlan.js`, `HolderReleaseScreen.jsx`, `NomineeDownloadScreen.jsx`, and release request state machine wherever possible. UI changes must not bypass cryptographic share validation.

### Nominee email

- Nominee email is mandatory when creating or updating the release claim configuration.
- Validate a non-empty, valid-looking email before saving or generating the claim link.
- Keep the nominee label, but make the primary action and explanation about what the nominee can do and when they receive the key.
- Put secondary release rules below the active setup controls so the page leads with function rather than policy text.

### Personal balance sheet

- Treat the balance sheet as a personal financial view inside the family vault, not a generic records dashboard.
- Make adding an asset or liability the primary action.
- Show total assets, total liabilities, and net worth in a compact summary.
- Show a simple direction indicator based on the current entries, with language that is informative but not financial advice: assets growing, liabilities growing, or no change.
- Keep the existing account data model and editing paths where possible; improve presentation and reduce empty or decorative chart space.

### Navigation

- Add a persistent collapse/expand control to the desktop rail.
- In collapsed mode, keep recognizable icons, active state, and tooltips/accessible labels. Do not remove access to Home, records, Balance Sheet, Circle of Trust, areas, Add a record, or Settings.
- Preserve the current responsive mobile behavior; the desktop collapse control should not create a second mobile navigation system.

## Interaction principles

1. Recognition over recall: labels describe the state in plain language; percentages are supporting evidence, not the only explanation.
2. One decision at a time: the Home screen has one recommended action, not a list of equal urgency.
3. Reassurance before correction: show what is already protected before showing gaps.
4. Progressive disclosure: detailed area health, release rules, and financial breakdowns are one click away.
5. State honesty: pending, missing, awaiting, and complete must be visibly distinct. Never simulate a successful vault release in the live path.

## Out of scope for this launch slice

- Replacing Supabase schema or cryptographic primitives.
- Changing the five-holder share model to three holders. Three is the minimum shares needed for release; five remains the setup policy.
- Introducing investment recommendations, financial advice, or external account aggregation.
- A broad visual redesign of marketing pages.

## Acceptance criteria

- A desktop user can understand family vault health from the Home first viewport without opening multiple cards.
- The left rail can be collapsed and expanded without losing navigation access.
- A new nominee cannot save a release claim without a nominee email.
- Five key holders can be invited by email, and the owner sees delivery/acceptance state.
- A key holder sees whose vault they are helping release, the names of all five key holders, and the three-key minimum.
- A release request only becomes ready after three valid key shares are received; the nominee can then continue through the existing download flow.
- A user can add an asset or liability and immediately see updated assets, liabilities, and net worth.
- Existing unit tests and the production build pass.

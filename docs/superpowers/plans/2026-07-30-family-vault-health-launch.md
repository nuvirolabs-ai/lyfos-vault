# Family Vault Health Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Turn the live Lyfos web app into a calm desktop family-vault health product with a trustworthy 3-of-5 release flow, mandatory nominee email, a useful personal balance sheet, and collapsible navigation.

**Architecture:** Keep the current React/Vite monolith and Supabase release primitives. Add small pure helpers for Home health and release-state presentation, then update the existing `main.jsx`, `HolderReleaseScreen.jsx`, and `NomineeDownloadScreen.jsx` surfaces to consume real state. Keep cryptographic operations in `releasePlan.js` and claim operations in `releaseClaim.js`; no new data source is introduced.

**Tech Stack:** React 19, Vite, Tailwind utility classes, Supabase JS, Node's built-in test runner.

---

### Task 1: Add tested Home health and release-state helpers

**Files:**
- Create: `apps/web/src/lib/homeHealth.js`
- Test: `apps/web/src/lib/homeHealth.test.js`

- [ ] **Step 1: Write the failing tests**

Create tests for a stable helper contract:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveHomeHealth, getPrimaryHomeAction, summarizeReleaseKeys } from "./homeHealth.js";

const vault = (overrides = {}) => ({
  items: [],
  releaseSettings: { mainNominee: "", keyHolders: ["", "", "", "", ""] },
  ...overrides
});

test("empty vault starts at zero protected areas and asks for the first record", () => {
  const health = deriveHomeHealth(vault());
  assert.equal(health.completion, 0);
  assert.equal(health.protectedCount, 0);
  assert.equal(getPrimaryHomeAction(vault(), health).id, "capture");
});

test("missing nominee email is the primary setup action after records exist", () => {
  const current = vault({ items: [{ id: "1", type: "bank_account", title: "Family account", emergencyEligible: true, updatedAt: new Date().toISOString() }] });
  const health = deriveHomeHealth(current);
  assert.equal(getPrimaryHomeAction(current, health).id, "nominee-email");
});

test("release summary shows named holders and three-share threshold", () => {
  const result = summarizeReleaseKeys([
    { id: "a", label: "Anika", status: "verified" },
    { id: "b", label: "Rohan", status: "accepted" },
    { id: "c", label: "Maya", status: "pending" },
    { id: "d", label: "Kabir", status: "verified" },
    { id: "e", label: "Ira", status: "pending" }
  ]);
  assert.equal(result.required, 3);
  assert.equal(result.received, 2);
  assert.deepEqual(result.holders.map((holder) => holder.label), ["Anika", "Rohan", "Maya", "Kabir", "Ira"]);
  assert.equal(result.ready, false);
});

test("release summary becomes ready only after three valid shares", () => {
  const result = summarizeReleaseKeys([
    { label: "Anika", status: "verified", share_released: true },
    { label: "Rohan", status: "accepted", share_released: true },
    { label: "Maya", status: "verified", share_released: true }
  ]);
  assert.equal(result.received, 3);
  assert.equal(result.ready, true);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -w @os-one/web -- src/lib/homeHealth.test.js`

Expected: FAIL because `homeHealth.js` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Implement `deriveHomeHealth(vault)` by deriving areas with the same rules as the existing `getLifeModel`: protected areas count as 1, review areas as 0.45, exposed areas as 0, and release readiness as one additional protected dimension. Return `completion`, `protectedCount`, `reviewCount`, `exposedCount`, `totalAreas`, `releaseReady`, and `balance`.

Implement `getPrimaryHomeAction(vault, health)` with this order: empty records -> `{ id: "capture", label: "Add your first record" }`; missing nominee email from persisted release settings -> `{ id: "nominee-email", label: "Add an email for your nominee" }`; fewer than five key holders -> `{ id: "release", label: "Complete your trust circle" }`; otherwise the first exposed/review area -> `{ id: "area", areaId, label }`; otherwise `{ id: "healthy", label: "Your vault is up to date" }`.

Implement `summarizeReleaseKeys(holders)` with `required: 3`, `received` counting only `share_released === true` or an explicit release state that the current backend uses, `ready: received >= required`, and a normalized five-item `holders` list containing id, label, and state. Keep the function pure so screen tests do not need Supabase.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -w @os-one/web -- src/lib/homeHealth.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the helper slice**

Run: `git add apps/web/src/lib/homeHealth.js apps/web/src/lib/homeHealth.test.js && git commit -m "feat: add vault health state helpers"`

### Task 2: Replace Home with the desktop family-health composition

**Files:**
- Modify: `apps/web/src/main.jsx:1593-1765` (`HomeDashboard`)
- Modify: `apps/web/src/main.jsx:2182-2208` (Home layout width and sidebar)
- Modify: `apps/web/src/main.jsx` imports

- [ ] **Step 1: Add a failing rendering contract at the helper boundary**

Extend `homeHealth.test.js` with assertions that `getPrimaryHomeAction` returns the exact action IDs used by Home: `capture`, `nominee-email`, `release`, `area`, and `healthy`. This locks the navigation contract before JSX changes.

- [ ] **Step 2: Run the test and confirm the contract fails for any mismatched action ID**

Run: `npm test -w @os-one/web -- src/lib/homeHealth.test.js`

Expected: PASS for the helper contract before JSX changes; a future mismatch will fail immediately.

- [ ] **Step 3: Implement the desktop Home layout**

Import the helper and update `HomeDashboard` to:

```jsx
const health = useMemo(() => deriveHomeHealth(vault), [vault]);
const primaryAction = useMemo(() => getPrimaryHomeAction(vault, health), [vault, health]);
```

Render one wide first viewport with:

- a desktop header containing the greeting and “Your family vault is in good shape.” or an honest state-specific sentence;
- a dominant family-cover panel with percentage, protected-area count, and a link to vault health;
- one secondary next-action panel wired to the action ID;
- compact supporting rows for Circle of Trust, Balance Sheet, and last updated;
- existing record list/activity below the fold, reduced in visual weight;
- the empty-vault quick start using the same single-action hierarchy.

Remove the current equal-weight `VaultOverview`, dry-run banner, records overview bar, and large repeated home cards from the first viewport. Preserve those capabilities behind links or below the fold where they remain useful.

For `nominee-email`, navigate to `release` and let the claim panel focus itself or open its setup state. For `area`, call `onOpenArea(primaryAction.areaId)`. For `capture` and `release`, use `onNavigate`.

Update the Home shell to use a wider desktop max width and remove the always-visible Home-only right sidebar; the first viewport must not be a two-column mobile-looking card stack.

- [ ] **Step 4: Run tests and build**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: all existing tests pass and Vite produces a production build.

- [ ] **Step 5: Commit the Home slice**

Run: `git add apps/web/src/main.jsx apps/web/src/lib/homeHealth.test.js && git commit -m "feat: make home a family vault health view"`

### Task 3: Make the desktop navigation rail collapsible

**Files:**
- Modify: `apps/web/src/main.jsx:2090-2160` (app shell and rail)
- Modify: `apps/web/src/main.jsx:1766-1776` (`RailItem`)

- [ ] **Step 1: Add the rail state and persistence**

Add `const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem("lyfos-rail-collapsed") === "1");` in the shell component. Add a toggle button with `aria-label`, `title`, and an icon; persist `1`/`0` on change.

- [ ] **Step 2: Implement collapsed and expanded variants**

Use a stable desktop rail width in both modes. Expanded mode keeps current labels. Collapsed mode keeps icons, active state, counts, and a native tooltip/title. Keep the mobile bottom action and responsive behavior unchanged.

- [ ] **Step 3: Run the build and inspect the shell**

Run: `npm run build -w @os-one/web`

Expected: PASS. Verify no rail content overlaps the main Home heading at desktop width and that the toggle is keyboard reachable.

- [ ] **Step 4: Commit the navigation slice**

Run: `git add apps/web/src/main.jsx && git commit -m "feat: allow desktop rail collapse"`

### Task 4: Require nominee email and make setup action-led

**Files:**
- Modify: `apps/web/src/main.jsx:5328-5490` (`ClaimUrlPanel`)
- Test: `apps/web/src/lib/releaseClaim.test.js` if the existing claim helper is pure/testable; otherwise add validation to `homeHealth.test.js` only and keep UI validation local.

- [ ] **Step 1: Write the failing validation test**

Add a pure `isValidNomineeEmail(value)` helper in `releaseClaim.js` only if no equivalent exists, and test empty, malformed, and valid addresses. Do not send or persist a claim settings update when the helper returns false.

- [ ] **Step 2: Run the focused claim test and verify it fails**

Run: `npm test -w @os-one/web -- src/lib/releaseClaim.test.js`

Expected: FAIL until the helper exists, or PASS if an existing helper already satisfies the contract.

- [ ] **Step 3: Make email mandatory in `ClaimUrlPanel`**

Change the label from optional to required, add `required` and `autoComplete="email"`, validate before `upsertMyReleaseSettings`, show an inline error, and keep the Save button disabled while invalid or busy. Keep the label and note fields optional. Move the rule/explanation content below the active setup form and make the first action “Set up claim link” or “Save nominee”.

- [ ] **Step 4: Run tests and build**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: PASS.

- [ ] **Step 5: Commit the nominee slice**

Run: `git add apps/web/src/main.jsx apps/web/src/lib/releaseClaim.js apps/web/src/lib/releaseClaim.test.js && git commit -m "feat: require nominee email for release claim"`

### Task 5: Replace dummy release presentation with a real 3-of-5 journey

**Files:**
- Modify: `apps/web/src/main.jsx:4923-5298` (`ReleaseScreen`, `CloudKeyHolders`)
- Modify: `apps/web/src/HolderReleaseScreen.jsx`
- Modify: `apps/web/src/NomineeDownloadScreen.jsx`
- Modify: `apps/web/src/lib/releasePlan.js` only if existing state names cannot expose received-share state safely
- Test: `apps/web/src/lib/homeHealth.test.js` release summary tests from Task 1

- [ ] **Step 1: Define the live-state mapping before JSX changes**

Use the existing backend states from `releasePlan.js`: owner holder rows are pending/accepted/verified; a holder release request is active/approved/awaiting_shares/holding; nominee download becomes ready when the existing flow reports at least three shares. Add a small adapter only if the API shape requires it; do not infer a valid share from invite acceptance.

- [ ] **Step 2: Update owner setup copy and controls**

Change the setup heading and readiness copy to explain “5 trusted people hold keys; any 3 are needed to release the vault.” Keep invite email sending, retry/manual-link fallback, accepted/verified counts, and finalize gating. Remove copy that says the live release service is inactive where the cloud path is available. Keep local/draft mode visibly labeled as preview-only if it remains reachable.

- [ ] **Step 3: Build the key-holder release screen around the vault owner**

In `HolderReleaseScreen`, load the active request and render the owner identity, a prominent “You are helping open someone else’s vault” message, “3 of 5 keys required”, and five named holder columns/rows. Each row must show waiting, received, or this key-holder action state. Keep the passphrase/decryption action bound to `releaseMyShare`; disable it until the holder has a valid request and passphrase.

- [ ] **Step 4: Make nominee download state honest and legible**

In `NomineeDownloadScreen`, show the vault owner and named key holders when available, show `received of 3 required`, and distinguish waiting from ready. Keep the existing combine/download operation and ensure the UI never says ready based only on invited or accepted holders.

- [ ] **Step 5: Verify the release flow at unit and build level**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: PASS. Manually test the route sequence with a seeded/demo account: invite 5, accept/finalize, open a holder invite, submit one share, confirm the nominee screen remains waiting, submit 2 more valid shares, confirm ready state appears.

- [ ] **Step 6: Commit the release slice**

Run: `git add apps/web/src/main.jsx apps/web/src/HolderReleaseScreen.jsx apps/web/src/NomineeDownloadScreen.jsx apps/web/src/lib/releasePlan.js apps/web/src/lib/homeHealth.test.js && git commit -m "feat: activate three-of-five release experience"`

### Task 6: Make Balance Sheet a useful personal view

**Files:**
- Modify: `apps/web/src/main.jsx:2910-3095` (`HomeScreen`)
- Modify: `apps/web/src/main.jsx:2100-2115` (navigation labels only if needed)
- Test: `apps/web/src/lib/homeHealth.test.js` or create `apps/web/src/lib/balanceSheet.test.js` for pure summary/direction helpers

- [ ] **Step 1: Write the failing balance summary tests**

Test a pure `getBalanceSheetSummary(balanceSheet)` contract with accounts containing `kind: "asset"` and `kind: "liability"`: totals, net worth, and direction based on current period values. Assert empty data returns zero totals and a neutral direction.

- [ ] **Step 2: Implement the smallest pure balance helper**

Use the existing balance sheet account model discovered in `HomeScreen`. Return `{ assets, liabilities, netWorth, direction, accountCount }`; direction is `positive` when assets exceed liabilities and the current period has no worsening liability trend, `watch` when liabilities are rising or net worth is negative, and `neutral` when there is insufficient history. Do not provide investment recommendations.

- [ ] **Step 3: Recompose the Balance Sheet screen**

Make the first viewport show net worth, total assets, total liabilities, and one plain-language direction line. Put “Add asset” and “Add liability” beside the summary. Render accounts as a compact editable list grouped by asset/liability, retain existing add/edit/delete behavior, and move the P/L or cash-flow explanation below the core balance. Remove decorative/empty chart space unless it is backed by real period data.

- [ ] **Step 4: Run tests, build, and verify add/edit paths**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: PASS. Manually add one asset and one liability, edit both values, delete one, and confirm net worth updates after every operation.

- [ ] **Step 5: Commit the balance sheet slice**

Run: `git add apps/web/src/main.jsx apps/web/src/lib/balanceSheet.js apps/web/src/lib/balanceSheet.test.js && git commit -m "feat: simplify personal balance sheet"`

### Task 7: Full verification and production handoff

**Files:**
- Modify only files required by failing checks.

- [ ] **Step 1: Run the complete web test suite**

Run: `npm test -w @os-one/web`

Expected: all tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build -w @os-one/web`

Expected: Vite exits with code 0 and writes `apps/web/dist`.

- [ ] **Step 3: Run the app and inspect desktop/mobile states**

Run: `npm run dev:web -- --host 127.0.0.1`

Verify at desktop width: Home hierarchy, collapsed/expanded rail, nominee action, trust-circle setup, holder release state, nominee waiting/ready state, balance add/edit. Verify at mobile width: no horizontal overflow, mobile action remains reachable, rail is replaced by the existing responsive behavior.

- [ ] **Step 4: Review the final diff**

Run: `git diff origin/main...HEAD --stat` and `git status --short`.

Expected: only the implementation commits and pre-existing user changes are present; do not stage or revert unrelated files.

- [ ] **Step 5: Report verification and deployment readiness**

Include the exact test/build results, the local URL used for manual verification, and any release-flow dependency that still requires Supabase/Resend production configuration.

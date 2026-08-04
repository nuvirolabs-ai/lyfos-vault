import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RELEASE_POLICY } from "@os-one/vault-model";
import { LEGACY_CATEGORIES, getCategory, migrateLegacyVault, searchLegacyRecords } from "@os-one/digital-legacy";
import { DIGITAL_LEGACY_FEATURE_FLAGS } from "./legacy/featureFlags.js";
import MyLegacyScreen from "./legacy/MyLegacyScreen.jsx";
import LegacyCategoryScreen from "./legacy/LegacyCategoryScreen.jsx";
import LegacyRecordScreen from "./legacy/LegacyRecordScreen.jsx";
import LegacyRecordForm from "./legacy/LegacyRecordForm.jsx";
import {
  createStage1VaultRecord,
  decryptVaultWithPassphrase,
  decryptVaultWithRecoveryKey,
  generateRecoveryKey,
  normalizeRecoveryKey,
  updateEncryptedVault,
  envelopeIsLegacyKdf,
  upgradeEnvelopeKdf,
} from "./lib/stage1Crypto.js";
import { appendAuditEvent, appendAuditEvents, getAuditGroups } from "./lib/stage1Audit.js";
import {
  clearStage1Record,
  loadBackupHealth,
  loadStage1Record,
  saveBackupHealth,
  saveDigitalLegacyPreMigrationBackup,
  saveStage1Record
} from "./lib/stage1Store.js";
import { copyToClipboardWithAutoClear } from "./lib/clipboard.js";
import {
  createPendingAuditEvent,
  drainPendingAuditEvents,
  formatLockReason,
  getAutoLockLabel,
  isRecentlyAuthenticated,
  loadAutoLockPolicy,
  LOCK_TIMEOUT_OPTIONS,
  saveAutoLockPolicy,
  shouldAutoLockForActivity,
  shouldLockForVisibility
} from "./lib/stage1Session.js";
import {
  attachmentKind,
  deleteAttachmentFromRecord,
  readFileAsAttachment,
  readFilesAsAttachments,
  replaceAttachmentOnRecord,
  revokeAttachmentPreviews
} from "./lib/stage1Attachments.js";
import {
  deriveBackupHealth,
  getBackupHealthCopy,
  markBackupExported,
  markBackupUnknownAfterRestore,
  markBackupVerificationFailed,
  markBackupVerified
} from "./lib/stage2BackupHealth.js";
import { verifyBackup } from "./lib/stage2BackupVerification.js";
import { getBackupReminderCopy } from "./lib/stage2BackupReminders.js";
import { prepareStage2BackupExport } from "./lib/stage2BackupManifest.js";
import { initTelemetry, registerServiceWorker } from "./lib/telemetry.js";
import { buildSnapshotsCsv, suggestedCsvFilename } from "./lib/csvExport.js";
import { formatCurrency, formatCompact, DEFAULT_CURRENCY } from "./lib/currency.js";
import { listMyKeyHolders, createKeyHolderInvite, requeueKeyHolderInvite, revokeKeyHolder, deleteKeyHolder, sendInviteEmail, activateCircleGeneration, summarizeKeyHolders, buildTrustRosterSlots, listKeysIHeld, summarizeHeldKeys } from "./lib/releasePlan.js";
import { buildExternalAppUrl } from "./lib/appUrls.js";
import { validateCircleForActivation } from "./lib/recoveryCeremony.js";
import { loadMyReleaseSettings, upsertMyReleaseSettings, rotateMyClaimToken, fetchActiveReleaseAgainstMe, ownerAbortRelease, isValidNomineeEmail } from "./lib/releaseClaim.js";
import { fetchMySubscription, fetchMyBillingEvents, fetchMyBillingProfile, upsertMyBillingProfile, fetchInvoiceUrl, joinVaultFallWaitlist, startUpgrade, validateCoupon } from "./lib/billing.js";
import { planFor, entitlementsFor, daysLeftFor, paidPlans } from "./lib/plans.js";
import { isSupabaseConfigured } from "./lib/supabaseClient.js";
import { getSession, onAuthStateChange, signOut, appendServerAuditEvent, ensureDeviceToken, getDeviceToken, deleteAccount, signInWithPassword, signUpWithPassword } from "./lib/auth.js";
import {
  pushEncryptedRecord,
  fetchEncryptedRecord,
  reconcileLocalAndServer,
  registerOrTouchDevice,
  deleteEncryptedRecord,
  listDevices as listDevicesFromSync,
  renameDevice as renameDeviceFromSync,
  revokeDevice as revokeDeviceFromSync
} from "./lib/vaultSync.js";
import { AuthScreen, isInvalidCredentials, humanizeAuthError } from "./AuthScreen.jsx";
import { InviteAcceptScreen } from "./InviteAcceptScreen.jsx";
import { ClaimScreen } from "./ClaimScreen.jsx";
import { NomineeEntryScreen } from "./NomineeEntryScreen.jsx";
import { AdminScreen } from "./AdminScreen.jsx";
import { AbortScreen } from "./AbortScreen.jsx";
import { HolderReleaseScreen } from "./HolderReleaseScreen.jsx";
import { NomineeDownloadScreen } from "./NomineeDownloadScreen.jsx";
import {
  canConfirmDestructiveRestore,
  createRestoreDryRun,
  DESTRUCTIVE_RESTORE_CONFIRMATION
} from "./lib/stage2RestorePreview.js";
import {
  cancelRecoveryKeyReplacement,
  confirmRecoveryKeyReplacement,
  createRecoveryKeyMetadata,
  startRecoveryKeyReplacement
} from "./lib/stage2RecoveryKey.js";
import { getBackupSizeWarning } from "./lib/stage2BackupSize.js";
import { deriveHomeHealth, getPrimaryHomeAction } from "./lib/homeHealth.js";
import { getBalanceSheetSummary } from "./lib/balanceSheet.js";
import "./styles.css";

const PUBLIC_APP_URL = (import.meta.env ?? {}).VITE_APP_URL || "https://app.lyfos.in";

const AREAS = [
  {
    id: "identity",
    label: "Identity",
    types: ["identity_document"],
    promise: "IDs, certificates, legal proof",
    description: "The proof of who you are and where official identity documents can be found.",
    suggested: ["Passport", "Aadhaar / national ID", "Birth or marriage certificate"]
  },
  {
    id: "money",
    label: "Money",
    types: ["bank_account", "card"],
    promise: "Accounts, cards, balances, obligations",
    description: "The accounts, cards, balances, and obligations your nominee must understand first.",
    suggested: ["Primary bank account", "Credit cards", "Loan or EMI account"]
  },
  {
    id: "access",
    label: "Access",
    types: ["password", "pin", "email_account"],
    promise: "Passwords, PINs, recovery routes",
    description: "The digital access routes that make recovery possible without panic.",
    suggested: ["Primary email", "Apple / Google account", "Phone and device PINs"]
  },
  {
    id: "insurance",
    label: "Insurance",
    types: ["insurance_policy"],
    promise: "Policies, claims, nominee evidence",
    description: "The claimable protection your family should be able to activate cleanly.",
    suggested: ["Term insurance", "Health policy", "Vehicle or property cover"]
  },
  {
    id: "property",
    label: "Documents",
    types: ["important_document"],
    promise: "Assets, papers, locations",
    description: "The documents and instructions behind physical assets, lockers, and ownership.",
    suggested: ["Home papers", "Locker inventory", "Investment folio documents"]
  },
  {
    id: "instructions",
    label: "Emergency",
    types: ["emergency_instruction"],
    promise: "What your family must do first",
    description: "The human sequence: who to call, what not to touch, and the first decisions to avoid.",
    suggested: ["First 72 hours", "People to call", "Do-not-sell instructions"]
  }
];

const TYPE_OPTIONS = [
  ["bank_account", "Bank / money"],
  ["password", "Password"],
  ["pin", "PIN / device code"],
  ["email_account", "Email account"],
  ["card", "Card"],
  ["identity_document", "ID document"],
  ["insurance_policy", "Insurance"],
  ["important_document", "Important document"],
  ["emergency_instruction", "Emergency instruction"]
];

const EMPTY_ITEM = {
  type: "important_document",
  title: "",
  username: "",
  secret: "",
  bankDetails: "",
  cardDetails: "",
  email: "",
  notes: "",
  financial: { kind: "none", value: "", liability: "", income: "", expense: "" },
  emergencyEligible: true,
  attachments: []
};

const EMPTY_AI_DRAFT = {
  type: "important_document",
  title: "",
  username: "",
  secret: "",
  bankDetails: "",
  notes: "",
  financial: { kind: "none", value: "", liability: "", income: "", expense: "" },
  extractedFields: [],
  warnings: [],
  needsConfirmation: true,
  confidence: 0
};

// Tiny URL matcher — extracts the token segment after a known prefix
// (e.g. "/invite/abc123" → "abc123"). Returns null if no match.
// We don't have a router; for the handful of public routes Lyfos
// needs (invite, claim, abort), this is plenty.
function matchPathToken(prefix) {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  if (!path.startsWith(prefix)) return null;
  const token = path.slice(prefix.length).split("/")[0];
  return token || null;
}

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function createEmptyVault() {
  return {
    version: 1,
    items: [],
    releaseSettings: {
      mainNominee: "",
      keyHolders: ["", "", "", "", ""],
      emergencyOnly: true
    },
    balanceSheet: createEmptyBalanceSheet(),
    audit: [{ id: crypto.randomUUID(), event: "Vault created", at: new Date().toISOString() }]
  };
}

function createEmptyBalanceSheet() {
  return { accounts: [], snapshots: [], goal: null };
}

/**
 * Goal shape (single goal at a time in v1):
 *   { id, targetNet: number, targetDate: "YYYY-MM-DD", label?: string, createdAt: ISO }
 *
 * Progress is computed live against the latest snapshot — the goal itself
 * doesn't store the starting net worth (a user might add a goal mid-journey
 * and the chart should show progress from "now", not from zero).
 */
function computeGoalProgress({ goal, currentNet, firstSnapshotNet }) {
  if (!goal || !goal.targetNet) return null;
  const start = Number.isFinite(firstSnapshotNet) ? firstSnapshotNet : currentNet;
  const target = Number(goal.targetNet) || 0;
  const range = target - start;
  if (range === 0) return { pct: 100, currentNet, target, daysLeft: daysUntil(goal.targetDate) };
  const raw = ((currentNet - start) / range) * 100;
  const pct = Math.max(0, Math.min(100, raw));
  return { pct, currentNet, target, daysLeft: daysUntil(goal.targetDate) };
}

function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
}

export const BALANCE_SHEET_CATEGORIES = [
  { id: "cash",         kind: "asset",     label: "Cash & bank",      hint: "Savings, current, FDs" },
  { id: "investments",  kind: "asset",     label: "Investments",      hint: "Stocks, MFs, NPS, PPF, EPF, bonds" },
  { id: "real_estate",  kind: "asset",     label: "Real estate",      hint: "Property at your own valuation" },
  { id: "gold",         kind: "asset",     label: "Gold & jewellery", hint: "Physical and digital gold" },
  { id: "vehicles",     kind: "asset",     label: "Vehicles",         hint: "Cars, bikes (current resale value)" },
  { id: "crypto",       kind: "asset",     label: "Crypto",           hint: "Holdings in INR" },
  { id: "other_asset",  kind: "asset",     label: "Other assets",     hint: "Anything else of value" },
  { id: "home_loan",    kind: "liability", label: "Home loan",        hint: "Outstanding principal" },
  { id: "personal_loan",kind: "liability", label: "Personal loan",    hint: "Outstanding principal" },
  { id: "car_loan",     kind: "liability", label: "Car / vehicle loan", hint: "Outstanding principal" },
  { id: "credit_card",  kind: "liability", label: "Credit card",      hint: "Unpaid balance" },
  { id: "other_debt",   kind: "liability", label: "Other debt",       hint: "Any other liability" }
];

function categoryById(id) {
  return BALANCE_SHEET_CATEGORIES.find((c) => c.id === id) ?? null;
}

function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function shortMonthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" });
}

function snapshotForMonth(snapshots, key) {
  return (snapshots ?? []).find((s) => s.month === key) ?? null;
}

function hasAnyHistory(vault, accountId) {
  const snaps = vault?.balanceSheet?.snapshots ?? [];
  return snaps.some((s) => (s.values?.[accountId] ?? 0) > 0);
}

function netWorthFromValues(accounts, values) {
  let assets = 0;
  let liabilities = 0;
  for (const acc of accounts) {
    const v = Number(values?.[acc.id] ?? 0) || 0;
    if (acc.kind === "liability") liabilities += v;
    else assets += v;
  }
  return { assets, liabilities, net: assets - liabilities };
}

function buildMonthlySeries(balanceSheet, monthsBack = 12) {
  const accounts = balanceSheet?.accounts ?? [];
  const snapshots = [...(balanceSheet?.snapshots ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  const today = new Date();
  const keys = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    keys.push(monthKey(d));
  }
  const series = [];
  let lastValues = null;
  let lastWasReal = false;
  for (const key of keys) {
    const snap = snapshotForMonth(snapshots, key);
    if (snap) {
      lastValues = snap.values;
      lastWasReal = true;
      const totals = netWorthFromValues(accounts, snap.values);
      series.push({ month: key, ...totals, carried: false, empty: false });
    } else if (lastValues) {
      const totals = netWorthFromValues(accounts, lastValues);
      series.push({ month: key, ...totals, carried: true, empty: false });
      lastWasReal = false;
    } else {
      series.push({ month: key, assets: 0, liabilities: 0, net: 0, carried: false, empty: true });
    }
  }
  return series;
}

// Currency formatters routed through ./lib/currency.js so swapping the
// vault's currency (or going multi-currency later) is a one-line change.
// `formatINR` / `formatINRCompact` names kept for backward compatibility
// with the rest of the file; they accept an optional currency code.
function formatINR(value, code) {
  return formatCurrencyForVault(value, code);
}

function formatINRCompact(value, code) {
  return formatCompactForVault(value, code);
}

// Wrap the lib helpers so we can route the vault's `currency` preference
// in once we expose UI for it. For now both read DEFAULT_CURRENCY (INR).
function formatCurrencyForVault(value, code) {
  return formatCurrency(value, code ?? DEFAULT_CURRENCY);
}
function formatCompactForVault(value, code) {
  return formatCompact(value, code ?? DEFAULT_CURRENCY);
}

// Demo vault data is intentionally NOT bundled with the default chunk.
// See apps/web/src/lib/demoData.js — loaded on demand via dynamic import
// only when the user visits ?demo=1 or clicks "Load demo" in Settings.
async function loadDemoVaultModule() {
  const mod = await import("./lib/demoData.js");
  return mod.buildDemoVault({ EMPTY_ITEM, monthKey });
}

// Demo data stays out of the normal experience — it only surfaces with ?demo=1.
function demoEnabled() {
  try { return new URLSearchParams(window.location.search).get("demo") === "1"; } catch { return false; }
}

// Real production helper — builds a small text attachment around captured input.
function buildTextAttachment(name, text) {
  return {
    id: crypto.randomUUID(),
    name,
    type: "text/plain",
    size: text.length,
    dataUrl: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`
  };
}

async function persistVault(key, vault, recordMeta) {
  const nextRecord = await updateEncryptedVault(recordMeta, key, vault);
  saveStage1Record(localStorage, nextRecord);
  return nextRecord;
}

function downloadTextFile(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseMoney(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function getFinancialSnapshot(items) {
  return items.reduce((acc, item) => {
    const financial = item.financial ?? {};
    acc.assets += parseMoney(financial.value);
    acc.liabilities += parseMoney(financial.liability);
    acc.income += parseMoney(financial.income);
    acc.expenses += parseMoney(financial.expense);
    return acc;
  }, { assets: 0, liabilities: 0, income: 0, expenses: 0 });
}

function areaState(area, items) {
  const records = items.filter((item) => area.types.includes(item.type));
  if (records.length === 0) return "exposed";
  const emergencyReady = records.filter((item) => item.emergencyEligible);
  const stale = records.some((item) => {
    if (!item.updatedAt) return true;
    return (Date.now() - new Date(item.updatedAt).getTime()) / 86400000 > 90;
  });
  if (stale || emergencyReady.length !== records.length) return "review";
  return "protected";
}

function getLifeModel(vault) {
  const areas = AREAS.map((area) => {
    const records = vault.items.filter((item) => area.types.includes(item.type));
    return { ...area, count: records.length, state: areaState(area, vault.items) };
  });
  const protectedCount = areas.filter((area) => area.state === "protected").length;
  const exposedCount = areas.filter((area) => area.state === "exposed").length;
  const reviewCount = areas.filter((area) => area.state === "review").length;
  const keyCount = vault.releaseSettings.keyHolders.filter((holder) => holder.trim()).length;
  const releaseReady = vault.releaseSettings.mainNominee.trim() && keyCount >= RELEASE_POLICY.requiredKeys;
  const completion = Math.round(((protectedCount * 1 + reviewCount * 0.45 + (releaseReady ? 1 : 0)) / (areas.length + 1)) * 100);
  return {
    areas,
    protectedCount,
    exposedCount,
    reviewCount,
    keyCount,
    releaseReady,
    completion,
    nextGap: areas.find((area) => area.state === "exposed") ?? areas.find((area) => area.state === "review") ?? null,
    financial: getFinancialSnapshot(vault.items)
  };
}

function getAreaForType(type) {
  return AREAS.find((area) => area.types.includes(type)) ?? AREAS[4];
}

// ---------------------------------------------------------------------
// "Needs a look" — a time-aware attention engine derived from the real
// vault. Surfaces upcoming dates found in record text, stale access
// records, unfinished records, empty critical areas, and a missing
// nominee. Pure function, no side effects — safe and testable.
// ---------------------------------------------------------------------
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

function findUpcomingDate(text) {
  if (!text) return null;
  const now = new Date();
  const candidates = [];
  // "12 Nov 2026" / "Nov 2026" / "December 2027"
  const re1 = /\b(?:(\d{1,2})\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/gi;
  let m;
  while ((m = re1.exec(text))) {
    const d = new Date(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], m[1] ? Number(m[1]) : 28);
    candidates.push(d);
  }
  // "exp 12/26" / "expiry 03/2027" / "valid till 12/26"
  const re2 = /\b(?:exp|expiry|expires|valid\s*(?:till|until|thru)|renew(?:s|al)?|matur\w*)\D{0,8}(\d{1,2})\/(\d{2,4})\b/gi;
  while ((m = re2.exec(text))) {
    const month = Math.min(12, Math.max(1, Number(m[1]))) - 1;
    const yr = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    candidates.push(new Date(yr, month, 28));
  }
  const future = candidates
    .filter((d) => !isNaN(d) && d.getTime() >= now.getTime() - 86400000)
    .sort((a, b) => a - b);
  if (!future.length) return null;
  const d = future[0];
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (days > 400) return null;
  return { date: d, days };
}

function relativeWhen(days) {
  if (days <= 0) return "now";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

function deriveAttention(vault) {
  const items = vault?.items ?? [];
  const now = Date.now();
  const out = [];

  items.forEach((it) => {
    const blob = [it.notes, it.bankDetails, it.cardDetails, it.title].filter(Boolean).join(" · ");
    const hit = findUpcomingDate(blob);
    if (hit) {
      out.push({
        key: `exp-${it.id}`,
        tone: hit.days <= 14 ? "urgent" : hit.days <= 45 ? "soon" : "info",
        area: getAreaForType(it.type).id,
        title: `${it.title || typeLabel(it.type)} — renews soon`,
        sub: "A date in this record is coming up. Check it's still current.",
        when: relativeWhen(hit.days),
        sort: hit.days
      });
    }
  });

  items.forEach((it) => {
    if (!["password", "pin", "email_account"].includes(it.type) || !it.updatedAt) return;
    const days = (now - new Date(it.updatedAt).getTime()) / 86400000;
    if (days > 180) {
      out.push({
        key: `stale-${it.id}`,
        tone: "soon",
        area: "access",
        title: `${it.title || "A password"} is getting old`,
        sub: `Last updated ${Math.round(days / 30)} months ago · consider refreshing it`,
        when: `${Math.round(days / 30)} mo`,
        sort: 500 - days
      });
    }
  });

  items.forEach((it) => {
    if (it.title && !recordHasContent(it)) {
      out.push({
        key: `incomplete-${it.id}`,
        tone: "info",
        area: getAreaForType(it.type).id,
        title: `Finish "${it.title}"`,
        sub: "This record was started but never filled in.",
        when: "Unfinished",
        sort: -5
      });
    }
  });

  const model = getLifeModel(vault);
  model.areas.filter((a) => a.state === "exposed").forEach((a) => {
    out.push({
      key: `empty-${a.id}`,
      tone: a.id === "instructions" ? "soon" : "info",
      area: a.id,
      title: `${a.label} is still empty`,
      sub: a.promise,
      when: "Add",
      sort: a.id === "instructions" ? -8 : -3
    });
  });

  if (!vault?.releaseSettings?.mainNominee?.trim()) {
    out.push({
      key: "nominee",
      tone: "urgent",
      area: "release",
      title: "Choose who your vault is for",
      sub: "Name a nominee so your family can recover everything.",
      when: "Set up",
      sort: -10
    });
  }

  const toneRank = { urgent: 0, soon: 1, info: 2, ok: 3 };
  return out.sort((a, b) => (toneRank[a.tone] - toneRank[b.tone]) || (a.sort - b.sort)).slice(0, 6);
}

function timeAgo(iso) {
  if (!iso) return "";
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 0.04) return "just now";
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${Math.round(days)} days ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}

// Notifications derived from real vault state — actionable alerts first
// (attention, backup, release gaps), then recent audit history.
function deriveNotifications(vault, backupHealth) {
  const out = [];
  const attention = deriveAttention(vault);
  // Only genuine record-level items count as "records need a look" — empty-area
  // and nominee prompts are setup, surfaced separately, and must not inflate this.
  const recordAttn = attention.filter((a) => /^(exp|stale|incomplete)-/.test(a.key)).length;
  if (recordAttn > 0) {
    out.push({ key: "att", tone: "amber", unread: true, text: `${recordAttn} record${recordAttn > 1 ? "s" : ""} need a look`, time: "now", action: "life", actionLabel: "Review" });
  }
  const reminder = getBackupReminderCopy(backupHealth ?? {});
  if (reminder.level && reminder.level !== "none") {
    out.push({ key: "backup", tone: reminder.level === "failed" ? "red" : "amber", unread: true, text: "Back up your encrypted vault", time: "now", action: "settings", actionLabel: "Back up" });
  }
  const holders = (vault.releaseSettings?.keyHolders ?? []).filter((h) => h.trim()).length;
  if (!vault.releaseSettings?.mainNominee?.trim() || holders < RELEASE_POLICY.requiredKeys) {
    out.push({ key: "release", tone: "blue", unread: true, text: "Finish your release plan", time: "now", action: "release", actionLabel: "Open" });
  }
  (vault.audit ?? []).slice(0, 6).forEach((a, i) => {
    out.push({ key: `audit-${a.id ?? i}`, tone: "neutral", unread: false, text: a.event, time: timeAgo(a.at) });
  });
  return out;
}

function NotificationBell({ vault, backupHealth, onNavigate, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const notifs = useMemo(() => deriveNotifications(vault, backupHealth), [vault, backupHealth]);
  const unread = notifs.filter((n) => n.unread).length;
  const toneDot = { red: "bg-[var(--red)]", amber: "bg-[var(--amber)]", blue: "bg-[var(--blue)]", neutral: "bg-[var(--ink-5)]" };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] transition hover:text-[var(--ink)]"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8 a6 6 0 0 0 -12 0 c0 7 -3 9 -3 9 h18 s-3 -2 -3 -9" /><path d="M10.5 21 a2 2 0 0 0 3 0" /></svg>
        {unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--red)] px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_54px_rgba(0,0,0,0.22)]">
            <div className="border-b border-[var(--line)] px-4 py-3 text-[14px] font-semibold text-[var(--ink)]">Notifications</div>
            <div className="max-h-[60vh] overflow-y-auto">
              {notifs.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-[var(--ink-3)]">You're all caught up.</div>}
              {notifs.map((n) => (
                <div key={n.key} className={cx("flex items-center gap-3 border-b border-[var(--line)] px-4 py-3", n.unread && "bg-[var(--green-soft)]")}>
                  <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", toneDot[n.tone])} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug text-[var(--ink)]">{n.text}</div>
                    <div className="mt-0.5 text-[11.5px] text-[var(--ink-4)]">{n.time}</div>
                  </div>
                  {n.action && (
                    <button
                      onClick={() => { setOpen(false); n.action === "settings" ? onOpenSettings?.() : onNavigate?.(n.action); }}
                      className="shrink-0 rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
                    >
                      {n.actionLabel}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function typeLabel(type) {
  return TYPE_OPTIONS.find(([id]) => id === type)?.[1] ?? "Record";
}

function releaseLabel(item) {
  if (!item.emergencyEligible) return "Private";
  if (!item.updatedAt) return "Needs review";
  const days = (Date.now() - new Date(item.updatedAt).getTime()) / 86400000;
  return days > 90 ? "Needs review" : "Emergency-enabled";
}

function releaseTone(status) {
  if (status === "Emergency-enabled") return "bg-[#34c759]/10 text-[var(--green-ink)] border-[#34c759]/20";
  if (status === "Needs review") return "bg-[#c88719]/10 text-[#8a6400] border-[#c88719]/20";
  return "bg-[#1d1d1f]/6 text-[var(--ink-2)] border-[var(--line-2)]";
}

function releaseToneDark(status) {
  if (status === "Emergency-enabled") return "border-[#72d98a]/25 bg-[#72d98a]/12 text-[#b7f3c4]";
  if (status === "Needs review") return "border-[#ffd166]/25 bg-[#ffd166]/12 text-[#ffe0a3]";
  return "border-white/10 bg-white/8 text-white/58";
}

function confidenceLabel(score = 0) {
  if (score >= 86) return "High";
  if (score >= 65) return "Medium";
  return "Low";
}

function createBlankRecord(area) {
  return {
    ...EMPTY_ITEM,
    type: area.types[0],
    title: "",
    emergencyEligible: true,
    attachments: [],
    financial: { kind: "none", value: "", liability: "", income: "", expense: "" }
  };
}

function attachmentIcon(kind) {
  if (kind === "Image") return "IMG";
  if (kind === "PDF") return "PDF";
  if (kind === "Document") return "DOC";
  if (kind === "Text") return "TXT";
  return "FILE";
}

function analyzeMessyInput(text) {
  const lower = text.toLowerCase();
  const bankMatch = text.match(/\b(hdfc|icici|sbi|axis|kotak|yes bank|indusind|idfc|bank of baroda|canara)\b/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const ifscMatch = text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/i);
  const policyMatch = text.match(/\b(?:policy|pol)\D*([A-Z0-9-]{5,})/i);
  const cardMatch = text.match(/\b(?:card|cc|credit|debit)\D*(?:ending|no|number)?\D*([0-9]{4}(?:[ -]?[0-9]{4}){0,3})/i);
  const accountMatch = text.match(/\b(?:account|a\/c|acct|customer id|cust id)\D*([A-Z0-9@._-]{4,})/i);
  const passwordMatch = text.match(/\b(?:netbanking\s+password|password|pwd|pass)\s*(?:is|:|=|-)?\s*([A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|.<>/?]{6,64})/i);
  const pinMatch = text.match(/\b(?:pin|passcode|locker code|device code|code)\s*(?:is|:|=|-)?\s*([0-9]{4,8})\b/i);
  const phoneMatch = text.match(/(?:\+91[- ]?)?[6-9][0-9]{9}/);
  const nomineeMatch = text.match(/\bnominee\D*([A-Za-z ]{3,40})/i);
  const amountMatch = text.match(/(?:balance|value|amount|sum assured|limit|worth|rs|inr)\D*([0-9][0-9,]*)/i);
  const expiryMatch = text.match(/\b(?:exp|expiry)\D*([0-9]{2}\/[0-9]{2,4})/i);
  const secretValue = passwordMatch?.[1] ?? pinMatch?.[1] ?? "";
  const warnings = [];
  const confidenceSignals = [bankMatch, emailMatch, ifscMatch, policyMatch, cardMatch, accountMatch, secretValue, phoneMatch, nomineeMatch, amountMatch].filter(Boolean).length;

  let type = "important_document";
  let title = "Structured life record";
  let kind = "none";

  if (lower.includes("gmail") || lower.includes("email")) {
    type = "email_account";
    title = "Recovered email access";
  } else if (lower.includes("bank") || lower.includes("ifsc") || lower.includes("account")) {
    type = "bank_account";
    title = `${bankMatch?.[1]?.toUpperCase() ?? "Bank"} account`;
    kind = "asset";
  } else if (lower.includes("policy") || lower.includes("insurance") || lower.includes("lic")) {
    type = "insurance_policy";
    title = "Insurance policy";
    kind = "asset";
  } else if (lower.includes("card") || lower.includes("credit")) {
    type = "card";
    title = "Card record";
    kind = "liability";
  } else if (lower.includes("pin")) {
    type = "pin";
    title = "PIN record";
  }

  if (passwordMatch && /^\d{4,6}$/.test(passwordMatch[1])) {
    warnings.push("Password looks like a short PIN. Confirm this before saving.");
  }
  if (type === "bank_account" && cardMatch) {
    warnings.push("This capture also contains card details. Consider saving a separate card dossier.");
  }
  if (!secretValue) {
    warnings.push("No password, PIN, or code was confidently detected.");
  }

  const field = (label, value, source, confidence = "Medium") => value ? { label, value, source, confidence } : null;
  const extractedFields = [
    field("Bank", bankMatch?.[1]?.toUpperCase(), "Matched known bank name", "High"),
    field("Email", emailMatch?.[0], "Matched email pattern", "High"),
    field("IFSC", ifscMatch?.[0]?.toUpperCase(), "Matched IFSC format", "High"),
    field("Policy", policyMatch?.[1], "Found policy label", "Medium"),
    field("Card", cardMatch?.[1], "Found card/ending label", "Medium"),
    field("Account / ID", accountMatch?.[1], "Found account/customer label", "Medium"),
    field("Password", passwordMatch?.[1], "Found password label", "High"),
    field("PIN / code", pinMatch?.[1], "Found PIN/code label", "High"),
    field("Phone", phoneMatch?.[0], "Matched phone pattern", "Medium"),
    field("Nominee", nomineeMatch?.[1]?.trim(), "Found nominee label", "Medium"),
    field("Amount", amountMatch?.[1], "Found balance/value label", "Medium"),
    field("Expiry", expiryMatch?.[1], "Found expiry label", "Medium")
  ].filter(Boolean);

  const details = [
    bankMatch && `Bank: ${bankMatch[1].toUpperCase()}`,
    ifscMatch && `IFSC: ${ifscMatch[0].toUpperCase()}`,
    accountMatch && `Account / Customer ID: ${accountMatch[1]}`,
    emailMatch && `Email: ${emailMatch[0]}`,
    cardMatch && `Card: ${cardMatch[1]}`,
    expiryMatch && `Expiry: ${expiryMatch[1]}`,
    policyMatch && `Policy: ${policyMatch[1]}`,
    phoneMatch && `Phone: ${phoneMatch[0]}`,
    nomineeMatch && `Nominee: ${nomineeMatch[1].trim()}`
  ].filter(Boolean).join("\n");

  return {
    ...EMPTY_AI_DRAFT,
    type,
    title,
    username: emailMatch?.[0] ?? accountMatch?.[1] ?? policyMatch?.[1] ?? cardMatch?.[1] ?? "",
    secret: secretValue,
    bankDetails: details || text.slice(0, 500),
    notes: `Structured from messy capture. Review every field before saving.\n\nOriginal:\n${text.slice(0, 500)}`,
    extractedFields,
    warnings,
    confidence: Math.min(96, 42 + confidenceSignals * 9),
    financial: {
      kind,
      value: kind === "asset" ? (amountMatch?.[1] ?? "") : "",
      liability: kind === "liability" ? (amountMatch?.[1] ?? "") : "",
      income: "",
      expense: ""
    }
  };
}

function analyzeMessyInputRecords(text) {
  const primary = analyzeMessyInput(text);
  const lower = text.toLowerCase();
  const records = [primary];
  const hasBank = lower.includes("bank") || lower.includes("ifsc") || lower.includes("account");
  const cardMatch = text.match(/\b(?:card|cc|credit|debit)\D*(?:ending|no|number)?\D*([0-9]{4}(?:[ -]?[0-9]{4}){0,3})/i);
  const cardLimit = text.match(/\b(?:limit|credit limit|outstanding)\D*([0-9][0-9,]*)/i);
  const policyMatch = text.match(/\b(?:policy|pol|lic)\D*([A-Z0-9-]{5,})/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const identityMatch = text.match(/\b(passport|aadhaar|aadhar|pan)\b/i);

  if (cardMatch && primary.type !== "card") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "card",
      title: "Card record",
      username: `Card ending ${cardMatch[1].slice(-4)}`,
      secret: "",
      cardDetails: `Card reference: ${cardMatch[1]}${cardLimit ? `\nLimit / amount: ${cardLimit[1]}` : ""}`,
      notes: `Split from the same messy capture. Confirm whether this should stay separate from the bank record.\n\nOriginal:\n${text.slice(0, 500)}`,
      emergencyEligible: false,
      extractedFields: [
        { label: "Card", value: cardMatch[1], source: "Found card/ending label", confidence: "Medium" },
        cardLimit && { label: "Limit", value: cardLimit[1], source: "Found limit label", confidence: "Medium" }
      ].filter(Boolean),
      warnings: ["Card details were found inside another capture. Save separately only after confirming."],
      needsConfirmation: true,
      confidence: hasBank ? 68 : 78,
      financial: { kind: "liability", value: "", liability: cardLimit?.[1] ?? "", income: "", expense: "" }
    });
  }

  if (policyMatch && primary.type !== "insurance_policy") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "insurance_policy",
      title: "Insurance policy",
      username: policyMatch[1],
      notes: `Policy-like details were detected. Confirm insurer, nominee, and claim contact before saving.\n\nOriginal:\n${text.slice(0, 500)}`,
      extractedFields: [{ label: "Policy", value: policyMatch[1], source: "Found policy/LIC label", confidence: "Medium" }],
      warnings: ["Policy record needs insurer, nominee, and claim contact before it is recovery-ready."],
      needsConfirmation: true,
      confidence: 70,
      financial: { kind: "asset", value: "", liability: "", income: "", expense: "" }
    });
  }

  if ((lower.includes("gmail") || lower.includes("email") || lower.includes("apple id") || lower.includes("google account")) && emailMatch && primary.type !== "email_account") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "email_account",
      title: lower.includes("apple") ? "Apple ID access" : "Email access",
      username: emailMatch[0],
      notes: `Access account detected. Confirm recovery phone, trusted device, and emergency visibility.\n\nOriginal:\n${text.slice(0, 500)}`,
      extractedFields: [{ label: "Email", value: emailMatch[0], source: "Matched email pattern", confidence: "High" }],
      warnings: ["No recovery route was detected. Add recovery phone/device notes before relying on this."],
      needsConfirmation: true,
      confidence: 74
    });
  }

  if (identityMatch && primary.type !== "identity_document") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "identity_document",
      title: `${identityMatch[1][0].toUpperCase()}${identityMatch[1].slice(1)} document`,
      username: identityMatch[1],
      notes: `Identity document mention detected. Add document number, storage location, and proof file.\n\nOriginal:\n${text.slice(0, 500)}`,
      extractedFields: [{ label: "Document", value: identityMatch[1], source: "Matched identity document keyword", confidence: "Low" }],
      warnings: ["Only the document type was detected. This is not enough for recovery."],
      needsConfirmation: true,
      confidence: 48
    });
  }

  return records.map((record, index) => ({
    ...record,
    candidateId: crypto.randomUUID(),
    reviewState: record.warnings?.length ? "Needs confirmation" : "Ready to review",
    title: record.title || `Captured record ${index + 1}`
  }));
}

function App() {
  const [storedRecord, setStoredRecord] = useState(null);
  const [vaultKey, setVaultKey] = useState(null);
  const [vault, setVault] = useState(null);
  const [notice, setNotice] = useState("");
  // A one-time confirmation ("Vault created...", "Synced from cloud...")
  // shouldn't sit on screen forever — auto-dismiss so it doesn't pile up
  // as permanent clutter above the actual page content.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [lockNotice, setLockNotice] = useState("");
  const [autoLockMs, setAutoLockMs] = useState(() => loadAutoLockPolicy(localStorage));
  const [backupHealth, setBackupHealth] = useState(() => loadBackupHealth(localStorage));
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(!isSupabaseConfigured());
  const [authBypass, setAuthBypass] = useState(false);     // user chose "continue without account"
  const [authPanelOpen, setAuthPanelOpen] = useState(false); // user clicked "Sign in" from Settings while having a local vault
  const [subscription, setSubscription] = useState(null);
  // Recent-auth gate: some actions (reveal, copy secrets, export, critical
  // delete) require the passphrase to have been entered within the last
  // few minutes, not just "vault is currently unlocked". `unlockedAt` is
  // the timestamp of the last successful passphrase entry; `pendingReauth`
  // holds the action waiting on a fresh reauth prompt, if any.
  const [unlockedAt, setUnlockedAt] = useState(null);
  const [pendingReauth, setPendingReauth] = useState(null);
  function runWithRecentAuth(action) {
    if (isRecentlyAuthenticated(unlockedAt)) { action(); return; }
    setPendingReauth({ action });
  }
  const entitlements = useMemo(() => entitlementsFor(subscription), [subscription]);
  const backupSizeWarning = useMemo(() => getBackupSizeWarning({
    encryptedPayloadBytes: storedRecord ? new TextEncoder().encode(JSON.stringify(storedRecord, null, 2)).byteLength : 0,
    encryptedAttachmentBytes: 0
  }), [storedRecord]);
  const vaultRef = useRef(null);
  const vaultKeyRef = useRef(null);
  const storedRecordRef = useRef(null);
  const autoLockMsRef = useRef(autoLockMs);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("lyfos-theme")) || "light";
    document.body.dataset.theme = saved === "dark" ? "dark" : "light";
    setStoredRecord(loadStage1Record(localStorage));
  }, []);

  // Hydrate the current Supabase session (if any) on first load, and stay
  // in sync if it changes (token refresh, sign-in in another tab, etc.).
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    ensureDeviceToken();
    let mounted = true;
    getSession()
      .then((s) => { if (mounted) { setSession(s); setSessionLoaded(true); } })
      .catch(() => { if (mounted) { setSession(null); setSessionLoaded(true); } });
    const unsubscribe = onAuthStateChange((next) => {
      if (!mounted) return;
      setSession(next);
      setSessionLoaded(true);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  // When a session arrives, also fetch the subscription state. Used to
  // gate features (vault item count, release plan) and render the
  // billing UI in Settings.
  useEffect(() => {
    if (!session) { setSubscription(null); return; }
    let cancelled = false;
    fetchMySubscription()
      .then((s) => { if (!cancelled) setSubscription(s); })
      .catch(() => { if (!cancelled) setSubscription(null); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!sessionLoaded || typeof window === "undefined" || !isSupabaseConfigured()) return;
    const { pathname, search, hash } = window.location;
    const shouldShowLogin = !session && !storedRecord && !authBypass;
    if (shouldShowLogin && pathname === "/") {
      window.history.replaceState(null, "", `/login${search}${hash}`);
    } else if (session && pathname === "/login") {
      window.history.replaceState(null, "", `/${search}${hash}`);
    }
  }, [sessionLoaded, session, storedRecord, authBypass]);

  // When a session arrives (sign-in or hydrated existing session):
  //   1. Register/touch this device
  //   2. Pull the server's encrypted record and reconcile against local
  // If the server has a newer copy, drop it into storedRecord — the user
  // still has to enter their passphrase on EntryScreen to actually unlock.
  // The server never sees the passphrase or the derived vault key.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        await registerOrTouchDevice({ deviceToken: getDeviceToken() });
      } catch {}
      if (cancelled) return;

      try {
        const { record: serverRecord } = await fetchEncryptedRecord();
        if (cancelled) return;
        const decision = reconcileLocalAndServer({ localRecord: storedRecordRef.current, serverRecord });
        if (decision.needsReplaceLocal && decision.record) {
          saveStage1Record(localStorage, decision.record);
          setStoredRecord(decision.record);
          setNotice("Synced from cloud. Unlock with your vault phrase.");
        } else if (decision.needsPush && decision.record) {
          // Local is newer (or server has nothing) — push so the server catches up.
          pushEncryptedRecord(decision.record).catch(() => {});
        }
      } catch (err) {
        if (typeof console !== "undefined") console.warn("[lyfos] cloud reconcile failed:", err?.message ?? err);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!storedRecord?.updatedAt) return;
    const derived = deriveBackupHealth({
      storedHealth: backupHealth,
      currentVault: { updatedAt: storedRecord.updatedAt }
    });
    if (derived.status !== backupHealth.status) updateBackupHealth(derived);
  }, [storedRecord?.updatedAt]);

  useEffect(() => {
    vaultRef.current = vault;
    vaultKeyRef.current = vaultKey;
    storedRecordRef.current = storedRecord;
    autoLockMsRef.current = autoLockMs;
  }, [vault, vaultKey, storedRecord, autoLockMs]);

  useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const checkAutoLock = () => {
      if (vaultRef.current && vaultKeyRef.current && shouldAutoLockForActivity(lastActivityRef.current, Date.now(), autoLockMsRef.current)) {
        lockVault("Auto-lock after inactivity");
      }
    };
    const handleVisibility = () => {
      if (vaultRef.current && vaultKeyRef.current && shouldLockForVisibility(document.visibilityState)) {
        lockVault("Auto-lock after app moved to background");
      }
    };
    const activityEvents = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(checkAutoLock, 10000);
    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, []);

  async function saveVault(nextVault, changeReason = "vault_changed") {
    const nextRecord = await persistVault(vaultKey, nextVault, storedRecord);
    setVault(nextVault);
    setStoredRecord(nextRecord);
    if (changeReason) {
      updateBackupHealth(deriveBackupHealth({
        storedHealth: backupHealth,
        currentVault: { updatedAt: nextRecord.updatedAt },
        changeReason
      }));
    }
    // Cloud push: fire-and-forget so the local save stays instant. The user's
    // local copy is the source of truth in the moment; the server is a backup
    // and a path to the next device. We pull and reconcile on session-load.
    if (session) {
      pushEncryptedRecord(nextRecord)
        .then((result) => {
          if (result?.synced) {
            appendServerAuditEvent("vault_pushed", { size: result.meta?.size_bytes }).catch(() => {});
          }
        })
        .catch((err) => {
          if (typeof console !== "undefined") console.warn("[lyfos] cloud push failed:", err?.message ?? err);
        });
    }
  }

  function updateBackupHealth(nextHealth) {
    const saved = saveBackupHealth(localStorage, nextHealth);
    setBackupHealth(saved);
    return saved;
  }

  async function lockVault(reason = "Manual lock") {
    const lockReason = typeof reason === "string" ? reason : "Manual lock";
    const currentVault = vaultRef.current;
    const currentKey = vaultKeyRef.current;
    const currentRecord = storedRecordRef.current;
    setVaultKey(null);
    setVault(null);
    setUnlockedAt(null);
    setPendingReauth(null);
    setLockNotice(formatLockReason(lockReason));
    setNotice(formatLockReason(lockReason));
    if (currentVault && currentKey && currentRecord) {
      try {
        const auditedVault = appendAuditEvent(currentVault, lockReason);
        const nextRecord = await persistVault(currentKey, auditedVault, currentRecord);
        setStoredRecord(nextRecord);
      } catch {
        createPendingAuditEvent(localStorage, lockReason);
      }
    }
  }

  function resetVaultForTesting() {
    const ok = window.confirm("This deletes the encrypted local vault stored in this browser. Continue?");
    if (!ok) return;
    clearStage1Record(localStorage);
    setStoredRecord(null);
    setVaultKey(null);
    setVault(null);
    setBackupHealth(loadBackupHealth(localStorage));
    setNotice("Local vault removed from this browser.");
  }

  // URL routing. Single SPA, no router lib — we just look at pathname
  // for the handful of public routes we need.
  const inviteToken = matchPathToken("/invite/");
  if (inviteToken) {
    return <InviteAcceptScreen token={inviteToken} onReturnHome={() => { window.location.assign("/"); }} />;
  }
  const claimToken = matchPathToken("/claim/");
  if (claimToken) {
    return <ClaimScreen token={claimToken} onReturnHome={() => { window.location.assign("/"); }} />;
  }
  if (typeof window !== "undefined" && window.location.pathname === "/claim") {
    return <NomineeEntryScreen onReturnHome={() => { window.location.assign("/"); }} />;
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return <AdminScreen onReturnHome={() => { window.location.assign("/"); }} />;
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/release/abort")) {
    return <AbortScreen onReturnHome={() => { window.location.assign("/"); }} />;
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/hold-release")) {
    return <HolderReleaseScreen onReturnHome={() => { window.location.assign("/"); }} />;
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/download")) {
    return <NomineeDownloadScreen onReturnHome={() => { window.location.assign("/"); }} />;
  }

  // Hold the screen while we hydrate the Supabase session — flicker-free
  // so we don't briefly show AuthScreen and then yank it away.
  if (!sessionLoaded) {
    return <main className="min-h-screen bg-[var(--surface-2)]" aria-hidden="true" />;
  }

  // Shared between WelcomeScreen (fresh device) and EntryScreen (local
  // vault already present) so vault-creation/unlock behavior — including
  // the legacy-KDF auto-upgrade — only lives in one place.
  function handleVaultCreated(record, key, nextVault) {
    setStoredRecord(record);
    setVaultKey(key);
    setVault(nextVault);
    setUnlockedAt(Date.now());
    setLockNotice("");
    setNotice("Vault created and encrypted locally.");
  }

  async function handleVaultUnlocked(key, nextVault, usedEnvelope, secret, sourceRecord) {
    const pendingEvents = drainPendingAuditEvents(localStorage);
    let recordForPersist = sourceRecord;

    // Auto-upgrade: legacy PBKDF2 envelope → Argon2id, using the
    // secret the user just typed. Best-effort; failures don't block
    // unlock. Only the envelope just successfully unwrapped is upgraded
    // (the other envelope's secret isn't in memory).
    try {
      if (envelopeIsLegacyKdf(sourceRecord, usedEnvelope) && secret) {
        const upgraded = await upgradeEnvelopeKdf({
          record: sourceRecord,
          vaultKey: key,
          kind: usedEnvelope,
          secret
        });
        recordForPersist = upgraded;
        saveStage1Record(localStorage, upgraded);
        setStoredRecord(upgraded);
        if (typeof console !== "undefined") {
          console.info(`[lyfos] upgraded ${usedEnvelope} envelope to Argon2id.`);
        }
      }
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[lyfos] KDF upgrade failed (non-fatal):", err?.message ?? err);
    }

    const auditedVault = appendAuditEvent(
      appendAuditEvents(nextVault, pendingEvents),
      usedEnvelope === "recovery" ? "Vault unlocked with recovery key" : "Vault unlocked with phrase"
    );
    const nextRecord = await persistVault(key, auditedVault, recordForPersist);
    setStoredRecord(nextRecord);
    setVaultKey(key);
    setVault(auditedVault);
    setUnlockedAt(Date.now());
    setLockNotice("");
    setNotice("");
  }

  function handleUnlockFailed(event) {
    createPendingAuditEvent(localStorage, event);
  }

  // Account gate. Render WelcomeScreen (account + vault, merged into
  // one page) when Supabase is configured, there's no session and no
  // local vault yet, and the user hasn't chosen to bypass accounts.
  // Render the auth-only AuthScreen when the user explicitly opened it
  // from Settings ("Sign in") while already having a local vault —
  // that vault doesn't need creating or unlocking again here.
  if (authPanelOpen) {
    return (
      <AuthScreen
        onSignedIn={(s) => {
          setSession(s);
          setAuthPanelOpen(false);
          appendServerAuditEvent("sign_in", { method: "password" }).catch(() => {});
        }}
        onContinueLocalOnly={() => setAuthPanelOpen(false)}
        onNomineeEntry={() => { window.location.assign("/claim"); }}
      />
    );
  }

  if (isSupabaseConfigured() && !session && !storedRecord && !authBypass) {
    return (
      <WelcomeScreen
        onSignedIn={(s) => {
          setSession(s);
          appendServerAuditEvent("sign_in", { method: "password" }).catch(() => {});
        }}
        onCreated={handleVaultCreated}
        onUnlocked={handleVaultUnlocked}
        onUnlockFailed={handleUnlockFailed}
        onContinueLocalOnly={() => setAuthBypass(true)}
        onNomineeEntry={() => { window.location.assign("/claim"); }}
      />
    );
  }

  if (!vault || !vaultKey) {
    return (
      <EntryScreen
        record={storedRecord}
        notice={notice}
        lockNotice={lockNotice}
        onCreated={handleVaultCreated}
        onUnlocked={handleVaultUnlocked}
        onUnlockFailed={handleUnlockFailed}
        onImported={(record) => {
          setStoredRecord(record);
          setNotice("Encrypted backup imported. Unlock it with its vault phrase or recovery key.");
        }}
        onRestoreConfirmed={(record, key, nextVault) => {
          setStoredRecord(record);
          setVaultKey(key);
          setVault(nextVault);
          setUnlockedAt(Date.now());
          updateBackupHealth(markBackupUnknownAfterRestore({ health: backupHealth }));
          setNotice("Encrypted backup restored after decrypt preview.");
        }}
        backupHealth={backupHealth}
        onBackupHealthChange={updateBackupHealth}
        onReset={resetVaultForTesting}
        onNomineeEntry={() => { window.location.assign("/claim"); }}
      />
    );
  }

  return (
    <VaultExperience
      vault={vault}
      vaultKey={vaultKey}
      notice={notice}
      autoLockMs={autoLockMs}
      subscription={subscription}
      entitlements={entitlements}
      onSubscriptionChange={setSubscription}
      onAutoLockChange={(timeoutMs) => {
        const next = saveAutoLockPolicy(localStorage, timeoutMs);
        setAutoLockMs(next);
      }}
      onSave={saveVault}
      onLock={lockVault}
      storedRecord={storedRecord}
      pendingReauth={pendingReauth}
      runWithRecentAuth={runWithRecentAuth}
      onReauthConfirmed={() => {
        setUnlockedAt(Date.now());
        const action = pendingReauth?.action;
        setPendingReauth(null);
        action?.();
      }}
      onReauthCancel={() => setPendingReauth(null)}
      backupHealth={backupHealth}
      backupSizeWarning={backupSizeWarning}
      session={session}
      onShowAuthScreen={() => setAuthPanelOpen(true)}
      onSignOut={async () => {
        // Signing out of the account is separate from the vault's own
        // lock state — without this, a decrypted vault stays live in
        // this tab's memory even after the account session ends.
        await lockVault("Signed out");
        await appendServerAuditEvent("sign_out", {}).catch(() => {});
        await signOut();
        setSession(null);
      }}
      onExport={() => runWithRecentAuth(async () => {
        const exportedAt = new Date().toISOString();
        const exportPackage = prepareStage2BackupExport({
          encryptedVaultContainer: storedRecord,
          vaultSnapshot: vault,
          exportedAt
        });
        downloadTextFile(exportPackage.filename, exportPackage.text);
        updateBackupHealth(markBackupExported({
          health: backupHealth,
          manifest: exportPackage.manifest
        }));
        const auditedVault = appendAuditEvent(vault, "Encrypted backup exported");
        const nextRecord = await persistVault(vaultKey, auditedVault, storedRecord);
        setStoredRecord(nextRecord);
        setVault(auditedVault);
        setNotice("Encrypted backup downloaded. It can only be restored with the vault phrase or recovery key.");
      })}
      onReplaceRecoveryKey={async ({ newRecoveryKey, confirmation }) => {
        const replacement = await confirmRecoveryKeyReplacement({
          encryptedRecord: storedRecord,
          vaultKey,
          newRecoveryKey,
          confirmation
        });
        if (!replacement.ok) return replacement;

        const auditedVault = appendAuditEvent(vault, replacement.auditEvent);
        const nextRecord = await updateEncryptedVault(replacement.record, vaultKey, auditedVault);
        saveStage1Record(localStorage, nextRecord);
        setStoredRecord(nextRecord);
        setVault(auditedVault);
        updateBackupHealth(deriveBackupHealth({
          storedHealth: backupHealth,
          currentVault: { updatedAt: nextRecord.updatedAt },
          changeReason: "recovery_key_replaced"
        }));
        setNotice("Recovery key replaced. Export and verify a fresh backup so this change is recoverable.");
        return { ...replacement, record: nextRecord };
      }}
      onDigitalLegacyMigrate={async () => {
        // One-time, idempotent: migrateLegacyVault only reads vault.items,
        // it never deletes or rewrites them. The pre-migration snapshot is
        // the "verified encrypted backup" gate from
        // docs/LEGACY_RECORD_MIGRATION.md — a safety net, not user-facing.
        if (vault.digitalLegacy) return vault;
        saveDigitalLegacyPreMigrationBackup(localStorage, storedRecord);
        const { vault: migratedVault } = migrateLegacyVault(vault);
        const auditedVault = appendAuditEvent(migratedVault, "Digital Legacy set up");
        await saveVault(auditedVault, "digital_legacy_migrated");
        return auditedVault;
      }}
      onReset={() => runWithRecentAuth(resetVaultForTesting)}
    />
  );
}

// Passphrase strength — for a zero-knowledge vault a weak phrase is the whole
// attack surface, so we give honest, immediate feedback (not a hard gate beyond
// the 12-char minimum).
function scorePassphrase(p) {
  const s = p || "";
  if (!s) return { score: 0, label: "", color: "var(--line-2)", hint: "" };
  let n = 0;
  if (s.length >= 12) n++;
  if (s.length >= 16) n++;
  if (s.length >= 24 || /\s/.test(s.trim())) n++;            // length or multi-word
  if (/[0-9]/.test(s) && /[a-zA-Z]/.test(s)) n++;
  if (/[^a-zA-Z0-9]/.test(s)) n++;
  const score = Math.min(4, n);
  const meta = [
    { label: "Too short", color: "#d70015", hint: "Use at least 12 characters." },
    { label: "Weak", color: "#d70015", hint: "Add length — a memorable phrase of a few words is strongest." },
    { label: "Okay", color: "#c88719", hint: "Better. A few unrelated words beats symbols." },
    { label: "Strong", color: "#1a9d5a", hint: "Strong — easy to remember, hard to guess." },
    { label: "Excellent", color: "#1a9d5a", hint: "Excellent passphrase." }
  ];
  return { score, ...meta[score] };
}

function PassStrength({ passphrase }) {
  const { score, label, color, hint } = scorePassphrase(passphrase);
  if (!passphrase) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1 flex-1 rounded-full transition-colors" style={{ background: i < score ? color : "var(--line-2)" }} />
        ))}
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color }}>{label} · <span className="text-[var(--ink-3)]">{hint}</span></p>
    </div>
  );
}

// WelcomeScreen — the fresh-device entry point when there's no session
// and no local vault yet. Combines what used to be two separate
// screens (AuthScreen, then EntryScreen) into one form: email +
// account password + vault passphrase, one submit, straight into the
// vault. The account password and vault passphrase remain two
// cryptographically separate secrets under the hood — the account
// password is checked by Supabase Auth as normal, while the vault
// passphrase is used only on this device to derive the vault key and
// is never sent anywhere. Merging the *screens* removes the friction;
// it does not merge the *secrets*.
function WelcomeScreen({ onCreated, onUnlocked, onUnlockFailed, onSignedIn, onContinueLocalOnly, onNomineeEntry }) {
  const [email, setEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const busy = Boolean(busyLabel);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    if (accountPassword.length < 12) { setError("Account password must be at least 12 characters. This is separate from your vault passphrase below."); return; }
    if (passphrase.length < 12) { setError("Use at least 12 characters for your vault passphrase."); return; }
    if (passphrase !== confirm) { setError("Vault passphrases do not match."); return; }
    if (!recoveryKey) { setError("Generate a recovery key before creating the vault."); return; }
    if (!recoveryConfirm) { setError("Save the recovery phrase, tick the checkbox, then answer the three word checks."); return; }
    if (normalizeRecoveryKey(recoveryConfirm) !== recoveryKey) { setError("The recovery phrase check does not match. Recheck the requested words."); return; }

    let session;
    setBusyLabel("Signing in…");
    try {
      const data = await signInWithPassword({ email: email.trim(), password: accountPassword });
      session = data?.session;
    } catch (err) {
      if (!isInvalidCredentials(err)) {
        setBusyLabel("");
        setError(humanizeAuthError(err));
        return;
      }
      setBusyLabel("Creating account…");
      try {
        const data = await signUpWithPassword({ email: email.trim(), password: accountPassword, returnPath: "/" });
        session = data?.session;
      } catch (signUpErr) {
        setBusyLabel("");
        setError(humanizeAuthError(signUpErr));
        return;
      }
      if (!session) {
        setBusyLabel("");
        setInfo(`Check your email — we sent a confirmation link to ${email}. Click it, then come back and enter your vault passphrase again to continue.`);
        return;
      }
    }

    onSignedIn(session);

    let serverRecord = null;
    setBusyLabel("Checking for an existing vault…");
    try {
      const result = await fetchEncryptedRecord();
      serverRecord = result?.record ?? null;
    } catch {
      // No existing cloud record reachable — proceed as a brand-new vault.
    }

    try {
      if (serverRecord) {
        setBusyLabel("Unlocking…");
        const unlocked = await decryptVaultWithPassphrase(serverRecord, passphrase);
        saveStage1Record(localStorage, serverRecord);
        await onUnlocked(unlocked.vaultKey, unlocked.vault, unlocked.usedEnvelope, passphrase, serverRecord);
      } else {
        setBusyLabel("Creating vault…");
        const nextVault = createEmptyVault();
        const nextRecord = await createStage1VaultRecord({ vault: nextVault, passphrase, recoveryKey });
        saveStage1Record(localStorage, nextRecord);
        const unlocked = await decryptVaultWithPassphrase(nextRecord, passphrase);
        onCreated(nextRecord, unlocked.vaultKey, nextVault);
      }
    } catch (err) {
      onUnlockFailed?.("Failed unlock attempt right after sign-in");
      setError(err?.message || "That vault passphrase didn't work.");
    } finally {
      setBusyLabel("");
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="flex h-14 items-center px-6">
        <div className="flex items-center gap-2.5 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8.2 11V8.3a3.8 3.8 0 0 1 7.6 0V11" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" /><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2.7" fill="#fff" /><circle cx="12" cy="14.7" r="1.55" fill="var(--accent)" /><path d="M12 15.7l-1.05 3.5h2.1z" fill="var(--accent)" /></svg>
          </span>
          Lyfos
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col items-center px-5 pb-16 pt-6">
        <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-[var(--green-soft)]">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M8.2 11V8.3a3.8 3.8 0 0 1 7.6 0V11" stroke="var(--accent)" strokeWidth="2.1" strokeLinecap="round" /><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2.7" fill="var(--accent)" /><circle cx="12" cy="14.7" r="1.55" fill="var(--green-soft)" /><path d="M12 15.7l-1.05 3.5h2.1z" fill="var(--green-soft)" /></svg>
        </div>

        <div className="mt-5 text-center">
          <h1 className="text-[26px] font-semibold tracking-tight text-[var(--ink)]">Start your vault</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">One page, one submit. Your account lets you sync across devices; your vault passphrase is what actually protects your data — Lyfos never sees it.</p>
        </div>

        <form onSubmit={submit} className="mt-7 w-full">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow,0_12px_40px_rgba(0,0,0,0.06))]">
            <span className="text-[13px] font-medium text-[var(--ink-2)]">Email</span>
            <input
              className="mt-2 h-[50px] w-full rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-4)] focus:border-[var(--accent)]"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />

            <span className="mt-4 block text-[13px] font-medium text-[var(--ink-2)]">Account password</span>
            <input
              className="mt-2 h-[50px] w-full rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-4)] focus:border-[var(--accent)]"
              type="password"
              required
              autoComplete="current-password"
              value={accountPassword}
              onChange={(event) => setAccountPassword(event.target.value)}
              placeholder="At least 12 characters"
            />
            <p className="mt-1.5 text-[11px] text-[var(--ink-3)]">Lets you sign in and sync across devices. Different from your vault passphrase below.</p>

            <div className="mb-2 mt-5 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-[var(--ink-2)]">Vault passphrase</span>
            </div>
            <div className="flex h-[50px] items-center gap-2.5 rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 transition focus-within:border-[var(--accent)]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" /></svg>
              <input
                className="flex-1 bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-4)]"
                type={showPass ? "text" : "password"}
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="new-password"
                placeholder="At least 12 characters"
              />
              <button type="button" onClick={() => setShowPass((s) => !s)} aria-label="Show passphrase" className="grid place-items-center p-1 text-[var(--ink-3)] transition hover:text-[var(--ink)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12 C 4 7 8 4.5 12 4.5 C 16 4.5 20 7 22 12 C 20 17 16 19.5 12 19.5 C 8 19.5 4 17 2 12 Z" /><circle cx="12" cy="12" r="3" /></svg>
              </button>
            </div>
            <input
              className="mt-2.5 h-[50px] w-full rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-4)] focus:border-[var(--accent)]"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              placeholder="Confirm vault passphrase"
            />
            <PassStrength passphrase={passphrase} />
            <div className="mt-4">
              <RecoveryKeyPanel
                recoveryKey={recoveryKey}
                recoveryConfirm={recoveryConfirm}
                onGenerate={() => { const key = generateRecoveryKey(); setRecoveryKey(key); setRecoveryConfirm(""); }}
                onConfirmChange={setRecoveryConfirm}
              />
            </div>

            {(error || info) && (
              <div aria-live="polite" className={cx("mt-4 rounded-xl px-4 py-3 text-[13px] font-medium", error ? "bg-[var(--red-soft)] text-[var(--red-2)]" : "bg-[var(--green-soft)] text-[var(--green-ink)]")}>
                {error || info}
              </div>
            )}

            <button className="mt-4 h-[50px] w-full rounded-xl bg-[var(--accent)] text-[15px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-50" disabled={busy}>
              {busy ? busyLabel : "Create account and open vault"}
            </button>
          </div>

          {onContinueLocalOnly && (
            <div className="mt-5 text-center">
              <button type="button" onClick={onContinueLocalOnly} className="text-[12.5px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">
                Or continue without an account · this device only
              </button>
            </div>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-[var(--ink-3)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z" /></svg>
            Your vault passphrase never leaves this device.
          </div>

          {onNomineeEntry && (
            <div className="mt-5 text-center">
              <button type="button" onClick={onNomineeEntry} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[12.5px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">
                I am a nominee
              </button>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {["Zero-knowledge", "End-to-end encrypted", "You hold the keys"].map((t) => (
              <span key={t} className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--ink-2)]">{t}</span>
            ))}
          </div>
        </form>

        <footer className="mt-auto pt-12 text-center text-[11px] text-[var(--ink-4)]">
          <p>
            By continuing you agree to the{" "}
            <a href="/legal/terms.html" className="underline">Terms</a>,{" "}
            <a href="/legal/privacy.html" className="underline">Privacy</a> and{" "}
            <a href="/legal/product-disclaimer.html" className="underline">Product disclaimer</a>.
          </p>
          <p className="mt-3">Lyfos · Locally encrypted on this device.</p>
        </footer>
      </div>
    </main>
  );
}

function EntryScreen({ record, notice, lockNotice, onCreated, onUnlocked, onUnlockFailed, onImported, onRestoreConfirmed, backupHealth, onBackupHealthChange, onReset, onNomineeEntry }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unlockMode, setUnlockMode] = useState("passphrase");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);
  const hasVault = Boolean(record);
  const hasRecoveryEnvelope = Boolean(record?.keyEnvelopes?.recovery);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (hasVault) {
        const unlocked = unlockMode === "recovery"
          ? await decryptVaultWithRecoveryKey(record, passphrase)
          : await decryptVaultWithPassphrase(record, passphrase);
        await onUnlocked(unlocked.vaultKey, unlocked.vault, unlocked.usedEnvelope, passphrase, record);
        return;
      }

      if (passphrase.length < 12) throw new Error("Use at least 12 characters. A memorable phrase is better than a short password.");
      if (passphrase !== confirm) throw new Error("Passphrases do not match.");
      if (!recoveryKey) throw new Error("Generate a recovery key before creating the vault.");
      if (!recoveryConfirm) throw new Error("Save the recovery phrase, tick the checkbox, then answer the three word checks.");
      if (normalizeRecoveryKey(recoveryConfirm) !== recoveryKey) throw new Error("The recovery phrase check does not match. Recheck the requested words.");
      const nextVault = createEmptyVault();
      const nextRecord = await createStage1VaultRecord({ vault: nextVault, passphrase, recoveryKey });
      saveStage1Record(localStorage, nextRecord);
      const unlocked = await decryptVaultWithPassphrase(nextRecord, passphrase);
      onCreated(nextRecord, unlocked.vaultKey, nextVault);
    } catch (err) {
      if (hasVault) onUnlockFailed?.(unlockMode === "recovery" ? "Failed unlock attempt with recovery key" : "Failed unlock attempt with phrase");
      setError(hasVault ? err.message : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createSampleVault() {
    setError("");
    setBusy(true);
    try {
      if (hasVault) return;
      if (passphrase.length < 12) throw new Error("Use at least 12 characters before creating a sample vault.");
      if (passphrase !== confirm) throw new Error("Passphrases do not match.");
      if (!recoveryKey) throw new Error("Generate and confirm a recovery key before creating a sample vault.");
      if (!recoveryConfirm) throw new Error("Save the recovery phrase, tick the checkbox, then answer the three word checks.");
      if (normalizeRecoveryKey(recoveryConfirm) !== recoveryKey) throw new Error("The recovery phrase check does not match. Recheck the requested words.");
      const nextVault = await loadDemoVaultModule();
      const nextRecord = await createStage1VaultRecord({ vault: nextVault, passphrase, recoveryKey });
      saveStage1Record(localStorage, nextRecord);
      const unlocked = await decryptVaultWithPassphrase(nextRecord, passphrase);
      onCreated(nextRecord, unlocked.vaultKey, nextVault);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const entryTrustCopy = hasVault
    ? "Your vault phrase opens the encrypted vault on this device. Your account alone cannot decrypt records."
    : "Create a private vault for the details your family should never have to search for. Your passphrase stays with you; Lyfos never sees it.";

  const recoveryMode = hasVault && unlockMode === "recovery";

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="flex h-14 items-center px-6">
        <div className="flex items-center gap-2.5 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8.2 11V8.3a3.8 3.8 0 0 1 7.6 0V11" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" /><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2.7" fill="#fff" /><circle cx="12" cy="14.7" r="1.55" fill="var(--accent)" /><path d="M12 15.7l-1.05 3.5h2.1z" fill="var(--accent)" /></svg>
          </span>
          Lyfos
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col items-center px-5 pb-16 pt-6">
        <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-[var(--green-soft)]">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M8.2 11V8.3a3.8 3.8 0 0 1 7.6 0V11" stroke="var(--accent)" strokeWidth="2.1" strokeLinecap="round" /><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2.7" fill="var(--accent)" /><circle cx="12" cy="14.7" r="1.55" fill="var(--green-soft)" /><path d="M12 15.7l-1.05 3.5h2.1z" fill="var(--green-soft)" /></svg>
        </div>

        <div className="mt-5 text-center">
          <h1 className="text-[26px] font-semibold tracking-tight text-[var(--ink)]">{hasVault ? "Welcome back" : "Start your vault"}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">
            {hasVault ? "Enter your passphrase to open your vault." : "One phrase. One recovery key. Everything important, protected locally."}
          </p>
        </div>

        <form id="vault-entry" onSubmit={submit} className="mt-7 w-full">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow,0_12px_40px_rgba(0,0,0,0.06))]">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-[var(--ink-2)]">{recoveryMode ? "24-word recovery phrase" : "Passphrase"}</span>
              {hasVault && hasRecoveryEnvelope && (
                <button type="button" onClick={() => setUnlockMode(recoveryMode ? "passphrase" : "recovery")} className="text-[12.5px] font-semibold text-[var(--accent)]">
                  {recoveryMode ? "Use passphrase" : "Use recovery phrase"}
                </button>
              )}
            </div>

            <div className="flex h-[50px] items-center gap-2.5 rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 transition focus-within:border-[var(--accent)]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" /></svg>
              <input
                className="flex-1 bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-4)]"
                type={recoveryMode || showPass ? "text" : "password"}
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete={hasVault ? "current-password" : "new-password"}
                autoFocus={hasVault}
                placeholder={hasVault ? "Your passphrase" : "At least 12 characters"}
              />
              {!recoveryMode && (
                <button type="button" onClick={() => setShowPass((s) => !s)} aria-label="Show passphrase" className="grid place-items-center p-1 text-[var(--ink-3)] transition hover:text-[var(--ink)]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12 C 4 7 8 4.5 12 4.5 C 16 4.5 20 7 22 12 C 20 17 16 19.5 12 19.5 C 8 19.5 4 17 2 12 Z" /><circle cx="12" cy="12" r="3" /></svg>
                </button>
              )}
            </div>

            {!hasVault && (
              <>
                <input
                  className="mt-2.5 h-[50px] w-full rounded-xl border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-4)] focus:border-[var(--accent)]"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Confirm passphrase"
                />
                <PassStrength passphrase={passphrase} />
                <div className="mt-4">
                  <RecoveryKeyPanel
                    recoveryKey={recoveryKey}
                    recoveryConfirm={recoveryConfirm}
                    onGenerate={() => { const key = generateRecoveryKey(); setRecoveryKey(key); setRecoveryConfirm(""); }}
                    onConfirmChange={setRecoveryConfirm}
                  />
                </div>
              </>
            )}

            {(lockNotice || notice || error) && (
              <div aria-live="polite" className={cx("mt-4 rounded-xl px-4 py-3 text-[13px] font-medium", error ? "bg-[var(--red-soft)] text-[var(--red-2)]" : lockNotice ? "bg-[var(--amber-soft)] text-[var(--amber-ink)]" : "bg-[var(--green-soft)] text-[var(--green-ink)]")}>
                {error || lockNotice || notice}
              </div>
            )}

            <button className="mt-4 h-[50px] w-full rounded-xl bg-[var(--accent)] text-[15px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-50" disabled={busy}>
              {busy ? (hasVault ? "Unlocking…" : "Creating…") : hasVault ? "Unlock vault" : "Create vault"}
            </button>

            {!hasVault && demoEnabled() && (
              <button type="button" onClick={createSampleVault} disabled={busy} className="mt-2.5 h-[50px] w-full rounded-xl border border-[var(--line-2)] bg-[var(--surface)] text-[15px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-wait disabled:opacity-50">
                Try with sample records
              </button>
            )}
          </div>

          {hasVault && (
            <p className="mt-5 text-center text-[13px] text-[var(--ink-3)]">
              Not your vault?{" "}
              <button type="button" onClick={onReset} className="font-semibold text-[var(--accent)]">Start a new one</button>
            </p>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-[var(--ink-3)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z" /></svg>
            Your passphrase never leaves this device.
          </div>

          {onNomineeEntry && (
            <div className="mt-5 text-center">
              <button type="button" onClick={onNomineeEntry} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[12.5px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">
                I am a nominee
              </button>
            </div>
          )}

          {!hasVault && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {["Zero-knowledge", "End-to-end encrypted", "You hold the keys"].map((t) => (
                <span key={t} className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--ink-2)]">{t}</span>
              ))}
            </div>
          )}

          <details className="group mt-8">
            <summary className="cursor-pointer list-none text-center text-[12.5px] font-medium text-[var(--ink-3)] transition hover:text-[var(--ink)]">Restore or verify a backup</summary>
            <div className="mt-4">
              <ImportBackup currentRecord={record} onImported={onImported} onRestoreConfirmed={onRestoreConfirmed} />
              <div className="mt-4">
                <BackupVerificationPanel currentRecord={record} backupHealth={backupHealth} onBackupHealthChange={onBackupHealthChange} />
              </div>
            </div>
          </details>
        </form>

        <footer className="mt-auto pt-12 text-center text-[11px] text-[var(--ink-4)]">
          <p>
            By continuing you agree to the{" "}
            <a href="/legal/terms.html" className="underline">Terms</a>,{" "}
            <a href="/legal/privacy.html" className="underline">Privacy</a> and{" "}
            <a href="/legal/product-disclaimer.html" className="underline">Product disclaimer</a>.
          </p>
          <p className="mt-3">Lyfos · Locally encrypted on this device.</p>
        </footer>
      </div>
    </main>
  );
}

function recordHasContent(it) {
  return Boolean(it.username || it.secret || it.bankDetails || it.cardDetails || it.email || (it.notes && it.notes.length > 12) || (it.attachments && it.attachments.length));
}

const AREA_ICON = {
  identity: "M12 12 a4 4 0 1 0 0-8 a4 4 0 0 0 0 8 Z M4 20 c0-4 4-6 8-6 s8 2 8 6",
  money: "M3 6 h18 v13 H3 Z M3 10 H21",
  access: "M5 11 h14 v9 H5 Z M8 11 V8 a4 4 0 0 1 8 0 v3",
  insurance: "M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z",
  property: "M4 11 L12 4 L20 11 V20 H4 Z",
  instructions: "M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19"
};
const AREA_TONE = {
  identity: "var(--amber)", money: "var(--green)", access: "var(--blue)",
  insurance: "var(--rose,#c0335e)", property: "var(--ink-3)", instructions: "var(--rose,#c0335e)"
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function FamilyHomeDashboard({ vault, onNavigate, onOpenRecord, onOpenArea }) {
  const health = useMemo(() => deriveHomeHealth(vault), [vault]);
  const primaryAction = useMemo(() => getPrimaryHomeAction(vault, health), [vault, health]);
  const items = vault.items ?? [];
  const financial = getFinancialSnapshot(items);
  const recent = useMemo(() => [...items].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 5), [items]);
  const lastUpdated = recent[0]?.updatedAt ? timeAgo(recent[0].updatedAt) : "Not yet";
  const action = () => {
    if (primaryAction.id === "area") return onOpenArea(primaryAction.areaId);
    if (primaryAction.id === "nominee-email" || primaryAction.id === "release") return onNavigate("release");
    if (primaryAction.id === "capture") return onNavigate("capture");
    return onNavigate("home");
  };
  const headline = items.length === 0
    ? "Start with what your family should never lose."
    : health.completion >= 80
      ? "Your family vault is in good shape."
      : "Your family vault is taking shape.";
  const openHealth = () => document.getElementById("vault-health-details")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--ink-3)]">Family vault</p>
          <h1 className="mt-3 max-w-2xl text-[36px] font-semibold leading-[1.08] tracking-tight text-[var(--ink)] md:text-[46px]">{headline}</h1>
        </div>
        <p className="text-right text-[13px] leading-5 text-[var(--ink-3)]">{greeting()}<br />{new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date())}</p>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,.7fr)]">
        <div className="flex min-h-[300px] items-center gap-8 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7 md:gap-12 md:p-10">
          <div className="grid h-40 w-40 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--accent) ${health.completion}%, var(--surface-3) ${health.completion}% 100%)` }}>
            <div className="grid h-32 w-32 place-items-center rounded-full bg-[var(--surface)] text-[38px] font-semibold tracking-tight text-[var(--ink)]">{health.completion}%</div>
          </div>
          <div className="max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">Family cover</p>
            <h2 className="mt-3 text-[22px] font-semibold leading-tight text-[var(--ink)]">{health.protectedCount} of {health.totalAreas} areas protected</h2>
            <p className="mt-3 text-[14px] leading-6 text-[var(--ink-2)]">{health.reviewCount ? `${health.reviewCount} area${health.reviewCount === 1 ? " needs" : "s need"} a review.` : health.exposedCount ? `${health.exposedCount} area${health.exposedCount === 1 ? " is" : "s are"} still waiting for a first record.` : "Most of what matters is protected."}</p>
            <button onClick={openHealth} className="mt-5 text-[13px] font-semibold text-[var(--green-ink)] hover:underline">View vault health <span aria-hidden="true">›</span></button>
          </div>
        </div>

        <button onClick={action} className="group flex min-h-[300px] flex-col justify-between rounded-3xl border border-[var(--line)] bg-[var(--surface-2)] p-7 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface)] md:p-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">{primaryAction.id === "healthy" ? "Today" : "One thing to finish"}</p>
            <h2 className="mt-4 max-w-xs text-[22px] font-semibold leading-tight text-[var(--ink)]">{primaryAction.label}</h2>
            <p className="mt-3 max-w-xs text-[13px] leading-5 text-[var(--ink-2)]">{primaryAction.id === "nominee-email" ? "Your nominee needs an email so Lyfos can send the key when it matters." : primaryAction.id === "release" ? "Five trusted people hold keys. Three are needed to release the vault." : primaryAction.id === "capture" ? "Add one important record and your vault health will begin to reflect what matters." : "Keep the areas your family depends on current."}</p>
          </div>
          <span className="text-[13px] font-semibold text-[var(--green-ink)]">{primaryAction.id === "healthy" ? "Open vault" : "Continue"} <span className="text-xl align-[-2px] transition group-hover:translate-x-1">›</span></span>
        </button>
      </section>

      <section id="vault-health-details" className="scroll-mt-24 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">Vault health</p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-[var(--ink)]">What is protected right now</h2>
          </div>
          <span className="text-[13px] font-semibold text-[var(--green-ink)]">{health.protectedCount} of {health.totalAreas} protected</span>
        </div>
        <div className="mt-6 grid gap-2 md:grid-cols-2">
          {health.areas.map((area) => {
            const state = area.state === "protected" ? "Protected" : area.state === "review" ? "Review" : "Needs setup";
            const tone = area.state === "protected" ? "text-[var(--green-ink)]" : area.state === "review" ? "text-[var(--amber-ink)]" : "text-[var(--ink-3)]";
            return (
              <button key={area.id} onClick={() => onOpenArea(area.id)} className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface)]">
                <span>
                  <span className="block text-[13px] font-medium text-[var(--ink)]">{area.label}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-3)]">{area.count ? `${area.count} record${area.count === 1 ? "" : "s"}` : "No records yet"}</span>
                </span>
                <span className={cx("text-[11px] font-semibold", tone)}>{state} <span aria-hidden="true">›</span></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[["Trust circle", `${health.holderCount} of 5 ready`, "release"], ["Balance sheet", formatMoney(financial.assets - financial.liabilities), "money"], ["Last updated", lastUpdated, "records"]].map(([label, value, screen]) => (
          <button key={label} onClick={() => onNavigate(screen)} className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface-2)]"><span className="text-[13px] text-[var(--ink-2)]">{label}</span><span className="text-[14px] font-semibold text-[var(--ink)]">{value}</span></button>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-[16px] font-semibold text-[var(--ink)]">Recently added</h2><button onClick={() => onNavigate("records")} className="text-[12px] font-medium text-[var(--green-ink)] hover:underline">View all {items.length} <span aria-hidden="true">›</span></button></div>
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          {recent.length ? recent.map((item, index) => <button key={item.id || index} onClick={() => onOpenRecord(item)} className={cx("flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-[var(--surface-2)]", index > 0 && "border-t border-[var(--line)]")}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--green-soft)] text-[var(--green-ink)]">{(item.title || typeLabel(item.type)).slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{item.title || typeLabel(item.type)}</span><span className="block text-[12px] text-[var(--ink-3)]">{getAreaForType(item.type).label}</span></span><span className="text-[12px] text-[var(--ink-4)]">{timeAgo(item.updatedAt)}</span></button>) : <div className="px-5 py-8 text-center text-[13px] text-[var(--ink-3)]">Records you add will appear here.</div>}
        </div>
      </section>
    </div>
  );
}

function HomeDashboard({ vault, onNavigate, onOpenRecord, onOpenArea, backupHealth, onPreviewRecovery }) {
  const items = vault.items ?? [];
  const total = items.length;
  const now = Date.now();
  const fresh = items.filter((it) => it.updatedAt && (now - new Date(it.updatedAt).getTime()) / 86400000 <= 45).length;
  const unfinished = items.filter((it) => it.title && !recordHasContent(it)).length;
  const older = Math.max(0, total - fresh - unfinished);
  const attention = useMemo(() => deriveAttention(vault), [vault]);
  const recent = useMemo(() => [...items].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 5), [items]);
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--ink)]">{total === 0 ? "Your vault is ready" : greeting()}</h1>
        <p className="mt-1 text-[14px] text-[var(--ink-2)]">{total === 0 ? "Start with one thing your family should never lose." : attention.length ? "A few important gaps remain. The rest is protected." : "Everything important is easy to find."}</p>
      </div>

      {/* First-run quick start — the most important next action on an empty vault */}
      {total === 0 && (
        <div className="mb-7 overflow-hidden rounded-[1.75rem] border border-[var(--accent)]/25 bg-[linear-gradient(135deg,var(--green-soft),var(--surface)_68%)] p-6 shadow-[0_18px_70px_rgba(22,163,74,0.10)]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--green-ink)]">First record</p>
              <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-[var(--ink)]">Secure what matters.</h2>
              <p className="mt-2 text-[13.5px] leading-6 text-[var(--ink-2)]">One bank account. One policy. One password. Add anything important in under a minute.</p>
            </div>
            <button onClick={() => onNavigate("capture")} className="h-12 rounded-full bg-[var(--accent)] px-6 text-[14px] font-semibold text-white shadow-[0_10px_30px_rgba(22,163,74,0.22)] transition hover:translate-y-[-1px] hover:opacity-95">Add first record</button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {["Password", "Bank account", "ID / passport", "Insurance"].map((label) => (
              <button key={label} onClick={() => onNavigate("capture")} className="rounded-full border border-[var(--line-2)] bg-white/70 px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]">{label}</button>
            ))}
          </div>
        </div>
      )}

      {total > 0 && (
        <VaultOverview
          vault={vault}
          onOpenArea={onOpenArea}
          onOpenRecord={onOpenRecord}
        />
      )}

      {/* The promise, previewable — the dry run is the product's aha moment */}
      <button data-tour="dryrun" onClick={onPreviewRecovery} className={cx("mb-5 flex w-full items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-6 py-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:bg-[var(--surface-2)]", total > 0 && "mt-6")}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--green-soft)]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[var(--ink)]">See exactly what your family would receive</span>
          <span className="mt-0.5 block text-[12.5px] text-[var(--ink-3)]">A practice run of the recovery — nothing is sent, nothing changes.</span>
        </span>
        <span className="shrink-0 text-[13px] font-medium text-[var(--accent)]">Preview →</span>
      </button>

      {/* Records overview */}
      <div className="mb-7 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-3 gap-3">
          {[["Records kept safe", total, "var(--ink-4)"], ["Updated recently", fresh, "var(--green)"], ["Started, unfinished", unfinished, "var(--rose,#c0335e)"]].map(([label, n, c]) => (
            <div key={label} className="border-l-[2px] pl-3" style={{ borderColor: c }}>
              <div className="text-[22px] font-bold leading-none text-[var(--ink)]">{n}</div>
              <div className="mt-1 text-[11.5px] text-[var(--ink-3)]">{label}</div>
            </div>
          ))}
        </div>
        {total > 0 && (
          <>
            <div className="mt-5 flex h-3 gap-0.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <span className="bg-[var(--green)]" style={{ width: `${pct(fresh)}%` }} />
              <span className="bg-[var(--ink-4)]" style={{ width: `${pct(older)}%` }} />
              <span className="bg-[var(--rose,#c0335e)]" style={{ width: `${pct(unfinished)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-[12.5px] text-[var(--ink-3)]">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[var(--green)]" />Updated recently · {fresh}</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[var(--ink-4)]" />Older but complete · {older}</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[var(--rose,#c0335e)]" />Unfinished · {unfinished}</span>
            </div>
          </>
        )}
      </div>

      <NeedsALook items={attention} onNavigate={onNavigate} />

      <div className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-[var(--ink)]">Recently added</h2>
          <button onClick={() => onNavigate("records")} className="text-[13px] font-medium text-[var(--accent)]">View all {total} →</button>
        </div>
        {recent.length ? (
          <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {recent.map((it, i) => {
              const area = getAreaForType(it.type);
              return (
                <button key={i} onClick={() => onOpenRecord(it)} className={cx("flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]", i > 0 && "border-t border-[var(--line)]")}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]" style={{ background: "color-mix(in srgb, " + (AREA_TONE[area.id] || "var(--ink-4)") + " 14%, transparent)" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={AREA_TONE[area.id] || "var(--ink-3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area.id]} /></svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-[var(--ink)]">{it.title || typeLabel(it.type)}</span>
                    <span className="block truncate text-[12.5px] text-[var(--ink-3)]">{area.label}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--ink-4)]">{timeAgo(it.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-8 text-center text-[13.5px] text-[var(--ink-3)]">Records you add will appear here.</div>
        )}
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-base font-semibold text-[var(--ink)]">Recent activity</h2>
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          {(vault.audit ?? []).slice(0, 6).map((a, i) => (
            <div key={a.id ?? i} className={cx("flex items-center gap-3.5 px-4 py-3", i > 0 && "border-t border-[var(--line)]")}>
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--green)]" />
              <span className="flex-1 text-[13.5px] text-[var(--ink-2)]">{a.event}</span>
              <span className="text-[12px] text-[var(--ink-4)]">{timeAgo(a.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AllRecords({ vault, onOpenRecord }) {
  const [filter, setFilter] = useState("all");
  const items = vault.items ?? [];
  const chips = [["all", "All", items.length], ...AREAS.map((a) => [a.id, a.label, items.filter((it) => a.types.includes(it.type)).length])];
  const rows = filter === "all" ? items : items.filter((it) => getAreaForType(it.type).id === filter);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--ink)]">All records</h1>
        <p className="mt-1 text-[14px] text-[var(--ink-2)]">Everything you've kept safe — {items.length} record{items.length === 1 ? "" : "s"} across {AREAS.length} areas.</p>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {chips.map(([id, label, count]) => (
          <button key={id} onClick={() => setFilter(id)} className={cx("rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition", filter === id ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--line-2)]")}>
            {label} <span className="opacity-60">{count}</span>
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          {rows.map((it, i) => {
            const area = getAreaForType(it.type);
            return (
              <button key={i} onClick={() => onOpenRecord(it)} className={cx("flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]", i > 0 && "border-t border-[var(--line)]")}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]" style={{ background: "color-mix(in srgb, " + (AREA_TONE[area.id] || "var(--ink-4)") + " 14%, transparent)" }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={AREA_TONE[area.id] || "var(--ink-3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area.id]} /></svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-[var(--ink)]">{it.title || typeLabel(it.type)}</span>
                  <span className="block truncate text-[12.5px] text-[var(--ink-3)]">{area.label} · {releaseLabel(it)}</span>
                </span>
                <span className="shrink-0 text-[12px] text-[var(--ink-4)]">{timeAgo(it.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-10 text-center text-[13.5px] text-[var(--ink-3)]">Nothing in this area yet.</div>
      )}
    </div>
  );
}

function RailItem({ active, onClick, icon, label, count, dot, dataTour, pulse, locked = false, collapsed = false }) {
  return (
    <button data-tour={dataTour} onClick={onClick} aria-label={label} title={collapsed ? label : undefined} className={cx("flex w-full items-center gap-3 rounded-[10px] py-2 text-[14px] transition", collapsed ? "justify-center px-2" : "px-2.5", active ? "bg-[var(--green-soft)] font-medium text-[var(--ink)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]", locked && !active && "opacity-60", pulse && "tour-pulse")}>
      {dot ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} /> : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "var(--ink-3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d={icon} /></svg>
      )}
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {!collapsed && locked && <span className="text-[11px] text-[var(--ink-4)]">Lock</span>}
      {!collapsed && count != null && <span className={cx("text-[12px] tabular-nums", count === 0 ? "text-[var(--rose,#c0335e)]" : "text-[var(--ink-4)]")}>{count}</span>}
    </button>
  );
}

function PaidFeatureLock({ feature, body, onOpenSettings, hasSession }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCoupon, setShowCoupon] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");

  async function handleUpgrade() {
    if (!hasSession) { onOpenSettings?.(); return; }
    setError("");
    setBusy(true);
    try {
      const { checkoutUrl } = await startUpgrade({ plan: "vault", couponCode: coupon?.code });
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(err?.message || "Couldn't start checkout.");
      setBusy(false);
    }
  }

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponError("");
    setCouponBusy(true);
    try {
      const result = await validateCoupon({ plan: "vault", code });
      if (!result.valid) { setCouponError(result.error || "Invalid coupon code"); setCoupon(null); }
      else setCoupon(result);
    } catch (err) {
      setCouponError(err?.message || "Couldn't check that code.");
      setCoupon(null);
    } finally {
      setCouponBusy(false);
    }
  }

  function clearCoupon() {
    setCoupon(null);
    setCouponInput("");
    setCouponError("");
  }

  return (
    <section className="mx-auto max-w-xl py-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--green-soft)]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <rect x="5" y="11" width="14" height="10" rx="2.5" />
        </svg>
      </div>
      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Paid feature</p>
      <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">{feature}</h1>
      <p className="mx-auto mt-4 max-w-md text-[14px] leading-6 text-[var(--ink-2)]">{body}</p>
      {error && <div className="mx-auto mt-4 max-w-md rounded-md bg-[#ff453a]/8 px-3 py-2 text-[12px] font-medium text-[var(--red-2)]">{error}</div>}

      {hasSession && (
        coupon ? (
          <div className="mx-auto mt-5 flex max-w-xs items-center justify-between gap-2 rounded-lg bg-[var(--green-soft)] px-3 py-2 text-[11.5px] font-medium text-[var(--green-ink)]">
            <span>Coupon {coupon.code} applied</span>
            <button onClick={clearCoupon} className="text-[var(--ink-3)] underline decoration-dotted">Remove</button>
          </div>
        ) : showCoupon ? (
          <div className="mx-auto mt-5 max-w-xs">
            <div className="flex gap-2">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                placeholder="Coupon code"
                className="min-w-0 flex-1 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[12px] uppercase text-[var(--ink)] outline-none focus:border-[var(--green)]"
              />
              <button
                onClick={applyCoupon}
                disabled={couponBusy || !couponInput.trim()}
                className="rounded-full border border-[var(--line-2)] px-4 py-2 text-[12px] font-semibold text-[var(--ink)] disabled:opacity-40"
              >
                {couponBusy ? "Checking…" : "Apply"}
              </button>
            </div>
            {couponError && <p className="mt-1.5 text-[11px] font-medium text-[var(--red-2)]">{couponError}</p>}
          </div>
        ) : (
          <button onClick={() => setShowCoupon(true)} className="mt-5 text-[12px] font-medium text-[var(--ink-3)] underline decoration-dotted">
            Have a coupon?
          </button>
        )
      )}

      <button
        onClick={handleUpgrade}
        disabled={busy}
        className="mt-5 rounded-full bg-[#1d1d1f] px-6 py-3 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? "Opening Razorpay…" : !hasSession ? "Sign in to upgrade" : coupon ? `Upgrade to Vault · ${formatCurrency(coupon.amountPaise / 100, "INR")}` : "Upgrade to Vault"}
      </button>
      <p className="mt-3 text-[11px] text-[var(--ink-4)]">New accounts get a 30-day free trial of Vault. After that, it's a one-time ₹999 (India) or $9 (international) payment — yours for life, no subscription.</p>
    </section>
  );
}

function AtAGlance({ vault, backupHealth, onOpenArea, onNavigate }) {
  const model = getLifeModel(vault);
  const holders = (vault.releaseSettings?.keyHolders ?? []).filter((h) => h.trim()).length;
  const ready = model.releaseReady;
  const backedUp = backupHealth?.lastExportAt || backupHealth?.lastVerifiedAt;
  const emptyArea = model.areas.find((a) => a.state === "exposed");

  return (
    <div className="sticky top-[5.5rem]">
      <div className="mb-3.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">At a glance</div>

      <div className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <div className="mb-3.5 flex items-center gap-2">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={ready ? "var(--accent)" : "var(--ink-3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z" /><path d="M9 12 l2 2 l4 -4" /></svg>
          <h3 className="text-[14px] font-semibold text-[var(--ink)]">You're covered</h3>
          <span className={cx("ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold", ready ? "text-[var(--green-ink)]" : "text-[var(--amber-ink)]")}>
            <span className={cx("h-1.5 w-1.5 rounded-full", ready ? "bg-[var(--accent)]" : "bg-[var(--amber)]")} />{ready ? "Ready" : "Setup"}
          </span>
        </div>
        <div className="mb-2.5 flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => <span key={i} className={cx("h-2 flex-1 rounded", i < holders ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]")} />)}
        </div>
        <p className="text-[12px] text-[var(--ink-3)]">{ready ? `All ${holders} trusted people are set. Your family can recover everything.` : `${holders} of 5 trusted people chosen. Finish your release plan.`}</p>
      </div>

      <div className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z" /></svg>
          <h3 className="text-[14px] font-semibold text-[var(--ink)]">Vault health</h3>
        </div>
        {[["Records", String(vault.items.length)], ["Last backed up", backedUp ? timeAgo(backedUp) : "Not yet"], ["Areas protected", `${model.protectedCount} of ${model.areas.length}`], ["Recovery phrase", "Verified"]].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-1.5 text-[13px]">
            <span className="text-[var(--ink-2)]">{k}</span>
            <span className={cx("font-medium", k === "Recovery phrase" ? "text-[var(--green-ink)]" : "text-[var(--ink)]")}>{v}</span>
          </div>
        ))}
      </div>

      {emptyArea && (
        <button onClick={() => onOpenArea(emptyArea.id)} className="w-full rounded-2xl border border-dashed border-[var(--line-2)] p-3.5 text-left text-[12.5px] leading-relaxed text-[var(--ink-3)] transition hover:border-[var(--ink-4)]">
          <strong className="text-[var(--ink-2)]">{emptyArea.label} is still empty.</strong> {emptyArea.id === "instructions" ? "Add a first-72-hours note so the right person knows what to do." : `Add your ${emptyArea.label.toLowerCase()} so your family isn't left guessing.`}
        </button>
      )}
    </div>
  );
}

function GlobalSearch({ vault, onOpenArea, onOpenRecord, onNavigate, onOpenLegacyCategory, onOpenLegacyRecord }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const query = q.trim().toLowerCase();
  const legacyOn = DIGITAL_LEGACY_FEATURE_FLAGS.dashboard;

  const results = useMemo(() => {
    if (query.length < 3) return [];
    const out = [];
    const pages = legacyOn
      ? [["legacy", "My Legacy"], ["money", "Balance sheet"], ["release", "Circle of trust"], ["settings", "Settings"]]
      : [["home", "Home"], ["records", "All records"], ["money", "Balance sheet"], ["release", "Circle of trust"], ["settings", "Settings"]];
    pages.forEach(([id, label]) => { if (label.toLowerCase().includes(query)) out.push({ kind: "page", id, label, sub: "Page" }); });
    if (legacyOn) {
      // Metadata-only search — never touches field values (search.js).
      searchLegacyRecords(vault.digitalLegacy?.records ?? [], query).forEach((rec) => {
        const category = getCategory(rec.categoryId);
        out.push({ kind: "legacy-record", legacyRecord: rec, label: rec.accountLabel || category?.name || "Untitled", sub: category?.name ?? "My Legacy" });
      });
    } else {
      AREAS.forEach((a) => { if (a.label.toLowerCase().includes(query) || a.promise.toLowerCase().includes(query)) out.push({ kind: "area", area: a, label: a.label, sub: "Life area" }); });
      (vault.items ?? []).forEach((it) => {
        const hay = `${it.title} ${it.username} ${it.email} ${it.bankDetails} ${it.cardDetails} ${it.notes} ${typeLabel(it.type)}`.toLowerCase();
        if (hay.includes(query)) out.push({ kind: "record", item: it, label: it.title || typeLabel(it.type), sub: getAreaForType(it.type).label });
      });
    }
    return out.slice(0, 8);
  }, [query, vault, legacyOn]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); setOpen(true); } }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  function choose(r) {
    if (!r) return;
    if (r.kind === "record") onOpenRecord(r.item);
    else if (r.kind === "legacy-record") onOpenLegacyRecord(r.legacyRecord.id);
    else if (r.kind === "area") onOpenArea(r.area.id);
    else onNavigate(r.id);
    setQ(""); setOpen(false); inputRef.current?.blur();
  }

  const showDropdown = open && query.length >= 3;

  return (
    <div ref={boxRef} className="relative mx-auto hidden w-full max-w-md md:block">
      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--ink-3)] focus-within:border-[var(--accent)]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21 L16 16" /></svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          placeholder="Search records, money, people…"
          className="flex-1 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
        />
        <span className="rounded-[5px] border border-[var(--line)] bg-[var(--surface)] px-1.5 py-px font-mono text-[11px] text-[var(--ink-3)]">⌘K</span>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_54px_rgba(0,0,0,0.22)]">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--ink-3)]">No matches for “{q.trim()}”.</div>
          ) : results.map((r, i) => (
            <button
              key={r.kind + (r.item?.id ?? r.legacyRecord?.id ?? r.area?.id ?? r.id) + i}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left transition", i === active ? "bg-[var(--surface-2)]" : "")}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--ink-3)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={r.kind === "page" || r.kind === "legacy-record" ? "M4 6 H20 M4 12 H20 M4 18 H14" : AREA_ICON[r.kind === "area" ? r.area.id : getAreaForType(r.item.type).id]} /></svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{r.label}</span>
                <span className="block truncate text-[12px] text-[var(--ink-3)]">{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPage({ vault, onExport, onReset, onLoadDemo, session, onShowAuthScreen, onSignOut, subscription, entitlements, onSubscriptionChange, autoLockMs, onAutoLockChange }) {
  const supabaseOn = isSupabaseConfigured();
  const [theme, setTheme] = useState(() => (typeof document !== "undefined" && document.body.dataset.theme === "dark") ? "dark" : "light");
  function applyTheme(t) { document.body.dataset.theme = t; try { localStorage.setItem("lyfos-theme", t); } catch {} setTheme(t); }
  function downloadCsv() { const csv = buildSnapshotsCsv(vault?.balanceSheet ?? {}); downloadTextFile(suggestedCsvFilename(), csv, "text/csv"); }

  const Card = ({ children }) => <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">{children}</div>;
  const Label = ({ children, tone }) => <h2 className={cx("mb-3 mt-8 text-base font-semibold", tone === "danger" ? "text-[var(--red-2)]" : "text-[var(--ink)]")}>{children}</h2>;
  const Row = ({ title, hint, children, last }) => (
    <div className={cx("flex items-center gap-4 px-5 py-4", !last && "border-b border-[var(--line)]")}>
      <div className="min-w-0 flex-1"><div className="text-[14px] font-medium text-[var(--ink)]">{title}</div>{hint && <div className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">{hint}</div>}</div>
      {children}
    </div>
  );
  const Seg = ({ options, value, onChange }) => (
    <div className="flex gap-1 rounded-[10px] bg-[var(--surface-2)] p-1">
      {options.map(([v, l]) => <button key={String(v)} onClick={() => onChange(v)} className={cx("rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition", value === v ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(0,0,0,0.1)]" : "text-[var(--ink-3)] hover:text-[var(--ink)]")}>{l}</button>)}
    </div>
  );
  const Ghost = ({ onClick, children }) => <button onClick={onClick} className="shrink-0 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">{children}</button>;

  return (
    <div>
      <h1 className="text-[28px] font-semibold tracking-tight text-[var(--ink)]">Settings</h1>
      <p className="mt-1 text-[14px] text-[var(--ink-2)]">Make Lyfos yours.</p>

      <Label>Appearance</Label>
      <Card><Row title="Theme" hint="Light is easy on the eyes by day; dark is calmer at night." last><Seg options={[["light", "Light"], ["dark", "Dark"]]} value={theme} onChange={applyTheme} /></Row></Card>

      <Label>Security</Label>
      <Card>
        <Row title="Auto-lock" hint="Locks the vault after a few minutes away."><Seg options={LOCK_TIMEOUT_OPTIONS.map((o) => [o.ms, o.label])} value={autoLockMs} onChange={(v) => onAutoLockChange(Number(v))} /></Row>
        <Row title="Recovery phrase" hint="Stored only by you — never on our servers." last><span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--green-ink)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />Verified</span></Row>
      </Card>

      <Label>Account</Label>
      {supabaseOn ? (session ? (
        <Card><Row title={session.user?.email ?? "Signed in"} hint="Cloud sync is live — your vault uploads as ciphertext only." last><Ghost onClick={onSignOut}>Sign out</Ghost></Row></Card>
      ) : (
        <Card><Row title="Not signed in" hint="Without an account your vault lives on this browser only." last><button onClick={onShowAuthScreen} className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-white">Sign in</button></Row></Card>
      )) : (
        <Card><Row title="Local-only vault" hint="This deployment keeps your vault on this device." last><span className="text-[13px] text-[var(--ink-3)]">On this device</span></Row></Card>
      )}
      {supabaseOn && session && <div className="mt-3"><BillingSection subscription={subscription} entitlements={entitlements} session={session} onSubscriptionChange={onSubscriptionChange} /><HeldKeysSection /><DeviceListSection /></div>}

      <Label>Your vault</Label>
      <Card>
        <Row title="Backup encrypted vault" hint="Download an encrypted file you can restore from any device."><Ghost onClick={onExport}>Backup</Ghost></Row>
        <Row title="Export balance sheet as CSV" hint="Plaintext spreadsheet of every month's values. Store it carefully." last={!demoEnabled()}><Ghost onClick={downloadCsv}>Export CSV</Ghost></Row>
        {demoEnabled() && <Row title="Load demo data" hint="Replace your vault with realistic sample data for testing." last><Ghost onClick={onLoadDemo}>Load demo</Ghost></Row>}
      </Card>

      <Label tone="danger">Danger zone</Label>
      <button onClick={onReset} className="w-full rounded-2xl border border-[var(--red-2)] bg-[var(--red-soft)] px-5 py-4 text-left transition hover:opacity-90">
        <div className="text-[14px] font-semibold text-[var(--red-2)]">Delete this local vault</div>
        <div className="mt-1 text-[12.5px] text-[var(--ink-3)]">This cannot be undone. Without an export you will lose everything on this device.</div>
      </button>
      {supabaseOn && session && <DeleteAccountButton onDone={onReset} />}
    </div>
  );
}

const ONBOARDING_KEY = "lyfos-onboarded-v1";

const TOUR_STEPS = [
  { target: null, title: "Welcome to your vault", body: "Everything you keep here is encrypted on this device the moment you save it. We can never read it — only you, and the people you choose." },
  { target: "add", title: "Add what matters", body: "Start here. Save passwords, accounts, documents and IDs. Each one is sealed the instant it’s stored." },
  { target: "trust", title: "Your circle of trust", body: "Name the people who could recover this vault if something happened to you — you stay in control the entire time." },
  { target: "dryrun", title: "Preview the promise", body: "One click shows exactly what your family would receive — a practice run, before anything ever happens." },
  { target: "seal", title: "Seal it anytime", body: "Stepping away? Tap Seal to lock everything instantly. That’s the whole tour — go explore." }
];

/**
 * Apple-style coachmark tour: dims the page, spotlights one element at a time,
 * and walks a first-time user through 3–5 steps with Next/Back. Anchors to
 * elements via [data-tour="…"]; when an anchor isn't on screen (e.g. the rail
 * is hidden on mobile) the step simply centers with no spotlight.
 */
function OnboardingTour({ steps, onDone }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  useLayoutEffect(() => {
    function measure() {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { setRect(null); return; }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    measure();
    const id = setTimeout(measure, 60); // settle after layout/scroll
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(id); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [i, step]);

  // Card placement: beside/under the spotlight, else screen-centered.
  const pad = 8;
  let cardStyle;
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const below = rect.top + rect.height + 14;
    const placeBelow = below + 190 < vh;
    const top = placeBelow ? below : Math.max(16, rect.top - 14 - 190);
    let left = rect.left + rect.width / 2 - 160;
    left = Math.max(16, Math.min(left, vw - 320 - 16));
    cardStyle = { top, left };
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="fixed inset-0 z-[120]">
      {/* dim + spotlight (box-shadow cuts the hole); full-screen catcher blocks the app */}
      {rect ? (
        <div className="pointer-events-none fixed rounded-[14px] ring-2 ring-white/70 transition-all duration-300 ease-out"
             style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(8,12,16,0.62)" }} />
      ) : (
        <div className="fixed inset-0" style={{ background: "rgba(8,12,16,0.62)" }} />
      )}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      {/* coachmark card */}
      <div className="fixed w-[320px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]" style={cardStyle}>
        <div className="flex items-center gap-1.5">
          {steps.map((_, idx) => (
            <span key={idx} className="h-1.5 rounded-full transition-all" style={{ width: idx === i ? 18 : 6, background: idx === i ? "var(--accent)" : "var(--line-2)" }} />
          ))}
        </div>
        <h3 className="mt-4 text-[18px] font-semibold tracking-tight text-[var(--ink)]">{step.title}</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--ink-2)]">{step.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <button onClick={onDone} className="text-[12.5px] font-medium text-[var(--ink-4)] transition hover:text-[var(--ink-2)]">Skip</button>
          <div className="flex items-center gap-2">
            {i > 0 && <button onClick={() => setI(i - 1)} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">Back</button>}
            <button onClick={() => (last ? onDone() : setI(i + 1))} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-90">{last ? "Start exploring" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VaultExperience({ vault, vaultKey, notice, autoLockMs, onAutoLockChange, onSave, onLock, backupHealth, backupSizeWarning, onExport, onReplaceRecoveryKey, onDigitalLegacyMigrate, onReset, session, onShowAuthScreen, onSignOut, subscription, entitlements, onSubscriptionChange, storedRecord, pendingReauth, runWithRecentAuth, onReauthConfirmed, onReauthCancel }) {
  const [screen, setScreen] = useState(() => (DIGITAL_LEGACY_FEATURE_FLAGS.dashboard ? "legacy" : "home"));
  // The screen that counts as "home" for cross-cutting UI (sync nudge,
  // wide layout, onboarding tour) — follows whichever screen is actually
  // the landing screen above, so those don't silently stop firing.
  const primaryScreen = DIGITAL_LEGACY_FEATURE_FLAGS.dashboard ? "legacy" : "home";
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [screen]);

  async function loadDemoData() {
    const ok = vault.items.length === 0 || window.confirm("Replace current vault contents with full demo data?");
    if (!ok) return;
    const demo = await loadDemoVaultModule();
    await onSave(demo);
    setScreen("home");
  }

  const [areaId, setAreaId] = useState(null);
  const [pendingRecordId, setPendingRecordId] = useState(null);
  const model = useMemo(() => getLifeModel(vault), [vault]);
  const stateDot = { protected: "var(--green)", review: "var(--amber)", exposed: "var(--rose,#c0335e)" };
  function openArea(id) { setPendingRecordId(null); setAreaId(id); setScreen("area"); }
  function openRecord(item) { const a = getAreaForType(item.type); setAreaId(a.id); setPendingRecordId(item.id); setScreen("area"); }

  // Digital Legacy. Phase 3 shipped read-only sample data; Phase 4A
  // (see docs/LYFOS_DIGITAL_LEGACY_ASSESSMENT.md) connects real
  // non-secret create/edit to the actual encrypted vault.
  const [legacyCategoryId, setLegacyCategoryId] = useState(null);
  const [legacyRecordId, setLegacyRecordId] = useState(null);
  const [legacyEditRecordId, setLegacyEditRecordId] = useState(null);
  function openLegacyCategory(id) { setLegacyCategoryId(id); setScreen("legacy-category"); }
  function openLegacyRecord(id) { setLegacyRecordId(id); setScreen("legacy-record"); }
  function openLegacyRecordNew(categoryId) { setLegacyCategoryId(categoryId); setLegacyEditRecordId(null); setScreen("legacy-record-edit"); }
  function openLegacyRecordEdit(id) { setLegacyEditRecordId(id); setScreen("legacy-record-edit"); }
  async function markLegacyCategoryNotApplicable(categoryId) {
    const now = new Date().toISOString();
    const digitalLegacy = vault.digitalLegacy ?? { categoryReviews: [], customCategories: [], customServices: [], records: [] };
    const nextReviews = [
      ...digitalLegacy.categoryReviews.filter((r) => r.categoryId !== categoryId),
      { categoryId, state: "not_applicable", reviewedAt: now }
    ];
    await onSave(appendAuditEvent({
      ...vault,
      digitalLegacy: { ...digitalLegacy, categoryReviews: nextReviews, updatedAt: now }
    }, "Digital Legacy category marked not applicable"), "record_change");
  }
  // Migration runs once, lazily, the first time the owner opens My Legacy
  // for real — never touches vault.items, see onDigitalLegacyMigrate above.
  useEffect(() => {
    if (!DIGITAL_LEGACY_FEATURE_FLAGS.dashboard) return;
    if (screen !== "legacy" && screen !== "legacy-category" && screen !== "legacy-record" && screen !== "legacy-record-edit") return;
    if (vault.digitalLegacy) return;
    onDigitalLegacyMigrate?.();
  }, [screen, vault.digitalLegacy]);
  const selectedArea = AREAS.find((a) => a.id === areaId) ?? AREAS[0];
  const initials = (session?.user?.email?.[0] ?? "L").toUpperCase();

  // Coachmark tour stays available on demand, but should not block the first
  // post-create action. The empty state already points to the right next step.
  const [showTour, setShowTour] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem("lyfos-rail-collapsed") === "1"; } catch { return false; }
  });
  function toggleRail() {
    setRailCollapsed((collapsed) => {
      const next = !collapsed;
      try { localStorage.setItem("lyfos-rail-collapsed", next ? "1" : "0"); } catch { /* local preference only */ }
      return next;
    });
  }
  function finishTour() {
    try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* ignore */ }
    setShowTour(false);
  }

  // One-shot flag: Home's "see what your family would receive" opens the
  // recovery practice run directly on the release screen.
  const [releaseAutoPreview, setReleaseAutoPreview] = useState(false);
  useEffect(() => { if (screen !== "release") setReleaseAutoPreview(false); }, [screen]);

  // Sync-by-default: nudge until the vault is protected by encrypted sync.
  // "Later" hides it for this unlock only — data loss is too costly to forget.
  const [syncNudgeDismissed, setSyncNudgeDismissed] = useState(false);
  const syncNudgeVisible = isSupabaseConfigured() && !session && !syncNudgeDismissed && !showTour && screen === primaryScreen;

  // Guided "next action" — pulse exactly one button, in setup order, until done.
  const hasRecords = vault.items.length > 0;
  const hasBalance = (vault.balanceSheet?.accounts?.length ?? 0) > 0;
  const holdersFilled = (vault.releaseSettings?.keyHolders ?? []).filter((h) => h.trim()).length;
  const hasRelease = Boolean(vault.releaseSettings?.mainNominee?.trim()) && holdersFilled >= RELEASE_POLICY.requiredKeys;
  const canUseBalanceSheet = entitlements?.balanceSheetEnabled ?? false;
  const canUseRelease = entitlements?.releaseEnabled ?? false;
  const freeLimitReached = Number.isFinite(entitlements?.vaultItemLimit) && vault.items.length >= entitlements.vaultItemLimit;
  const nextAction = !hasRecords
    ? "capture"
    : canUseBalanceSheet && !hasBalance
      ? "money"
      : canUseRelease && !hasRelease
        ? "release"
        : null;
  const hint = (id) => !showTour && nextAction === id && screen !== id;

  const railWorkspace = DIGITAL_LEGACY_FEATURE_FLAGS.dashboard
    ? [
        { id: "legacy", label: "My Legacy", icon: "M12 3 L4 7 V12 C4 17 7.5 20.5 12 22 C16.5 20.5 20 17 20 12 V7 Z" },
        { id: "money", label: "Balance sheet", icon: "M3 18 L9 11 L13 15 L21 6 M21 6 H16 M21 6 V11", locked: !canUseBalanceSheet },
        { id: "release", label: "Circle of trust", icon: "M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z M9 12 l2 2 l4 -4", locked: !canUseRelease }
      ]
    : [
        { id: "home", label: "Home", icon: "M4 11 L12 4 L20 11 M6 9.5 V20 H18 V9.5" },
        { id: "records", label: "All records", icon: "M4 4 h16 v16 H4 Z M4 9 H20", count: vault.items.length },
        { id: "money", label: "Balance sheet", icon: "M3 18 L9 11 L13 15 L21 6 M21 6 H16 M21 6 V11", locked: !canUseBalanceSheet },
        { id: "release", label: "Circle of trust", icon: "M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z M9 12 l2 2 l4 -4", locked: !canUseRelease }
      ];
  function isRailActive(id) { return screen === id || (id === "legacy" && (screen === "legacy-category" || screen === "legacy-record" || screen === "legacy-record-edit")); }

  // Digital Legacy categories that actually have an active record —
  // the same left-rail slot the old "Life areas" list occupied, now
  // populated from real Digital Legacy data instead of vault.items.
  const legacyCategoriesWithData = useMemo(() => {
    if (!DIGITAL_LEGACY_FEATURE_FLAGS.dashboard || !vault.digitalLegacy) return [];
    const attentionStatuses = new Set(["action_required", "incomplete", "needs_review"]);
    return LEGACY_CATEGORIES
      .map((category) => {
        const records = vault.digitalLegacy.records.filter((r) => r.categoryId === category.id && r.status !== "archived");
        return { category, count: records.length, needsAttention: records.some((r) => attentionStatuses.has(r.status)) };
      })
      .filter(({ count }) => count > 0)
      .sort((a, b) => a.category.sortOrder - b.category.sortOrder);
  }, [vault.digitalLegacy]);

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
        <div className="flex items-center gap-2.5 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M8.2 11V8.3a3.8 3.8 0 0 1 7.6 0V11" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" /><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2.7" fill="#fff" /><circle cx="12" cy="14.7" r="1.55" fill="var(--accent)" /><path d="M12 15.7l-1.05 3.5h2.1z" fill="var(--accent)" /></svg>
          </span>
          Lyfos
        </div>
        <GlobalSearch vault={vault} onOpenArea={openArea} onOpenRecord={openRecord} onNavigate={setScreen} onOpenLegacyCategory={openLegacyCategory} onOpenLegacyRecord={openLegacyRecord} />
        <div className="ml-auto flex items-center gap-2.5">
          <NotificationBell vault={vault} backupHealth={backupHealth} onNavigate={setScreen} onOpenSettings={() => setScreen("settings")} />
          <button data-tour="seal" onClick={() => onLock("Manual lock")} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">Seal</button>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-[13px] font-semibold text-white">{initials}</span>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1340px]">
        {/* Left rail */}
        <aside className={cx("hidden shrink-0 border-r border-[var(--line)] py-5 transition-[width] duration-200 lg:block", railCollapsed ? "w-[76px] px-2" : "w-60 px-3")} style={{ minHeight: "calc(100vh - 3.5rem)" }}>
          <button onClick={toggleRail} aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"} title={railCollapsed ? "Expand navigation" : "Collapse navigation"} className={cx("mb-4 flex h-9 items-center rounded-[10px] text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]", railCollapsed ? "w-full justify-center" : "w-full justify-end px-2.5")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={railCollapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} /><path d="M4 5v14" /></svg>
          </button>
          {!railCollapsed && <div className="px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">Workspace</div>}
          <div className="mt-1.5 space-y-0.5">
            {railWorkspace.map((n) => <RailItem key={n.id} collapsed={railCollapsed} active={isRailActive(n.id)} onClick={() => setScreen(n.id)} icon={n.icon} label={n.label} count={n.count} locked={n.locked} dataTour={n.id === "release" ? "trust" : undefined} pulse={hint(n.id)} />)}
          </div>
          {DIGITAL_LEGACY_FEATURE_FLAGS.dashboard ? (
            legacyCategoriesWithData.length > 0 && (
              <>
                {!railCollapsed && <div className="mt-6 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">My Legacy</div>}
                <div className="mt-1.5 space-y-0.5">
                  {legacyCategoriesWithData.map(({ category, count, needsAttention }) => (
                    <RailItem key={category.id} collapsed={railCollapsed} active={screen === "legacy-category" && legacyCategoryId === category.id} onClick={() => openLegacyCategory(category.id)} dot={needsAttention ? "var(--amber)" : "var(--green)"} label={category.name} count={count} />
                  ))}
                </div>
              </>
            )
          ) : (
            <>
              {!railCollapsed && <div className="mt-6 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">Life areas</div>}
              <div className="mt-1.5 space-y-0.5">
                {model.areas.map((a) => <RailItem key={a.id} collapsed={railCollapsed} active={screen === "area" && areaId === a.id} onClick={() => openArea(a.id)} dot={stateDot[a.state]} label={a.label} count={a.count} />)}
              </div>
            </>
          )}
          {!railCollapsed && <div className="mt-6 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">You</div>}
          <div className="mt-1.5 space-y-0.5">
            <RailItem collapsed={railCollapsed} active={screen === "capture" || screen === "legacy-record-edit"} onClick={() => setScreen(DIGITAL_LEGACY_FEATURE_FLAGS.dashboard ? "legacy" : "capture")} icon="M12 5 V19 M5 12 H19" label="Add a record" count={freeLimitReached ? `${vault.items.length}/${entitlements.vaultItemLimit}` : undefined} dataTour="add" pulse={hint("capture")} />
            <RailItem collapsed={railCollapsed} active={screen === "settings"} onClick={() => setScreen("settings")} icon="M12 9 a3 3 0 1 0 0 6 a3 3 0 0 0 0-6 Z M12 2 v3 M12 19 v3 M5 5 l2 2 M17 17 l2 2 M2 12 h3 M19 12 h3 M5 19 l2-2 M17 7 l2-2" label="Settings" />
          </div>
        </aside>

        {/* Content */}
        <section className="min-w-0 flex-1 px-5 py-8 lg:px-10">
          {/* Mobile nav — must include Add a record + Settings (no rail on phones) */}
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {railWorkspace.map((n) => (
              <button key={n.id} onClick={() => setScreen(n.id)} className={cx("shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium", isRailActive(n.id) ? "bg-[var(--ink)] text-[var(--bg)]" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]", n.locked && !isRailActive(n.id) && "opacity-60", hint(n.id) && "tour-pulse")}>{n.label}{n.locked ? " · Locked" : ""}</button>
            ))}
            <button onClick={() => setScreen(DIGITAL_LEGACY_FEATURE_FLAGS.dashboard ? "legacy" : "capture")} className={cx("shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium", (screen === "capture" || screen === "legacy-record-edit") ? "bg-[var(--ink)] text-[var(--bg)]" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]", hint("capture") && "tour-pulse")}>+ Add</button>
            <button onClick={() => setScreen("settings")} className={cx("shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium", screen === "settings" ? "bg-[var(--ink)] text-[var(--bg)]" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]")}>Settings</button>
          </div>
          {/* Mobile: a persistent "add" affordance for the most common action */}
          <button onClick={() => setScreen(DIGITAL_LEGACY_FEATURE_FLAGS.dashboard ? "legacy" : "capture")} aria-label="Add a record" className="fixed bottom-5 right-5 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-white shadow-[0_10px_28px_rgba(22,163,74,0.28)] transition hover:translate-y-[-1px] lg:hidden">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5 V19 M5 12 H19" /></svg>
            <span className="text-[13px] font-semibold">Add record</span>
          </button>

          {notice && <div className="mb-5 rounded-2xl border border-[#34c759]/20 bg-[#34c759]/10 px-5 py-4 text-sm font-semibold text-[var(--green-ink)]">{notice}</div>}
          {syncNudgeVisible && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--amber-soft,#f3e2c4)] bg-[var(--amber-soft,#fdf4e3)] px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-[var(--amber-ink,#7a4b00)]">This vault lives only in this browser.</p>
                <p className="mt-0.5 text-[12.5px] text-[var(--amber-ink,#7a4b00)]/85">Clearing browser data would erase it. Turn on encrypted sync — we only ever store ciphertext.</p>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <button onClick={onShowAuthScreen} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:opacity-90">Turn on sync</button>
                <button onClick={() => setSyncNudgeDismissed(true)} className="text-[11.5px] font-medium text-[var(--amber-ink,#7a4b00)]/70 hover:underline">Later</button>
              </div>
            </div>
          )}
          {backupSizeWarning?.level !== "none" && <BackupSizeNotice warning={backupSizeWarning} />}
          {session && screen !== "release" && <ActiveReleaseBanner onNavigateRelease={() => setScreen("release")} />}

          <div className={cx("mx-auto flex gap-8", screen === primaryScreen ? "max-w-[1280px] items-start" : "max-w-3xl")}>
            <div className="min-w-0 flex-1">
              {screen === "home"    && <FamilyHomeDashboard vault={vault} onNavigate={setScreen} onOpenArea={openArea} onOpenRecord={openRecord} />}
              {screen === "records" && <AllRecords vault={vault} onOpenRecord={openRecord} />}
              {screen === "money"   && (canUseBalanceSheet ? <BalanceSheetDashboard vault={vault} onSave={onSave} onNavigate={setScreen} /> : <PaidFeatureLock feature="Personal balance sheet" body="Free Forever keeps your first 11 vault entries safe. Upgrade when you want assets, liabilities, net worth history, and the calm financial view inside Lyfos." onOpenSettings={() => setScreen("settings")} hasSession={Boolean(session)} />)}
              {screen === "setup"   && <SetupScreen vault={vault} onSave={onSave} onNavigate={setScreen} />}
              {screen === "update"  && <UpdateScreen vault={vault} onSave={onSave} onNavigate={setScreen} />}
              {screen === "capture" && <CaptureScreen vault={vault} onSave={onSave} entitlements={entitlements} onNavigate={(s) => setScreen(s === "life" ? "home" : s)} />}
              {screen === "release" && (canUseRelease ? <ReleaseScreen vault={vault} onSave={onSave} session={session} vaultKey={vaultKey} entitlements={entitlements} autoPreview={releaseAutoPreview} /> : <PaidFeatureLock feature="Circle of Trust" body="The nominee release service is a paid feature because it needs verified key holders, invite email delivery, owner-protection holds, and release alerts." onOpenSettings={() => setScreen("settings")} />)}
              {(screen === "legacy" || screen === "legacy-category" || screen === "legacy-record" || screen === "legacy-record-edit")
                && DIGITAL_LEGACY_FEATURE_FLAGS.dashboard && !vault.digitalLegacy && (
                <div className="py-16 text-center text-[13px] text-[var(--ink-3)]">Setting up My Legacy…</div>
              )}
              {screen === "legacy" && DIGITAL_LEGACY_FEATURE_FLAGS.dashboard && vault.digitalLegacy && (
                <MyLegacyScreen digitalLegacy={vault.digitalLegacy} onOpenCategory={openLegacyCategory} onOpenRecord={openLegacyRecord} onMarkNotApplicable={markLegacyCategoryNotApplicable} />
              )}
              {screen === "legacy-category" && DIGITAL_LEGACY_FEATURE_FLAGS.dashboard && vault.digitalLegacy && (
                <LegacyCategoryScreen digitalLegacy={vault.digitalLegacy} categoryId={legacyCategoryId} onOpenRecord={openLegacyRecord} onAddRecord={openLegacyRecordNew} onBack={() => setScreen("legacy")} />
              )}
              {screen === "legacy-record" && DIGITAL_LEGACY_FEATURE_FLAGS.dashboard && vault.digitalLegacy && (
                <LegacyRecordScreen digitalLegacy={vault.digitalLegacy} vault={vault} onSave={onSave} recordId={legacyRecordId} onBack={() => setScreen(legacyCategoryId ? "legacy-category" : "legacy")} onEdit={openLegacyRecordEdit} runWithRecentAuth={runWithRecentAuth} />
              )}
              {screen === "legacy-record-edit" && DIGITAL_LEGACY_FEATURE_FLAGS.dashboard && DIGITAL_LEGACY_FEATURE_FLAGS.serviceCatalogue && vault.digitalLegacy && (
                <LegacyRecordForm
                  // Forces a fresh mount per category/record — without this,
                  // React reuses the instance across "Add record" calls and
                  // its useState-seeded service/field selection from the
                  // previous category leaks into the next (the HDFC-Bank-
                  // fields-under-Cloud-storage bug).
                  key={`${legacyCategoryId}-${legacyEditRecordId ?? "new"}`}
                  digitalLegacy={vault.digitalLegacy}
                  vault={vault}
                  onSave={onSave}
                  categoryId={legacyCategoryId}
                  recordId={legacyEditRecordId}
                  onDone={(id) => { setLegacyRecordId(id); setScreen("legacy-record"); }}
                  onCancel={() => setScreen(legacyEditRecordId ? "legacy-record" : "legacy-category")}
                />
              )}
              {screen === "area"    && <CategoryWorkspace vault={vault} area={selectedArea} initialRecordId={pendingRecordId} onSave={onSave} onCapture={() => setScreen("capture")} onClose={() => setScreen("home")} entitlements={entitlements} onOpenSettings={() => setScreen("settings")} runWithRecentAuth={runWithRecentAuth} />}
            {screen === "settings" && <SettingsPage vault={vault} onExport={onExport} onReset={onReset} onLoadDemo={loadDemoData} session={session} onShowAuthScreen={onShowAuthScreen} onSignOut={onSignOut} subscription={subscription} entitlements={entitlements} onSubscriptionChange={onSubscriptionChange} autoLockMs={autoLockMs} onAutoLockChange={onAutoLockChange} />}

              <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] py-6 text-[11px] font-medium text-[var(--ink-4)]">
                <span>Lyfos · Locally encrypted on this device.</span>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => setShowTour(true)} className="hover:text-[var(--ink)]">Tour</button>
                  <a href="mailto:hello@lyfos.in?subject=Lyfos%20help" className="hover:text-[var(--ink)]">Help</a>
                  <a href="/legal/product-disclaimer.html" className="hover:text-[var(--ink)]">Product disclaimer</a>
                  <a href="/legal/privacy.html" className="hover:text-[var(--ink)]">Privacy</a>
                  <a href="/legal/terms.html" className="hover:text-[var(--ink)]">Terms</a>
                </div>
              </footer>
            </div>

          </div>
        </section>
      </div>

      {showTour && screen === primaryScreen && <OnboardingTour steps={TOUR_STEPS} onDone={finishTour} />}
      {pendingReauth && <ReauthPrompt storedRecord={storedRecord} onConfirmed={onReauthConfirmed} onCancel={onReauthCancel} />}
    </main>
  );
}

function ReauthPrompt({ storedRecord, onConfirmed, onCancel }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleConfirm(e) {
    e.preventDefault();
    setError("");
    setChecking(true);
    try {
      await decryptVaultWithPassphrase(storedRecord, passphrase);
      onConfirmed();
    } catch (err) {
      setError(err?.message || "Could not verify your passphrase.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <form onSubmit={handleConfirm} className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_54px_rgba(0,0,0,0.22)]">
        <p className="text-[15px] font-semibold text-[var(--ink)]">Confirm it's you</p>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--ink-3)]">This action needs a fresh check — re-enter your vault passphrase to continue.</p>
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => { setPassphrase(e.target.value); setError(""); }}
          placeholder="Your passphrase"
          className="mt-4 w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
        />
        {error && <p className="mt-2 text-[12px] font-medium text-[var(--red-2)]">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-[var(--line-2)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)]">Cancel</button>
          <button type="submit" disabled={checking || !passphrase} className="flex-1 rounded-full bg-[#1d1d1f] px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-wait disabled:opacity-50">
            {checking ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ActiveReleaseBanner({ onNavigateRelease }) {
  const [request, setRequest] = useState(null);
  const [aborting, setAborting] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setRequest(await fetchActiveReleaseAgainstMe());
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[lyfos] active release fetch:", err?.message);
    }
  }

  useEffect(() => {
    refresh();
    // Poll every 60 seconds while one is active. Cheap enough.
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!request) return null;

  async function abort() {
    if (!window.confirm("Abort this release request? Your nominee will be notified and your vault stays sealed.")) return;
    setAborting(true);
    setError("");
    try {
      await ownerAbortRelease(request.id, "owner_abort_from_banner");
      await refresh();
    } catch (err) {
      setError(err?.message || "Couldn't abort.");
    } finally {
      setAborting(false);
    }
  }

  const tone = stateTone(request.state);
  const daysRemaining = request.ready_at
    ? Math.max(0, Math.ceil((new Date(request.ready_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return (
    <div className={cx("mb-5 rounded-3xl border px-5 py-4", tone.bg, tone.border)}>
      <div className="flex items-start gap-3">
        <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white", tone.dot)}>!</span>
        <div className="flex-1">
          <p className={cx("text-[12px] font-semibold uppercase tracking-[0.14em]", tone.text)}>
            Active release request · {stateLabel(request.state)}
          </p>
          <p className={cx("mt-1.5 text-[13px] leading-5", tone.text)}>
            {bannerCopy(request, daysRemaining)}
          </p>
          {error && <p className="mt-2 text-[12px] text-[var(--red-2)]">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={abort}
              disabled={aborting || ["opened", "aborted", "rejected", "expired", "completed", "cancelled"].includes(request.state)}
              className="rounded-full bg-[#b42318] px-4 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_12px_rgba(180,35,24,0.25)] transition hover:bg-[#8e1612] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aborting ? "Aborting…" : "Abort — I'm fine"}
            </button>
            <button onClick={onNavigateRelease} className={cx("text-[12px] font-medium underline-offset-2 hover:underline", tone.text)}>
              View release tab
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function stateTone(state) {
  if (["holding", "ready_to_recover", "ready_to_release"].includes(state)) {
    return { bg: "bg-[#ff453a]/8", border: "border-[#b42318]/40", text: "text-[var(--red-ink)]", dot: "bg-[#b42318]" };
  }
  return { bg: "bg-[var(--amber-soft)]", border: "border-[#c88719]/30", text: "text-[var(--amber-ink)]", dot: "bg-[#c88719]" };
}

function stateLabel(state) {
  return {
    under_review:      "Evidence under review",
    collecting_support:"Waiting for two supporting nominees",
    ready_to_recover:  "Ready for the recipient",
    opened:            "Opened read-only",
    aborted:           "Aborted",
    expired:           "Expired",
    pending_review:    "Pending Lyfos review",
    approved:          "Approved · waiting for your key holders",
    awaiting_shares:   "Key holders releasing",
    holding:           "Owner-protection hold",
    ready_to_release:  "Hold expired",
    completed:         "Released",
    cancelled:         "Aborted",
    rejected:          "Rejected"
  }[state] ?? state;
}

function bannerCopy(request, daysRemaining) {
  switch (request.state) {
    case "under_review":
      return `A recovery recipient (${request.nominee_email_at_request}) submitted evidence. Lyfos is reviewing it. If this is unexpected, abort now.`;
    case "collecting_support":
      return `Two nominees other than the selected recipient must independently release their keys. Your vault remains sealed and you can still abort.`;
    case "pending_review":
      return `Someone (${request.nominee_email_at_request}) filed a release claim. Lyfos is reviewing the certificate. If this isn't expected — abort now.`;
    case "approved":
      return `Lyfos approved the claim. Your 5 key holders are being asked to release their shares. If this isn't expected — abort now.`;
    case "awaiting_shares":
      return `Your key holders are releasing shares. Once 3 of 5 release, a 14-day hold begins during which you'll be alerted daily. If this isn't expected — abort now.`;
    case "holding":
      return `The 14-day owner-protection hold is active. ${daysRemaining ?? "?"} day${daysRemaining === 1 ? "" : "s"} remaining. If you're alive and reading this — abort now and your vault stays sealed.`;
    case "ready_to_recover":
      return `The owner-protection hold has completed. The selected recipient can now match their private recovery key and open the entire vault read-only. You can still abort until it is opened.`;
    case "ready_to_release":
      return `The 14-day hold has expired. Your nominee can now download the emergency-eligible records. Abort is no longer possible.`;
    default:
      return `Release request in state: ${request.state}.`;
  }
}

function DeleteAccountButton({ onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="mt-3 w-full rounded-xl border border-[#b42318]/30 bg-[var(--surface)] px-4 py-3 text-left text-[13px] font-medium text-[var(--red-2)] transition hover:bg-[#b42318]/5"
      >
        Delete account entirely
        <span className="mt-1 block text-[11px] font-normal text-[var(--ink-3)]">
          Permanently removes your account and the encrypted blob from our servers. Local vault on this device is also wiped. DPDPA / GDPR right to erasure.
        </span>
      </button>
    );
  }

  async function confirm() {
    if (typed !== "delete my account") {
      setError("Type exactly: delete my account");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteAccount();
      // Also wipe local copies of everything.
      try { localStorage.clear(); } catch {}
      onDone?.();
      window.location.assign("/");
    } catch (err) {
      setError(err?.message || "Could not complete deletion. Try again or email support.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[#b42318]/30 bg-[#ff453a]/6 p-4">
      <p className="text-[13px] font-semibold text-[var(--red-ink)]">This deletes everything.</p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--red-ink)]/85">
        Your account, the encrypted vault on our servers, every device record, the audit log, and the local vault on this device. We will not be able to recover any of it. Type <strong>delete my account</strong> to confirm.
      </p>
      <input
        autoFocus
        value={typed}
        onChange={(e) => { setTyped(e.target.value); setError(""); }}
        placeholder="delete my account"
        className="mt-3 w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[#b42318]"
      />
      {error && <p className="mt-2 text-[11px] font-medium text-[var(--red-2)]">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => { setConfirming(false); setTyped(""); setError(""); }}
          className="text-[11px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
          disabled={busy}
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={busy || typed !== "delete my account"}
          className="rounded-full bg-[#b42318] px-4 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_12px_rgba(180,35,24,0.25)] transition hover:bg-[#8e1612] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </div>
  );
}

function BillingSection({ subscription, entitlements, session, onSubscriptionChange }) {
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showPlans, setShowPlans] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [interestEmail, setInterestEmail] = useState(() => session?.user?.email ?? "");
  const [interestSaved, setInterestSaved] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState(null); // { code, originalAmountPaise, discountPaise, amountPaise }
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");

  async function loadEvents() {
    setLoadingEvents(true);
    try { setEvents(await fetchMyBillingEvents()); }
    catch (err) { if (typeof console !== "undefined") console.warn("[lyfos] events:", err?.message); }
    finally { setLoadingEvents(false); }
  }

  useEffect(() => { loadEvents(); }, []);

  async function joinPaidLaunchList() {
    setError("");
    setBusy(true);
    try {
      await joinVaultFallWaitlist({ email: interestEmail, source: "vault-fall-interest-app" });
      setInterestSaved(true);
    } catch (err) {
      setError(err?.message || "Couldn't save your email.");
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout(planId) {
    setError("");
    setBusy(true);
    try {
      const { checkoutUrl } = await startUpgrade({ plan: planId, couponCode: coupon?.code });
      window.location.assign(checkoutUrl);
      // Intentionally no finally/setBusy(false) on success — the page is
      // navigating away to Razorpay's hosted checkout page.
    } catch (err) {
      setError(err?.message || "Couldn't start checkout.");
      setBusy(false);
    }
  }

  async function applyCoupon(planId) {
    const code = couponInput.trim();
    if (!code) return;
    setCouponError("");
    setCouponBusy(true);
    try {
      const result = await validateCoupon({ plan: planId, code });
      if (!result.valid) { setCouponError(result.error || "Invalid coupon code"); setCoupon(null); }
      else setCoupon(result);
    } catch (err) {
      setCouponError(err?.message || "Couldn't check that code.");
      setCoupon(null);
    } finally {
      setCouponBusy(false);
    }
  }

  function clearCoupon() {
    setCoupon(null);
    setCouponInput("");
    setCouponError("");
  }

  async function openInvoice(path) {
    try {
      const url = await fetchInvoiceUrl(path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err?.message || "Couldn't open invoice.");
    }
  }

  const plan    = entitlements ?? planFor("free");
  const renewal = daysLeftFor(subscription);

  return (
    <div className="mt-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Billing</p>

      <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-[var(--ink)]">Lyfos {plan.label}</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
              {subscription?.plan === "free" || !subscription
                ? "Free Forever · 11 entries, upgrade for balance sheet and release"
                : subscription.status === "active"   ? "Lifetime access · one-time purchase, nothing to renew"
                : subscription.status === "trialing" ? `Free trial${renewal !== null ? ` · ${renewal} day${renewal === 1 ? "" : "s"} left` : ""}`
                : subscription.status === "expired"  ? "Trial ended · upgrade for lifetime access"
                : `Status: ${subscription.status}`}
            </p>
          </div>
          {subscription?.status !== "active" && (
            <button
              onClick={() => setShowPlans((v) => !v)}
              className="rounded-full bg-[#1d1d1f] px-4 py-1.5 text-[11px] font-semibold text-white"
              disabled={busy}
            >
              Upgrade
            </button>
          )}
        </div>

        {error && <div className="mt-3 rounded-md bg-[#ff453a]/8 px-3 py-2 text-[12px] font-medium text-[var(--red-2)]">{error}</div>}

        {showPlans && (
          <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
            {paidPlans().map((p) => {
              return (
                <div key={p.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] font-semibold">Lyfos {p.label}</p>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">{p.summary}</p>
                    </div>
                    <p className="text-[15px] font-semibold tabular-nums">
                      {coupon ? (
                        <>
                          <span className="mr-1.5 text-[12px] font-normal text-[var(--ink-4)] line-through">{formatCurrency(p.amountInr / 100, "INR")}</span>
                          {formatCurrency(coupon.amountPaise / 100, "INR")}
                        </>
                      ) : (
                        formatCurrency(p.amountInr / 100, "INR")
                      )}
                      <span className="text-[10px] font-normal text-[var(--ink-3)]"> one-time</span>
                    </p>
                  </div>
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-[12px] leading-5 text-[var(--ink-2)]">
                    {p.bullets.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                  {p.checkoutEnabled ? (
                    <>
                      {coupon ? (
                        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--green-soft)] px-3 py-2 text-[11.5px] font-medium text-[var(--green-ink)]">
                          <span>Coupon {coupon.code} applied — {formatCurrency(coupon.discountPaise / 100, "INR")} off</span>
                          <button onClick={clearCoupon} className="text-[var(--ink-3)] underline decoration-dotted">Remove</button>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={couponInput}
                              onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                              placeholder="Coupon code"
                              className="min-w-0 flex-1 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[12px] uppercase text-[var(--ink)] outline-none focus:border-[var(--green)]"
                            />
                            <button
                              onClick={() => applyCoupon(p.id)}
                              disabled={couponBusy || !couponInput.trim()}
                              className="rounded-full border border-[var(--line-2)] px-4 py-2 text-[12px] font-semibold text-[var(--ink)] disabled:opacity-40"
                            >
                              {couponBusy ? "Checking…" : "Apply"}
                            </button>
                          </div>
                          {couponError && <p className="mt-1.5 text-[11px] font-medium text-[var(--red-2)]">{couponError}</p>}
                        </div>
                      )}
                      <button
                        onClick={() => startCheckout(p.id)}
                        disabled={busy}
                        className="mt-3 w-full rounded-full bg-[#1d1d1f] px-4 py-2.5 text-[12px] font-semibold text-white disabled:cursor-wait disabled:opacity-50"
                      >
                        {busy ? "Opening Razorpay…" : `Get ${p.label} · ${formatCurrency((coupon ? coupon.amountPaise : p.amountInr) / 100, "INR")} one-time`}
                      </button>
                    </>
                  ) : (
                    <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                      <p className="text-[12px] font-medium text-[var(--ink)]">Launching this fall.</p>
                      <p className="mt-1 text-[11px] leading-5 text-[var(--ink-3)]">Submit your email id and we will save it in the Vault launch list.</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          type="email"
                          value={interestEmail}
                          onChange={(e) => { setInterestEmail(e.target.value); setInterestSaved(false); setError(""); }}
                          placeholder="you@example.com"
                          className="min-w-0 flex-1 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
                        />
                        <button
                          onClick={joinPaidLaunchList}
                          disabled={busy || !interestEmail.trim()}
                          className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
                        >
                          {busy ? "Saving…" : "Submit email"}
                        </button>
                      </div>
                      {interestSaved && <p className="mt-2 text-[11px] font-medium text-[var(--green-ink)]">You are on the list. Vault launches this fall.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invoices */}
      <div className="mt-3">
        <p className="px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Invoices</p>
        {loadingEvents && <p className="mt-2 px-3 text-[11px] text-[var(--ink-4)]">Loading…</p>}
        {!loadingEvents && events.length === 0 && (
          <p className="mt-2 px-3 text-[11px] text-[var(--ink-4)]">No invoices yet.</p>
        )}
        <div className="mt-2 space-y-1.5">
          {events.filter((e) => e.invoice_pdf_path || e.event_type.startsWith("payment.")).map((e) => (
            <button
              key={e.id}
              onClick={() => e.invoice_pdf_path && openInvoice(e.invoice_pdf_path)}
              disabled={!e.invoice_pdf_path}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px] transition hover:bg-[var(--surface)] disabled:cursor-default"
            >
              <span>
                <span className="font-medium">{e.invoice_number ?? e.event_type}</span>
                <span className="ml-2 text-[var(--ink-3)]">{new Date(e.created_at).toLocaleDateString()}</span>
              </span>
              <span className="tabular-nums text-[var(--ink)]">
                {e.amount_paise != null ? formatCurrency(e.amount_paise / 100, e.currency || "INR") : "—"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeldKeysSection() {
  const [summary, setSummary] = useState(() => summarizeHeldKeys([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listKeysIHeld()
      .then((rows) => { if (!cancelled) setSummary(summarizeHeldKeys(rows)); })
      .catch((err) => { if (!cancelled) setError(err?.message || "Couldn't load held keys."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (!summary.total && !error) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold text-[var(--ink)]">Keys you hold</h2>
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        {error && <div className="px-5 py-4 text-[13px] text-[var(--red-2)]">{error}</div>}
        {!error && summary.relationships.map((rel, index) => (
          <div key={rel.id ?? `${rel.ownerEmail}-${index}`} className={cx("flex items-center gap-4 px-5 py-4", index < summary.relationships.length - 1 && "border-b border-[var(--line)]")}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--green-soft)] text-[var(--accent)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z" /><path d="M9 12 l2 2 l4 -4" /></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-[var(--ink)]">You hold a key for {rel.ownerLabel}'s vault</div>
              <div className="mt-0.5 truncate text-[12.5px] text-[var(--ink-3)]">
                {rel.ownerEmail || "Vault owner"} · no plain key is shown or stored
              </div>
            </div>
            <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider", rel.ready ? "bg-[#34c759]/10 text-[var(--green-ink)]" : "bg-[var(--amber-soft)] text-[var(--amber-ink)]")}>
              {rel.statusLabel}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeviceListSection() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const currentToken = getDeviceToken();

  async function refresh() {
    setLoading(true);
    try {
      const list = await listDevicesFromSync();
      setDevices(list);
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[lyfos] device list failed:", err?.message ?? err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function rename(id) {
    const label = draftLabel.trim();
    if (!label) { setEditingId(null); return; }
    try {
      await renameDeviceFromSync(id, label);
      setEditingId(null);
      setDraftLabel("");
      await refresh();
    } catch {}
  }

  async function revoke(id) {
    if (!window.confirm("Sign this device out of your account? It can sign back in with the account password and the vault phrase.")) return;
    try {
      await revokeDeviceFromSync(id);
      await refresh();
    } catch {}
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between px-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Devices</p>
        {loading && <span className="text-[10px] text-[var(--ink-4)]">Loading…</span>}
      </div>
      <div className="mt-3 space-y-2">
        {devices.length === 0 && !loading && (
          <p className="px-3 text-[12px] text-[var(--ink-3)]">No other devices signed in.</p>
        )}
        {devices.map((d) => {
          const isCurrent = d.device_token === currentToken;
          const editing = editingId === d.id;
          return (
            <div key={d.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <input
                      autoFocus
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onBlur={() => rename(d.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") rename(d.id); if (e.key === "Escape") setEditingId(null); }}
                      className="w-full rounded-md border border-[var(--line-2)] px-2 py-1 text-[13px] outline-none focus:border-[var(--ink)]"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingId(d.id); setDraftLabel(d.label ?? ""); }}
                      className="text-left text-[13px] font-medium text-[var(--ink)] hover:underline"
                    >
                      {d.label || "Untitled device"}
                    </button>
                  )}
                  <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">
                    Last seen {formatRelativeTime(d.last_seen_at)}{isCurrent ? " · this device" : ""}
                  </p>
                </div>
                {!isCurrent && (
                  <button
                    onClick={() => revoke(d.id)}
                    className="shrink-0 text-[11px] font-medium text-[var(--red-2)] hover:underline"
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatRelativeTime(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

const ATTENTION_TONES = {
  urgent: { bar: "var(--red-2)", chip: "bg-[var(--red-soft)] text-[var(--red-2)]" },
  soon:   { bar: "var(--amber)", chip: "bg-[var(--amber-soft)] text-[var(--amber-ink)]" },
  info:   { bar: "var(--blue)",  chip: "bg-[var(--blue-soft)] text-[var(--blue)]" },
  ok:     { bar: "var(--green)", chip: "bg-[var(--green-soft)] text-[var(--green-ink)]" }
};

function NeedsALook({ items, onNavigate }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-14">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-base font-semibold text-[var(--ink)]">Complete your vault</h2>
        <span className="text-[12px] text-[var(--ink-3)]">A short path to a vault your family can actually use</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map((it) => {
          const tone = ATTENTION_TONES[it.tone] ?? ATTENTION_TONES.info;
          return (
            <button
              key={it.key}
              onClick={() => onNavigate(it.area === "release" ? "release" : "life")}
              className="group flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-[var(--line-2)]"
              style={{ borderLeft: `3px solid ${tone.bar}` }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-[var(--ink)]">{it.title}</div>
                <div className="mt-0.5 truncate text-[12.5px] text-[var(--ink-3)]">{it.sub}</div>
              </div>
              <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", tone.chip)}>{it.when}</span>
              <span className="shrink-0 text-[var(--ink-4)] transition group-hover:text-[var(--ink-2)]" aria-hidden>→</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function areaReadyLabel(area, records) {
  if (!records.length) return { label: "Missing", className: "bg-[var(--rose,#c0335e)]/8 text-[var(--rose,#c0335e)]" };
  if (records.some((record) => record.title && !recordHasContent(record))) return { label: "Needs detail", className: "bg-[var(--amber-soft)] text-[var(--amber-ink)]" };
  if (records.some((record) => !record.emergencyEligible)) return { label: "Private", className: "bg-[var(--surface-3)] text-[var(--ink-3)]" };
  return { label: "Ready", className: "bg-[var(--green-soft)] text-[var(--green-ink)]" };
}

function recordPreviewText(record) {
  return record.username || record.email || record.bankDetails || record.cardDetails || record.notes || typeLabel(record.type);
}

function VaultOverview({ vault, onOpenArea, onOpenRecord }) {
  const areas = AREAS.map((area) => {
    const records = (vault.items ?? [])
      .filter((item) => area.types.includes(item.type))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return { ...area, records, status: areaReadyLabel(area, records) };
  });
  const filled = areas.filter((area) => area.records.length).length;

  return (
    <section className="mt-0">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">Vault overview</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-[var(--ink)]">Your vault at a glance.</h2>
        </div>
        <p className="text-[12.5px] text-[var(--ink-3)]">{filled} of {AREAS.length} life areas have records.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((area) => {
          const tone = AREA_TONE[area.id] || "var(--ink-4)";
          const records = area.records.slice(0, 2);
          return (
            <article
              key={area.id}
              className="group rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-[var(--line-2)] hover:shadow-[0_14px_42px_rgba(0,0,0,0.06)]"
            >
              <button onClick={() => onOpenArea(area.id)} className="flex w-full items-start gap-3 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px]" style={{ background: "color-mix(in srgb, " + tone + " 13%, transparent)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area.id]} /></svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-[var(--ink)]">{area.label}</span>
                    <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", area.status.className)}>{area.status.label}</span>
                  </span>
                  <span className="mt-1 block truncate text-[12.5px] text-[var(--ink-3)]">{area.records.length ? `${area.records.length} record${area.records.length === 1 ? "" : "s"}` : area.promise}</span>
                </span>
                <span className="mt-1 text-[var(--ink-4)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink-2)]">→</span>
              </button>

              <div className="mt-3 space-y-2">
                {records.length ? records.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => onOpenRecord(record)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-transparent bg-[var(--surface-2)] px-3 py-2.5 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface)]"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{record.title || typeLabel(record.type)}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ink-4)]">{recordPreviewText(record)}</span>
                    </span>
                  </button>
                )) : (
                  <button onClick={() => onOpenArea(area.id)} className="w-full rounded-xl border border-dashed border-[var(--line-2)] px-3 py-3 text-left text-[12.5px] text-[var(--ink-3)] transition hover:border-[var(--accent)] hover:text-[var(--ink-2)]">
                    Add {area.suggested[0].toLowerCase()}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CheckInModal({ vault, series, attention, monthName, onNavigate, onClose }) {
  const [step, setStep] = useState(0);
  const last = series[series.length - 1];
  const prev = [...series].slice(0, -1).reverse().find((s) => !s.empty);
  const delta = prev ? last.net - prev.net : 0;
  const model = getLifeModel(vault);
  const holders = vault.releaseSettings.keyHolders.filter((h) => h.trim()).length;
  const nominee = vault.releaseSettings.mainNominee.trim();
  const bs = vault.balanceSheet ?? createEmptyBalanceSheet();

  const steps = [
    { title: `Your ${monthName} check-in`, hint: "Takes about two minutes" },
    { title: "Does your money still look right?", hint: "Step 1 of 3", primary: "Looks right" },
    { title: "Anything to handle this month?", hint: "Step 2 of 3", primary: "All reviewed" },
    { title: "Is your circle still right?", hint: "Step 3 of 3", primary: "Still good" },
    { title: `You're all set for ${monthName}`, hint: "Saved to your vault", primary: "Done" }
  ];
  const s = steps[step];

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 backdrop-blur-sm p-4 md:items-center" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_70px_rgba(0,0,0,0.3)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-[var(--line)] px-5 py-4">
          <h2 className="flex-1 text-[16px] font-semibold text-[var(--ink)]">{monthName} check-in</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-[var(--ink-3)] transition hover:text-[var(--ink)]">✕</button>
        </div>

        <div className="px-5 py-5">
          {step === 0 && (
            <>
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-[var(--green-soft)] text-xl">🗓️</div>
              <h3 className="text-[20px] font-semibold tracking-tight text-[var(--ink)]">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">A calm look to keep everything current. Here's where things stand.</p>
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-center">
                  <div className={cx("text-[18px] font-bold", delta >= 0 ? "text-[var(--green-ink)]" : "text-[var(--red-2)]")}>{delta >= 0 ? "▲" : "▼"}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--ink-3)]">net worth</div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-center">
                  <div className="text-[18px] font-bold text-[var(--ink)]">{vault.items.length}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--ink-3)]">records</div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-center">
                  <div className="text-[18px] font-bold text-[var(--ink)]">{attention.length}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--ink-3)]">to review</div>
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <p className="mb-3 text-[13px] text-[var(--ink-3)]">{s.title}</p>
              <div className="text-[26px] font-semibold tracking-tight text-[var(--ink)]">{formatINR(last.net)}</div>
              <div className="mb-3 text-[12.5px] text-[var(--ink-3)]">Net worth{prev ? ` · ${delta >= 0 ? "▲" : "▼"} ${formatINR(Math.abs(delta))} since ${shortMonthLabel(prev.month)}` : ""}</div>
              {bs.accounts.slice(0, 4).map((a, i) => (
                <div key={i} className={cx("flex justify-between py-2 text-[13.5px]", i > 0 && "border-t border-[var(--line)]")}>
                  <span className="text-[var(--ink-2)]">{a.label || a.name || "Account"}</span>
                </div>
              ))}
            </>
          )}
          {step === 2 && (
            <>
              <p className="mb-3 text-[13px] text-[var(--ink-3)]">{s.title}</p>
              {attention.length ? attention.slice(0, 4).map((it) => (
                <div key={it.key} className="mb-2 flex items-center gap-3 rounded-xl border border-[var(--line)] px-3.5 py-2.5">
                  <span className="flex-1 text-[13.5px] font-medium text-[var(--ink)]">{it.title}</span>
                  <span className="text-[12px] font-semibold text-[var(--ink-3)]">{it.when}</span>
                </div>
              )) : <div className="rounded-xl border border-dashed border-[var(--line-2)] p-6 text-center text-[13.5px] text-[var(--ink-3)]">Nothing needs attention. You're all clear.</div>}
            </>
          )}
          {step === 3 && (
            <>
              <p className="mb-3 text-[13px] text-[var(--ink-3)]">{s.title}</p>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex justify-between py-1.5 text-[13.5px]"><span className="text-[var(--ink-2)]">Nominee</span><span className="font-medium text-[var(--ink)]">{nominee ? nominee.split(/[-–]/)[0].trim() : "Not set"}</span></div>
                <div className="flex justify-between py-1.5 text-[13.5px]"><span className="text-[var(--ink-2)]">Trusted people</span><span className="font-medium text-[var(--ink)]">{holders} of 5</span></div>
                <div className="flex justify-between py-1.5 text-[13.5px]"><span className="text-[var(--ink-2)]">Areas protected</span><span className="font-medium text-[var(--ink)]">{model.protectedCount} of {model.areas.length}</span></div>
              </div>
            </>
          )}
          {step === 4 && (
            <div className="py-2 text-center">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--green-soft)] text-2xl">✓</div>
              <h3 className="text-[20px] font-semibold text-[var(--ink)]">{s.title}</h3>
              <p className="mt-2 text-[13.5px] text-[var(--ink-2)]">Everything's current and your family is covered. We'll nudge you again next month.</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--line)] px-5 py-3.5">
          <span className="text-[12.5px] text-[var(--ink-3)]">{s.hint}</span>
          <div className="ml-auto flex gap-2.5">
            {step === 1 && <button onClick={() => { onClose(); onNavigate("update"); }} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">Update balances</button>}
            <button onClick={() => step < steps.length - 1 ? setStep(step + 1) : onClose()} className="rounded-full bg-[var(--solid)] px-5 py-2 text-[13px] font-semibold text-[var(--on-solid)] transition hover:opacity-90">{step === 0 ? "Start" : s.primary}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BalanceSheetDashboard({ vault, onSave, onNavigate }) {
  const bs = vault.balanceSheet ?? createEmptyBalanceSheet();
  const summary = useMemo(() => getBalanceSheetSummary(bs), [bs]);
  const latest = [...(bs.snapshots ?? [])].sort((a, b) => String(a.month).localeCompare(String(b.month))).at(-1);
  const values = latest?.values ?? {};
  const [addingKind, setAddingKind] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("");

  function closeAdd() {
    setAddingKind(null);
    setDraftName("");
    setDraftValue("");
  }

  async function addQuickAccount() {
    const name = draftName.trim();
    const value = Number(draftValue.replace(/,/g, ""));
    if (!name || !Number.isFinite(value) || value < 0 || !addingKind) return;
    const id = `acc_${crypto.randomUUID().slice(0, 8)}`;
    const category = addingKind === "asset" ? "other_asset" : "other_debt";
    const nextValues = { ...values, [id]: value };
    const month = monthKey();
    const snapshots = (bs.snapshots ?? []).filter((snapshot) => snapshot.month !== month);
    const nextVault = {
      ...vault,
      balanceSheet: {
        ...bs,
        accounts: [...(bs.accounts ?? []), { id, category, kind: addingKind, name, createdAt: new Date().toISOString() }],
        snapshots: [...snapshots, { id: `snap_${crypto.randomUUID().slice(0, 8)}`, month, takenAt: new Date().toISOString(), values: nextValues }]
      }
    };
    await onSave(nextVault, "balance_sheet_quick_add");
    closeAdd();
  }

  const directionCopy = summary.direction === "positive"
    ? "Your assets are keeping ahead of your liabilities."
    : summary.direction === "watch"
      ? "Liabilities need a closer look this month."
      : "Add your first numbers to see your direction over time.";
  const accountsByKind = (kind) => (bs.accounts ?? []).filter((account) => account.kind === kind);

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--ink-3)]">Personal balance sheet</p><h1 className="mt-3 text-[36px] font-semibold leading-[1.08] tracking-tight text-[var(--ink)] md:text-[46px]">Know what you own and what you owe.</h1></div>
        <button onClick={() => onNavigate("update")} className="text-[13px] font-semibold text-[var(--green-ink)] hover:underline">Update this month <span aria-hidden="true">›</span></button>
      </header>

      <section className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7 md:p-9">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">Net worth</p>
        <div className="mt-3 text-[48px] font-semibold tracking-tight text-[var(--ink)] md:text-[62px]">{formatINR(summary.netWorth)}</div>
        <p className={cx("mt-3 text-[14px]", summary.direction === "watch" ? "text-[var(--amber-ink)]" : "text-[var(--ink-2)]")}>{directionCopy}</p>
        <div className="mt-8 grid gap-3 md:grid-cols-2"><div className="rounded-2xl bg-[var(--surface-2)] px-5 py-4"><div className="text-[12px] text-[var(--ink-3)]">Assets</div><div className="mt-1 text-[22px] font-semibold text-[var(--ink)]">{formatINR(summary.assets)}</div></div><div className="rounded-2xl bg-[var(--surface-2)] px-5 py-4"><div className="text-[12px] text-[var(--ink-3)]">Liabilities</div><div className="mt-1 text-[22px] font-semibold text-[var(--ink)]">{formatINR(summary.liabilities)}</div></div></div>
      </section>

      {addingKind && (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-5"><div className="flex items-center justify-between"><h2 className="text-[16px] font-semibold text-[var(--ink)]">Add {addingKind}</h2><button onClick={closeAdd} aria-label="Close" className="text-[var(--ink-3)] hover:text-[var(--ink)]">✕</button></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto]"><input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={addingKind === "asset" ? "e.g. HDFC savings" : "e.g. Home loan"} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[13px] outline-none focus:border-[var(--ink)]" /><input type="number" min="0" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} placeholder="Current value" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[13px] outline-none focus:border-[var(--ink)]" /><button onClick={addQuickAccount} disabled={!draftName.trim() || !draftValue} className="rounded-xl bg-[var(--solid)] px-5 py-3 text-[13px] font-semibold text-[var(--on-solid)] disabled:opacity-40">Add</button></div></div>
      )}

      <section><div className="mb-3 flex items-baseline justify-between"><h2 className="text-[16px] font-semibold text-[var(--ink)]">Your accounts</h2><span className="text-[12px] text-[var(--ink-3)]">{summary.accountCount} total</span></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold text-[var(--ink)]">Assets</h3><button onClick={() => setAddingKind("asset")} className="text-[12px] font-semibold text-[var(--green-ink)]">+ Add asset</button></div><div className="mt-3 divide-y divide-[var(--line)]">{accountsByKind("asset").length ? accountsByKind("asset").map((account) => <button key={account.id} onClick={() => onNavigate("update")} className="flex w-full items-center justify-between py-3 text-left"><span className="truncate pr-3 text-[13px] text-[var(--ink-2)]">{account.name}</span><span className="shrink-0 text-[13px] font-semibold text-[var(--ink)]">{formatINR(values[account.id] ?? 0)}</span></button>) : <p className="py-4 text-[13px] text-[var(--ink-3)]">Nothing added yet.</p>}</div></div><div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold text-[var(--ink)]">Liabilities</h3><button onClick={() => setAddingKind("liability")} className="text-[12px] font-semibold text-[var(--green-ink)]">+ Add liability</button></div><div className="mt-3 divide-y divide-[var(--line)]">{accountsByKind("liability").length ? accountsByKind("liability").map((account) => <button key={account.id} onClick={() => onNavigate("update")} className="flex w-full items-center justify-between py-3 text-left"><span className="truncate pr-3 text-[13px] text-[var(--ink-2)]">{account.name}</span><span className="shrink-0 text-[13px] font-semibold text-[var(--ink)]">{formatINR(values[account.id] ?? 0)}</span></button>) : <p className="py-4 text-[13px] text-[var(--ink-3)]">Nothing added yet.</p>}</div></div></div></section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5"><p className="max-w-md text-[12px] leading-5 text-[var(--ink-3)]">Lyfos shows your balance over time so you can notice direction without turning your family vault into a finance dashboard.</p><button onClick={() => onNavigate("setup")} className="text-[12px] font-semibold text-[var(--ink-2)] hover:underline">Manage categories <span aria-hidden="true">›</span></button></div>
    </section>
  );
}

function HomeScreen({ vault, onSave, onNavigate, backupHealth, onExport }) {
  const bs = vault.balanceSheet ?? createEmptyBalanceSheet();
  const attention = useMemo(() => deriveAttention(vault), [vault]);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const hasAccounts = bs.accounts.length > 0;
  const currentKey = monthKey();
  const currentSnap = snapshotForMonth(bs.snapshots, currentKey);
  const series = useMemo(() => buildMonthlySeries(bs, 12), [bs]);
  const reminder = useMemo(() => getBackupReminderCopy(backupHealth ?? {}), [backupHealth]);
  const showBackupNudge = reminder.level !== "none";

  if (!hasAccounts) {
    return (
      <>
        {showBackupNudge && <BackupNudge reminder={reminder} onExport={onExport} />}
        <EmptyHome onStartSetup={() => onNavigate("setup")} onEnterVault={() => onNavigate("life")} vault={vault} />
      </>
    );
  }

  const last = series[series.length - 1];
  const prev = [...series].slice(0, -1).reverse().find((s) => !s.empty);
  const delta = prev ? last.net - prev.net : 0;
  const pct = prev && prev.net !== 0 ? (delta / Math.abs(prev.net)) * 100 : 0;
  const needsUpdate = !currentSnap;

  return (
    <section className="mx-auto max-w-2xl">
      {showBackupNudge && <BackupNudge reminder={reminder} onExport={onExport} />}
      {checkinOpen && <CheckInModal vault={vault} series={series} attention={attention} monthName={monthLabel(currentKey).split(" ")[0]} onNavigate={onNavigate} onClose={() => setCheckinOpen(false)} />}

      {needsUpdate && (
        <button onClick={() => setCheckinOpen(true)} className="mb-8 flex w-full items-center gap-4 rounded-2xl border border-transparent bg-[var(--green-soft)] px-5 py-4 text-left transition hover:border-[var(--line)]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--green)] text-lg text-white">🗓️</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-[var(--ink)]">Your {monthLabel(currentKey).split(" ")[0]} check-in is ready</span>
            <span className="mt-0.5 block text-[12.5px] text-[var(--ink-2)]">A calm two-minute look to keep everything current.</span>
          </span>
          <span className="shrink-0 rounded-full bg-[var(--solid)] px-4 py-2 text-[13px] font-semibold text-[var(--on-solid)]">Start check-in</span>
        </button>
      )}

      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">{monthLabel(currentKey)}</p>
        <h1 className="mt-3 text-[64px] font-semibold leading-none tracking-tight text-[var(--ink)] md:text-[80px]">
          {formatINR(last.net)}
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-3)]">Net worth</p>

        <div className="mt-10">
          <NetWorthChart bs={bs} />
        </div>

        {prev && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-1.5 text-xs">
            <span className={cx("font-semibold", delta >= 0 ? "text-[var(--green-ink)]" : "text-[var(--red-2)]")}>
              {delta >= 0 ? "▲" : "▼"} {formatINR(Math.abs(delta))}
            </span>
            <span className="text-[var(--ink-3)]">{prev.month === series[series.length - 2]?.month ? "this month" : `since ${shortMonthLabel(prev.month)}`}</span>
            {Number.isFinite(pct) && pct !== 0 && (
              <span className="text-[var(--ink-3)]">· {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-14 space-y-3">
        <BreakdownRow label="Assets"      value={last.assets}      tone="default" />
        <BreakdownRow label="Liabilities" value={-last.liabilities} tone="muted" />
      </div>

      <NeedsALook items={attention} onNavigate={onNavigate} />

      {bs.goal && (
        <GoalCard
          goal={bs.goal}
          currentNet={last.net}
          firstSnapshotNet={series.find((s) => !s.empty)?.net ?? last.net}
        />
      )}

      <div className="mt-14 flex flex-col items-center gap-4">
        {needsUpdate ? (
          <button
            onClick={() => onNavigate("update")}
            className="rounded-full bg-[#1d1d1f] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black"
          >
            Update {monthLabel(currentKey).split(" ")[0]} numbers
          </button>
        ) : (
          <button
            onClick={() => onNavigate("update")}
            className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-6 py-2.5 text-xs font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]"
          >
            Revise {shortMonthLabel(currentKey)} numbers
          </button>
        )}
        {needsUpdate && (
          <p className="max-w-sm text-center text-xs text-[var(--ink-4)]">
            Five minutes once a month. Your sparkline keeps moving.
          </p>
        )}
      </div>

      <div className="mt-16">
        <CategoryBreakdown bs={bs} values={last === series[series.length - 1] && currentSnap ? currentSnap.values : (prev ? snapshotForMonth(bs.snapshots, prev.month)?.values : null) ?? {}} />
        <div className="mt-4 text-center">
          <button
            onClick={() => onNavigate("setup")}
            className="text-[12px] text-[var(--ink-3)] underline-offset-4 transition hover:text-[var(--ink)] hover:underline"
          >
            Manage accounts
          </button>
        </div>
      </div>

      <div className="mt-16 border-t border-[var(--line)] pt-6 text-center">
        <button
          onClick={() => onNavigate("life")}
          className="text-xs text-[var(--ink-3)] transition hover:text-[var(--ink)]"
        >
          Life Map · {vault.items.length} {vault.items.length === 1 ? "dossier" : "dossiers"} · sealed locally  →
        </button>
      </div>
    </section>
  );
}

function BackupNudge({ reminder, onExport }) {
  const tone = reminder.level === "failed" ? "danger" : "warn";
  return (
    <div className={cx(
      "mb-10 rounded-2xl border px-5 py-4",
      tone === "danger" ? "border-[#ff453a]/25 bg-[#ff453a]/6" : "border-[#c88719]/25 bg-[var(--amber-soft)]"
    )}>
      <div className="flex items-start gap-3">
        <span className={cx(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white",
          tone === "danger" ? "bg-[#b42318]" : "bg-[#c88719]"
        )}>!</span>
        <div className="flex-1">
          <p className={cx("text-[13px] font-semibold", tone === "danger" ? "text-[var(--red-ink)]" : "text-[var(--amber-ink)]")}>
            {reminder.title}
          </p>
          <p className={cx("mt-1 text-[12px] leading-5", tone === "danger" ? "text-[var(--red-ink)]/80" : "text-[var(--amber-ink)]/85")}>
            {reminder.body} Without a backup, clearing this browser's data will lose your vault.
          </p>
        </div>
        {onExport && reminder.primaryAction && (
          <button
            onClick={onExport}
            className={cx(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition",
              tone === "danger" ? "bg-[#b42318] text-white hover:bg-[#8e1612]" : "bg-[#1d1d1f] text-white hover:bg-black"
            )}
          >
            {reminder.primaryAction}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyHome({ onStartSetup, onEnterVault, vault }) {
  return (
    <section className="mx-auto max-w-xl py-12 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Welcome</p>
      <h1 className="mt-4 text-[44px] font-semibold leading-[1.05] tracking-tight md:text-[56px]">
        Your wealth, in one&nbsp;number.
      </h1>
      <p className="mx-auto mt-5 max-w-md text-[15px] leading-7 text-[var(--ink-2)]">
        Add your accounts once. Update them in five minutes each month.
        Watch the line move.
      </p>
      <button
        onClick={onStartSetup}
        className="mt-10 rounded-full bg-[#1d1d1f] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black"
      >
        Set up balance sheet
      </button>
      <div className="mt-12 border-t border-[var(--line)] pt-6">
        <button onClick={onEnterVault} className="text-xs text-[var(--ink-3)] transition hover:text-[var(--ink)]">
          or open the vault directly · {vault.items.length} {vault.items.length === 1 ? "dossier" : "dossiers"}  →
        </button>
      </div>
    </section>
  );
}

function GoalCard({ goal, currentNet, firstSnapshotNet }) {
  const progress = computeGoalProgress({ goal, currentNet, firstSnapshotNet });
  if (!progress) return null;
  const reached = currentNet >= progress.target;
  const daysLeft = progress.daysLeft;
  const dateLabel = goal.targetDate
    ? new Date(goal.targetDate).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "no deadline";

  return (
    <div className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Goal</p>
          <p className="mt-1 text-[14px] font-medium text-[var(--ink)]">
            {goal.label ? goal.label : `Reach ${formatINR(progress.target)}`}
            <span className="text-[var(--ink-3)]"> · {dateLabel}</span>
          </p>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-semibold tabular-nums text-[var(--ink)]">{progress.pct.toFixed(0)}%</div>
          {daysLeft !== null && (
            <div className={cx("text-[11px]", daysLeft < 0 ? "text-[var(--red-2)]" : "text-[var(--ink-3)]")}>
              {daysLeft < 0 ? `${Math.abs(daysLeft)} d past due` : daysLeft === 0 ? "due today" : `${daysLeft} d left`}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className={cx("h-full transition-all duration-500", reached ? "bg-[#0b6b3a]" : "bg-[#1d1d1f]")}
          style={{ width: `${progress.pct}%` }}
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between text-[11px] text-[var(--ink-3)]">
        <span>{formatINRCompact(currentNet)}</span>
        <span>{formatINRCompact(progress.target)}</span>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, tone }) {
  return (
    <div className={cx("flex items-baseline justify-between border-b border-[var(--line)] pb-3", tone === "muted" && "text-[var(--ink-2)]")}>
      <span className="text-[13px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">{label}</span>
      <span className="text-[22px] font-semibold tracking-tight tabular-nums text-[var(--ink)]">{formatINR(value)}</span>
    </div>
  );
}

function CategoryBreakdown({ bs, values }) {
  const [openCategoryId, setOpenCategoryId] = useState(null);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const cat of BALANCE_SHEET_CATEGORIES) map.set(cat.id, { cat, total: 0, count: 0 });
    for (const acc of bs.accounts) {
      const v = Number(values?.[acc.id] ?? 0) || 0;
      const slot = map.get(acc.category);
      if (slot) { slot.total += v; slot.count += 1; }
    }
    return [...map.values()].filter((g) => g.count > 0);
  }, [bs, values]);

  // Asset allocation: % of total assets per category
  const assetTotal = useMemo(
    () => grouped.filter((g) => g.cat.kind === "asset").reduce((s, g) => s + g.total, 0),
    [grouped]
  );

  if (grouped.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Breakdown</p>
      <div className="mt-4 space-y-1.5">
        {grouped.map((g) => {
          const pct = g.cat.kind === "asset" && assetTotal > 0 ? (g.total / assetTotal) * 100 : null;
          return (
            <button
              key={g.cat.id}
              onClick={() => setOpenCategoryId(g.cat.id)}
              className="group flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition hover:bg-[var(--surface)]"
            >
              <div className="flex items-center gap-3">
                <span className={cx("h-1.5 w-1.5 rounded-full", g.cat.kind === "liability" ? "bg-[#b42318]" : "bg-[#1d1d1f]")} />
                <span className="text-[14px] font-medium text-[var(--ink)]">{g.cat.label}</span>
                <span className="text-[12px] text-[var(--ink-4)]">{g.count}</span>
                {pct !== null && <span className="text-[11px] text-[var(--ink-4)]">· {pct.toFixed(0)}%</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={cx("text-[14px] font-semibold tabular-nums", g.cat.kind === "liability" ? "text-[var(--red-2)]" : "text-[var(--ink)]")}>
                  {g.cat.kind === "liability" ? "−" : ""}{formatINR(g.total).replace("−", "")}
                </span>
                <span className="text-[var(--ink-5)] opacity-0 transition group-hover:opacity-100">›</span>
              </div>
            </button>
          );
        })}
      </div>

      {assetTotal > 0 && <AllocationBar grouped={grouped} assetTotal={assetTotal} />}

      {openCategoryId && (
        <CategorySheet
          bs={bs}
          categoryId={openCategoryId}
          values={values}
          onClose={() => setOpenCategoryId(null)}
        />
      )}
    </div>
  );
}

function AllocationBar({ grouped, assetTotal }) {
  const assets = grouped.filter((g) => g.cat.kind === "asset" && g.total > 0);
  if (assets.length < 2) return null;

  // Distinct grayscale shades — one per category — for a calm visualisation.
  // No semantic colour because the colour itself doesn't carry meaning, just
  // separation. The numbers underneath are the actual signal.
  const tones = ["#1d1d1f", "#3a3a3c", "#6e6e73", "#86868b", "#a1a1a6", "#c7c7cc", "#d2d2d7"];

  return (
    <div className="mt-6">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full">
        {assets.map((g, i) => (
          <div
            key={g.cat.id}
            style={{
              width: `${(g.total / assetTotal) * 100}%`,
              background: tones[i % tones.length]
            }}
            title={`${g.cat.label} · ${((g.total / assetTotal) * 100).toFixed(0)}%`}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-4)]">Asset allocation</p>
    </div>
  );
}

function CategorySheet({ bs, categoryId, values, onClose }) {
  const cat = categoryById(categoryId);
  const accounts = bs.accounts.filter((a) => a.category === categoryId);
  const snaps = useMemo(
    () => [...(bs.snapshots ?? [])].sort((a, b) => a.month.localeCompare(b.month)),
    [bs.snapshots]
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[var(--surface-2)] p-6 shadow-[0_-12px_40px_rgba(0,0,0,0.12)] md:rounded-3xl md:p-8"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">{cat?.kind === "liability" ? "Liability" : "Asset"}</p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-tight">{cat?.label}</h2>
          </div>
          <button onClick={onClose} className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)]">Close</button>
        </div>

        <div className="mt-6 space-y-3">
          {accounts.length === 0 && (
            <p className="text-[13px] text-[var(--ink-3)]">No accounts in this category yet.</p>
          )}
          {accounts.map((acc) => (
            <AccountHistoryRow key={acc.id} account={acc} snaps={snaps} values={values} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountHistoryRow({ account, snaps, values }) {
  const current = Number(values?.[account.id] ?? 0) || 0;
  const history = snaps
    .map((s) => ({ month: s.month, value: Number(s.values?.[account.id] ?? 0) || 0 }))
    .filter((p) => p.value > 0);
  const first = history[0]?.value ?? 0;
  const last = history[history.length - 1]?.value ?? current;
  const totalDelta = first > 0 ? last - first : 0;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-[var(--ink)]">{account.name}</div>
          {history.length >= 2 && (
            <div className="mt-0.5 text-[11px] text-[var(--ink-3)]">
              {totalDelta >= 0 ? "▲" : "▼"} {formatINR(Math.abs(totalDelta))} since {shortMonthLabel(history[0].month)}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className={cx("text-[17px] font-semibold tabular-nums", account.kind === "liability" ? "text-[var(--red-2)]" : "text-[var(--ink)]")}>
            {account.kind === "liability" ? "−" : ""}{formatINR(current).replace("−", "")}
          </div>
        </div>
      </div>
      {history.length >= 2 && <MiniSparkline points={history.map((p) => p.value)} />}
    </div>
  );
}

function MiniSparkline({ points }) {
  if (!points || points.length < 2) return null;
  const W = 280, H = 32, P = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (W - P * 2) / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = P + i * step;
      const y = P + (H - P * 2) * (1 - (v - min) / range);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" preserveAspectRatio="none">
      <path d={path} style={{ stroke: "var(--ink)" }} strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CHART_RANGES = [
  { id: "12mo", label: "12mo", months: 12 },
  { id: "3yr",  label: "3yr",  months: 36 },
  { id: "all",  label: "All",  months: null }
];

function NetWorthChart({ bs }) {
  const [rangeId, setRangeId] = useState("12mo");
  const [hoverIdx, setHoverIdx] = useState(null);

  const series = useMemo(() => {
    if (rangeId === "all") {
      // Find earliest real snapshot; if none, fall back to 12 months.
      const snaps = bs?.snapshots ?? [];
      if (snaps.length === 0) return buildMonthlySeries(bs, 12);
      const earliest = [...snaps].sort((a, b) => a.month.localeCompare(b.month))[0].month;
      const [y, m] = earliest.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const now = new Date();
      const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
      return buildMonthlySeries(bs, Math.max(2, months));
    }
    const range = CHART_RANGES.find((r) => r.id === rangeId) ?? CHART_RANGES[0];
    return buildMonthlySeries(bs, range.months);
  }, [bs, rangeId]);

  const nonEmpty = series.filter((s) => !s.empty);
  if (nonEmpty.length < 2) {
    return <Sparkline series={series} />;
  }

  // Active point: hover if set, otherwise the latest.
  const activeIdx = hoverIdx ?? series.length - 1;
  const active = series[activeIdx];

  return (
    <div className="mx-auto w-full max-w-xl">
      <ChartSvg series={series} activeIdx={activeIdx} onHover={setHoverIdx} />

      <div className="mt-3 flex items-center justify-between">
        <div className="min-h-[28px]">
          {hoverIdx !== null && active && (
            <div className="text-[12px] leading-tight">
              <div className="font-semibold tabular-nums text-[var(--ink)]">{formatINR(active.net)}</div>
              <div className="text-[var(--ink-3)]">{monthLabel(active.month)}</div>
            </div>
          )}
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1">
          {CHART_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => { setRangeId(r.id); setHoverIdx(null); }}
              className={cx("rounded-full px-3 py-1 text-[11px] font-semibold transition", rangeId === r.id ? "bg-[#1d1d1f] text-white" : "text-[var(--ink-3)] hover:text-[var(--ink)]")}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartSvg({ series, activeIdx, onHover }) {
  const values = series.map((s) => s.net);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 520, H = 96, P = 6;
  const stepX = (W - P * 2) / (series.length - 1);
  const points = series.map((s, i) => {
    const x = P + i * stepX;
    const y = P + (H - P * 2) * (1 - (s.net - min) / range);
    return { x, y, ...s };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${points[points.length - 1].x.toFixed(1)} ${H - P} L ${P} ${H - P} Z`;
  const active = points[activeIdx];

  function move(clientX, target) {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    // Find closest point by x
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    onHover(best);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-none"
      preserveAspectRatio="none"
      onMouseMove={(e) => move(e.clientX, e.currentTarget)}
      onMouseLeave={() => onHover(null)}
      onTouchStart={(e) => move(e.touches[0].clientX, e.currentTarget)}
      onTouchMove={(e) => move(e.touches[0].clientX, e.currentTarget)}
      onTouchEnd={() => onHover(null)}
    >
      <defs>
        <linearGradient id="netchart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   style={{ stopColor: "var(--ink)" }} stopOpacity="0.10" />
          <stop offset="100%" style={{ stopColor: "var(--ink)" }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#netchart-fill)" />
      <path d={path} style={{ stroke: "var(--ink)" }} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* All dots — small, dim for carried-forward */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === activeIdx ? 3.5 : 1.4}
          style={{ fill: p.carried ? "var(--ink-5)" : "var(--ink)" }}
        />
      ))}

      {/* Vertical guide for active point */}
      {active && (
        <line x1={active.x} x2={active.x} y1={P} y2={H - P} style={{ stroke: "var(--ink)" }} strokeOpacity="0.15" strokeDasharray="2,3" />
      )}
    </svg>
  );
}

function Sparkline({ series }) {
  const nonEmpty = series.filter((s) => !s.empty);
  if (nonEmpty.length < 2) {
    return <div className="h-16 text-xs text-[var(--ink-4)]">A line will appear here after your second monthly update.</div>;
  }
  const values = series.map((s) => s.net);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 520, H = 64, P = 6;
  const stepX = (W - P * 2) / (series.length - 1);
  const points = series.map((s, i) => {
    const x = P + i * stepX;
    const y = P + (H - P * 2) * (1 - (s.net - min) / range);
    return { x, y, ...s };
  });
  const realPath = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const lastX = points[points.length - 1].x;
  const lastY = points[points.length - 1].y;
  const areaPath = `${realPath} L ${lastX} ${H - P} L ${P} ${H - P} Z`;

  return (
    <div className="mx-auto w-full max-w-xl">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--ink)" }} stopOpacity="0.10" />
            <stop offset="100%" style={{ stopColor: "var(--ink)" }} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-fill)" />
        <path d={realPath} style={{ stroke: "var(--ink)" }} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i}
            cx={p.x} cy={p.y}
            r={i === points.length - 1 ? 3 : (p.carried ? 1.2 : 1.8)}
            style={{ fill: i === points.length - 1 ? "var(--ink)" : (p.carried ? "var(--ink-5)" : "var(--ink)") }}
          />
        ))}
      </svg>
      <div className="mt-2 flex justify-between px-1 text-[10px] uppercase tracking-wider text-[var(--ink-5)]">
        <span>{shortMonthLabel(series[0].month)}</span>
        <span>{shortMonthLabel(series[Math.floor(series.length / 2)].month)}</span>
        <span>{shortMonthLabel(series[series.length - 1].month)}</span>
      </div>
    </div>
  );
}

// =====================================================================
// SETUP — first-time account configuration
// =====================================================================

function SetupScreen({ vault, onSave, onNavigate }) {
  const existing = vault.balanceSheet?.accounts ?? [];
  const isManageMode = existing.length > 0; // first-time setup vs ongoing edit
  const [accounts, setAccounts] = useState(existing.length > 0 ? existing : []);
  const [openCategory, setOpenCategory] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busy, setBusy] = useState(false);

  function addAccount(category) {
    if (!draftName.trim()) return;
    const cat = categoryById(category);
    if (!cat) return;
    setAccounts((prev) => [...prev, {
      id: `acc_${crypto.randomUUID().slice(0, 8)}`,
      category,
      kind: cat.kind,
      name: draftName.trim(),
      createdAt: new Date().toISOString()
    }]);
    setDraftName("");
  }

  function removeAccount(id) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    // If snapshots reference this account, warn the user. We don't strip
    // the historical values — they stay inside snapshots for audit — but
    // future totals stop counting this account.
    if (isManageMode && hasAnyHistory(vault, id)) {
      const ok = window.confirm(`Remove "${acc.name}"? Its past values stay in your monthly history but stop counting toward future net worth.`);
      if (!ok) return;
    }
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  function startRename(id, currentName) {
    setRenamingId(id);
    setRenameDraft(currentName);
  }

  function commitRename(id) {
    const name = renameDraft.trim();
    if (name) {
      setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, name } : a));
    }
    setRenamingId(null);
    setRenameDraft("");
  }

  async function finish() {
    if (accounts.length === 0) return;
    setBusy(true);
    const bs = vault.balanceSheet ?? createEmptyBalanceSheet();
    const nextVault = {
      ...vault,
      balanceSheet: { ...bs, accounts }
    };
    await onSave(nextVault, "balance_sheet_setup");
    setBusy(false);

    if (!isManageMode) {
      onNavigate("update"); // first-time setup → go straight to entering values
      return;
    }
    // Manage mode: if any newly-added accounts have no value for the current
    // month yet, route into update; otherwise back to home.
    const currentKey = monthKey();
    const currentSnap = snapshotForMonth(bs.snapshots, currentKey);
    const hasUnseen = accounts.some((a) => {
      const isNew = !existing.find((e) => e.id === a.id);
      return isNew && !(currentSnap?.values?.[a.id]);
    });
    onNavigate(hasUnseen ? "update" : "home");
  }

  const byCat = new Map();
  for (const cat of BALANCE_SHEET_CATEGORIES) byCat.set(cat.id, []);
  for (const acc of accounts) byCat.get(acc.category)?.push(acc);

  return (
    <section className="mx-auto max-w-xl">
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">
          {isManageMode ? "Manage accounts" : "Set up balance sheet"}
        </p>
        <h1 className="mt-4 text-[36px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
          {isManageMode ? "Rename, add, or remove." : "List what you own and what you owe."}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-6 text-[var(--ink-2)]">
          {isManageMode
            ? "Past monthly history stays attached to each account. Removed accounts stop counting from this month forward."
            : "Add an account name under each category. Values come next."}
        </p>
      </div>

      <div className="mt-12 space-y-2">
        {BALANCE_SHEET_CATEGORIES.map((cat) => {
          const list = byCat.get(cat.id) ?? [];
          const open = openCategory === cat.id;
          return (
            <div key={cat.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
              <button
                onClick={() => { setOpenCategory(open ? null : cat.id); setDraftName(""); }}
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className={cx("h-1.5 w-1.5 rounded-full", cat.kind === "liability" ? "bg-[#b42318]" : "bg-[#1d1d1f]")} />
                  <div>
                    <div className="text-[14px] font-semibold text-[var(--ink)]">{cat.label}</div>
                    <div className="text-[11px] text-[var(--ink-4)]">{cat.hint}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {list.length > 0 && <span className="text-[12px] font-semibold text-[var(--ink)]">{list.length}</span>}
                  <span className={cx("text-[var(--ink-5)] transition", open && "rotate-90")}>›</span>
                </div>
              </button>
              {open && (
                <div className="border-t border-[var(--line)] px-5 py-4">
                  {list.length > 0 && (
                    <div className="mb-3 space-y-1.5">
                      {list.map((acc) => (
                        <div key={acc.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[13px]">
                          {renamingId === acc.id ? (
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onBlur={() => commitRename(acc.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename(acc.id);
                                if (e.key === "Escape") { setRenamingId(null); setRenameDraft(""); }
                              }}
                              className="flex-1 rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1 text-[13px] outline-none focus:border-[var(--ink)]"
                            />
                          ) : (
                            <button
                              onClick={() => startRename(acc.id, acc.name)}
                              className="flex-1 truncate text-left hover:underline"
                              title="Click to rename"
                            >
                              {acc.name}
                            </button>
                          )}
                          <button onClick={() => removeAccount(acc.id)} className="shrink-0 text-[11px] text-[var(--ink-4)] hover:text-[var(--red-2)]">remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      autoFocus={list.length === 0}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAccount(cat.id); } }}
                      placeholder={cat.id === "cash" ? "HDFC savings" : cat.id === "investments" ? "Equity mutual funds" : "Account name"}
                      className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink)]"
                    />
                    <button onClick={() => addAccount(cat.id)} className="rounded-lg bg-[#1d1d1f] px-4 text-[12px] font-semibold text-white">Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-12 flex flex-col items-center gap-3">
        <button
          onClick={finish}
          disabled={accounts.length === 0 || busy}
          className="rounded-full bg-[#1d1d1f] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-30"
        >
          {accounts.length === 0
            ? "Add at least one account"
            : busy
              ? "Saving…"
              : isManageMode
                ? `Save · ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`
                : `Continue · ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
        </button>
        <button onClick={() => onNavigate("home")} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">Cancel</button>
      </div>
    </section>
  );
}

// =====================================================================
// UPDATE — guided monthly entry, one account per step
// =====================================================================

function UpdateScreen({ vault, onSave, onNavigate }) {
  const bs = vault.balanceSheet ?? createEmptyBalanceSheet();
  const accounts = bs.accounts;
  const key = monthKey();
  const existing = snapshotForMonth(bs.snapshots, key);
  const sortedSnaps = [...(bs.snapshots ?? [])].sort((a, b) => b.month.localeCompare(a.month));
  const previousSnap = existing ? sortedSnaps.find((s) => s.month < key) : sortedSnaps[0];

  const [values, setValues] = useState(() => {
    const seed = {};
    for (const acc of accounts) {
      const prev = existing?.values?.[acc.id] ?? previousSnap?.values?.[acc.id] ?? 0;
      seed[acc.id] = String(prev || "");
    }
    return seed;
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // Default to bulk when there's an existing snapshot (revising), since the
  // user has been here before. Guided for first-time-this-month entries.
  const [mode, setMode] = useState(existing ? "bulk" : "guided");

  if (accounts.length === 0) {
    return (
      <section className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-[var(--ink-2)]">Set up your accounts first.</p>
        <button onClick={() => onNavigate("setup")} className="mt-6 rounded-full bg-[#1d1d1f] px-6 py-3 text-sm font-semibold text-white">Set up balance sheet</button>
      </section>
    );
  }

  const acc = accounts[stepIndex];
  const prevValue = previousSnap?.values?.[acc.id] ?? 0;
  const cat = categoryById(acc.category);
  const isLast = stepIndex === accounts.length - 1;
  const numericValues = useMemo(() => {
    const out = {};
    for (const a of accounts) out[a.id] = Number(values[a.id]) || 0;
    return out;
  }, [values, accounts]);
  const previewTotals = netWorthFromValues(accounts, numericValues);

  function setCurrent(v) {
    setValues((prev) => ({ ...prev, [acc.id]: v }));
  }

  function next() {
    if (isLast) {
      commit();
    } else {
      setStepIndex((i) => Math.min(accounts.length - 1, i + 1));
    }
  }

  function back() {
    if (stepIndex === 0) {
      onNavigate("home");
    } else {
      setStepIndex((i) => Math.max(0, i - 1));
    }
  }

  async function commit() {
    setBusy(true);
    const finalValues = {};
    for (const a of accounts) finalValues[a.id] = Number(values[a.id]) || 0;
    const otherSnaps = (bs.snapshots ?? []).filter((s) => s.month !== key);
    const snapshot = {
      id: existing?.id ?? crypto.randomUUID(),
      month: key,
      takenAt: new Date().toISOString(),
      values: finalValues
    };
    const nextVault = {
      ...vault,
      balanceSheet: { ...bs, snapshots: [...otherSnaps, snapshot] }
    };
    await onSave(nextVault, "balance_sheet_updated");
    setBusy(false);
    setDone(true);
  }

  if (done) {
    const series = buildMonthlySeries({ ...bs, snapshots: (bs.snapshots ?? []).filter((s) => s.month !== key).concat([{ id: "preview", month: key, takenAt: new Date().toISOString(), values: numericValues }]) }, 12);
    const last = series[series.length - 1];
    const prev = [...series].slice(0, -1).reverse().find((s) => !s.empty);
    const delta = prev ? last.net - prev.net : 0;
    return (
      <section className="mx-auto max-w-xl py-12 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">{monthLabel(key)} · saved</p>
        <h1 className="mt-4 text-[44px] font-semibold leading-none tracking-tight md:text-[56px]">
          {delta >= 0 ? "+" : "−"}{formatINR(Math.abs(delta))}
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-3)]">{delta >= 0 ? "Net worth up this month" : "Net worth down this month"}</p>
        <div className="mt-10"><Sparkline series={series} /></div>
        <p className="mt-8 text-[15px] tracking-tight text-[var(--ink)]">New net worth · <span className="font-semibold">{formatINR(last.net)}</span></p>
        <button onClick={() => onNavigate("home")} className="mt-10 rounded-full bg-[#1d1d1f] px-7 py-3 text-sm font-semibold text-white">Done</button>
      </section>
    );
  }

  if (mode === "bulk") {
    return (
      <BulkUpdateView
        accounts={accounts}
        values={values}
        setValues={setValues}
        previousSnap={previousSnap}
        existing={existing}
        previewTotals={previewTotals}
        monthKeyValue={key}
        busy={busy}
        onCommit={commit}
        onSwitchToGuided={() => setMode("guided")}
        onCancel={() => onNavigate("home")}
      />
    );
  }

  return (
    <section className="mx-auto max-w-md py-6">
      <div className="mb-10 flex items-center justify-between">
        <button onClick={back} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">‹ {stepIndex === 0 ? "Home" : "Back"}</button>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">{stepIndex + 1} / {accounts.length}</span>
        <div className="flex items-center gap-3">
          <button onClick={() => setMode("bulk")} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">Bulk</button>
          <button onClick={() => onNavigate("home")} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">Cancel</button>
        </div>
      </div>

      <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full bg-[#1d1d1f] transition-all duration-300" style={{ width: `${((stepIndex + 1) / accounts.length) * 100}%` }} />
      </div>

      <div className="mt-14 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">{cat?.label ?? ""}</p>
        <h2 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight">{acc.name}</h2>
        <p className="mt-3 text-[13px] text-[var(--ink-4)]">
          {prevValue > 0 ? `Last month · ${formatINR(prevValue)}` : "First entry"}
        </p>

        <div className="mt-12">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-[36px] font-semibold text-[var(--ink-5)]">₹</span>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={values[acc.id]}
              onChange={(e) => setCurrent(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }}
              placeholder="0"
              className="w-full max-w-xs bg-transparent text-center text-[56px] font-semibold leading-none tracking-tight tabular-nums text-[var(--ink)] outline-none placeholder:text-[#e5e5ea]"
            />
          </div>
          {prevValue > 0 && Number(values[acc.id]) > 0 && (
            <p className="mt-4 text-[12px] text-[var(--ink-3)]">
              {(() => {
                const d = Number(values[acc.id]) - prevValue;
                if (d === 0) return "No change";
                return `${d > 0 ? "▲" : "▼"} ${formatINR(Math.abs(d))} vs last month`;
              })()}
            </p>
          )}
        </div>
      </div>

      <div className="mt-16 flex flex-col items-center gap-3">
        <button
          onClick={next}
          disabled={busy}
          className="rounded-full bg-[#1d1d1f] px-10 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:opacity-50"
        >
          {isLast ? (busy ? "Saving…" : "Save month") : "Next"}
        </button>
        <button
          onClick={() => { setCurrent(String(prevValue)); next(); }}
          className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          Same as last month
        </button>
      </div>

      <div className="mt-16 border-t border-[var(--line)] pt-5 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">Running total</p>
        <p className="mt-2 text-[20px] font-semibold tabular-nums tracking-tight">{formatINR(previewTotals.net)}</p>
      </div>
    </section>
  );
}

function BulkUpdateView({
  accounts,
  values,
  setValues,
  previousSnap,
  existing,
  previewTotals,
  monthKeyValue,
  busy,
  onCommit,
  onSwitchToGuided,
  onCancel
}) {
  // Group accounts by category for the read-down ordering. Skipped accounts
  // (no value in this month and none last month) render with placeholder.
  const byCat = useMemo(() => {
    const groups = new Map();
    for (const cat of BALANCE_SHEET_CATEGORIES) groups.set(cat.id, []);
    for (const acc of accounts) groups.get(acc.category)?.push(acc);
    return groups;
  }, [accounts]);

  const monthLabelText = monthLabel(monthKeyValue);
  const totalDelta = previousSnap
    ? previewTotals.net - netWorthFromValues(accounts, previousSnap.values).net
    : 0;

  function set(id, raw) {
    setValues((prev) => ({ ...prev, [id]: raw.replace(/[^0-9]/g, "") }));
  }
  function copyLast(id) {
    const prev = previousSnap?.values?.[id] ?? 0;
    set(id, String(prev || 0));
  }

  return (
    <section className="mx-auto max-w-2xl pb-32">
      <div className="mb-8 flex items-center justify-between">
        <button onClick={onCancel} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Home</button>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">{monthLabelText}</span>
        <button onClick={onSwitchToGuided} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)]">Guided</button>
      </div>

      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">{existing ? "Revise" : "Update"} all numbers</p>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight md:text-[36px]">{monthLabelText}</h1>
      </div>

      <div className="mt-10 space-y-6">
        {BALANCE_SHEET_CATEGORIES.map((cat) => {
          const list = byCat.get(cat.id) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={cat.id}>
              <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{cat.label}</p>
              <div className="mt-2 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
                {list.map((acc) => {
                  const prev = previousSnap?.values?.[acc.id] ?? 0;
                  const current = Number(values[acc.id]) || 0;
                  const delta = current - prev;
                  return (
                    <div key={acc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-[var(--ink)]">{acc.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
                          {prev > 0 ? <span>Last · {formatINR(prev)}</span> : <span className="text-[var(--ink-4)]">No prior value</span>}
                          {prev > 0 && (
                            <button onClick={() => copyLast(acc.id)} className="text-[var(--ink-3)] underline-offset-2 hover:text-[var(--ink)] hover:underline">
                              same
                            </button>
                          )}
                          {prev > 0 && current > 0 && delta !== 0 && (
                            <span className={delta > 0 ? "text-[var(--green-ink)]" : "text-[var(--red-2)]"}>
                              {delta > 0 ? "▲" : "▼"} {formatINRCompact(Math.abs(delta))}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[13px] text-[var(--ink-5)]">₹</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={values[acc.id] ?? ""}
                          onChange={(e) => set(acc.id, e.target.value)}
                          placeholder="0"
                          className={cx(
                            "w-32 rounded-md border border-transparent bg-[var(--surface-2)] px-2 py-1.5 text-right text-[15px] tabular-nums outline-none focus:border-[var(--ink)] focus:bg-[var(--surface)]",
                            acc.kind === "liability" ? "text-[var(--red-2)]" : "text-[var(--ink)]"
                          )}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky save bar at the bottom */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface-2)]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-5 py-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Net worth</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[20px] font-semibold tabular-nums tracking-tight">{formatINR(previewTotals.net)}</span>
              {previousSnap && totalDelta !== 0 && (
                <span className={cx("text-[12px] font-medium", totalDelta > 0 ? "text-[var(--green-ink)]" : "text-[var(--red-2)]")}>
                  {totalDelta > 0 ? "▲" : "▼"} {formatINRCompact(Math.abs(totalDelta))}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onCommit}
            disabled={busy}
            className="rounded-full bg-[#1d1d1f] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition hover:bg-black disabled:opacity-50"
          >
            {busy ? "Saving…" : (existing ? "Save changes" : "Save month")}
          </button>
        </div>
      </div>
    </section>
  );
}

function BackupSizeNotice({ warning }) {
  const strong = warning.level === "strong";
  return (
    <div className={cx(
      "mb-5 rounded-3xl border px-5 py-4 text-sm font-semibold",
      strong
        ? "border-[#c68a19]/25 bg-[var(--amber-soft)] text-[var(--amber-ink)]"
        : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
    )}>
      {warning.copy}
    </div>
  );
}

function CategoryWorkspace({ vault, area, initialRecordId, onSave, onCapture, onClose, entitlements, onOpenSettings, runWithRecentAuth }) {
  const [mode, setMode] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");

  const records = vault.items.filter((item) => area.types.includes(item.type));
  const filteredRecords = records.filter((item) => {
    const status = releaseLabel(item);
    const searchable = `${item.title} ${item.username} ${item.notes} ${item.bankDetails} ${item.email} ${item.cardDetails}`.toLowerCase();
    const matchesQuery = searchable.includes(query.toLowerCase());
    const matchesFilter = filter === "all" || status === filter;
    return matchesQuery && matchesFilter;
  });
  const selectedRecord = selectedId ? (records.find((item) => item.id === selectedId) ?? null) : null;

  useEffect(() => {
    setMode(initialRecordId ? "detail" : "overview");
    setSelectedId(initialRecordId ?? null);
    setEditingRecord(null);
    setQuery("");
    setFilter("all");
    setMessage("");
  }, [area.id, initialRecordId]);

  function startCreate() {
    setEditingRecord(createBlankRecord(area));
    setMode("edit");
  }

  function startEdit(record) {
    setEditingRecord(record);
    setMode("edit");
  }

  async function saveRecord(record, auditEvent, changeReason = "record_change") {
    const now = new Date().toISOString();
    const exists = vault.items.some((item) => item.id === record.id);

    // Free-tier gate: enforce the vault item cap on CREATE only. Edits
    // to existing items always succeed so a downgraded user isn't
    // trapped above the cap.
    if (!exists && entitlements && Number.isFinite(entitlements.vaultItemLimit)
        && vault.items.length >= entitlements.vaultItemLimit) {
      setMessage(`You're on the ${entitlements.label} plan (${entitlements.vaultItemLimit}-item limit). Upgrade to keep adding records.`);
      return;
    }

    const nextRecord = {
      ...record,
      id: record.id || crypto.randomUUID(),
      updatedAt: now,
      createdAt: record.createdAt || now
    };
    const eventName = auditEvent ?? `${exists ? "Record updated" : "Record created"}`;
    await onSave(appendAuditEvent({
      ...vault,
      items: exists
        ? vault.items.map((item) => item.id === nextRecord.id ? nextRecord : item)
        : [nextRecord, ...vault.items]
    }, eventName), changeReason);
    setSelectedId(nextRecord.id);
    setMode("detail");
    setMessage(exists ? "Record updated." : "Record created.");
  }

  async function deleteRecord(record) {
    const ok = window.confirm(`Delete "${record.title}" from this local encrypted vault?`);
    if (!ok) return;
    const now = new Date().toISOString();
    await onSave(appendAuditEvent({
      ...vault,
      items: vault.items.filter((item) => item.id !== record.id)
    }, "Record deleted"), "record_change");
    setSelectedId(null);
    setMode("overview");
    setMessage("Record deleted.");
  }

  async function attachToRecord(record, files) {
    const attachments = await readFilesAsAttachments(files, record.attachments ?? []);
    await saveRecord({ ...record, attachments: [...attachments, ...(record.attachments ?? [])] }, "Attachment added", "attachment_change");
  }

  async function deleteRecordAttachment(record, attachment) {
    await saveRecord(deleteAttachmentFromRecord(record, attachment.id), "Attachment deleted", "attachment_change");
  }

  async function replaceRecordAttachment(record, attachment, files) {
    const file = files?.[0];
    if (!file) return;
    const replacement = await readFileAsAttachment(file, (record.attachments ?? []).filter((item) => item.id !== attachment.id).map((item) => item.name));
    await saveRecord(replaceAttachmentOnRecord(record, attachment.id, replacement), "Attachment replaced", "attachment_change");
  }

  async function auditOnly(event) {
    await onSave(appendAuditEvent(vault, event), null);
  }

  const drawerOpen = mode === "edit" || (mode === "detail" && Boolean(selectedRecord));
  function closeDrawer() { setMode("overview"); setSelectedId(null); setEditingRecord(null); }
  const areaTint = "color-mix(in srgb, " + (AREA_TONE[area.id] || "var(--ink-4)") + " 14%, transparent)";
  const areaStroke = AREA_TONE[area.id] || "var(--ink-3)";

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: areaTint }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={areaStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area.id]} /></svg>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold tracking-tight text-[var(--ink)]">{area.label}</h1>
          <p className="mt-0.5 text-[13.5px] text-[var(--ink-3)]">{records.length} record{records.length === 1 ? "" : "s"} · {area.description}</p>
        </div>
        <button onClick={startCreate} className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[var(--accent-hover)]">Add to this area</button>
      </div>

      {message && <div className="mb-5 rounded-2xl border border-[#34c759]/20 bg-[#34c759]/10 px-4 py-3 text-sm font-semibold text-[var(--green-ink)]">{message}</div>}

      {records.length ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          {records.map((rec, i) => (
            <button key={rec.id} onClick={() => { setSelectedId(rec.id); setMode("detail"); }} className={cx("flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]", i > 0 && "border-t border-[var(--line)]")}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]" style={{ background: areaTint }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={areaStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area.id]} /></svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-[var(--ink)]">{rec.title || typeLabel(rec.type)}</span>
                <span className="block truncate text-[12.5px] text-[var(--ink-3)]">{(rec.username || rec.bankDetails || rec.email || typeLabel(rec.type))} · {releaseLabel(rec)}</span>
              </span>
              <span className="shrink-0 text-[12px] text-[var(--ink-4)]">{timeAgo(rec.updatedAt)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-12 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: areaTint }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={areaStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area.id]} /></svg>
          </div>
          <h3 className="text-[17px] font-semibold text-[var(--ink)]">Nothing here yet</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-[var(--ink-3)]">Anything you add to {area.label} will appear here — encrypted, and ready for your family when it's needed.</p>
          <button onClick={startCreate} className="mt-5 rounded-full bg-[var(--accent)] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[var(--accent-hover)]">Add to {area.label}</button>
        </div>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeDrawer} />
          <aside className="absolute right-0 top-0 h-full w-[460px] max-w-[94vw] overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] shadow-[-24px_0_60px_rgba(0,0,0,0.18)]">
            {mode === "edit" ? (
              <RecordEditorDrawer area={area} record={editingRecord} onCancel={closeDrawer} onSave={saveRecord} />
            ) : (
              <RecordDetailPanel
                record={selectedRecord}
                area={area}
                runWithRecentAuth={runWithRecentAuth}
                onClose={closeDrawer}
                onEdit={() => startEdit(selectedRecord)}
                onDelete={() => deleteRecord(selectedRecord)}
                onAttach={(files) => attachToRecord(selectedRecord, files)}
                onAttachmentDelete={(attachment) => deleteRecordAttachment(selectedRecord, attachment)}
                onAttachmentReplace={(attachment, files) => replaceRecordAttachment(selectedRecord, attachment, files)}
                onReveal={() => auditOnly("Sensitive value revealed")}
                onHide={() => auditOnly("Sensitive value hidden")}
                onExtract={async (text) => {
                  const draft = analyzeMessyInput(text);
                  await saveRecord({
                    ...selectedRecord,
                    username: selectedRecord.username || draft.username,
                    secret: selectedRecord.secret || draft.secret,
                    bankDetails: selectedRecord.bankDetails || draft.bankDetails,
                    notes: `${selectedRecord.notes || ""}\n\nExtracted from attachment:\n${draft.bankDetails}`.trim()
                  }, "Attachment extraction reviewed");
                }}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function RecordDetailPanel({ record, area, onClose, onEdit, onDelete, onAttach, onAttachmentDelete, onAttachmentReplace, onReveal, onHide, onExtract, runWithRecentAuth }) {
  const [revealed, setRevealed] = useState(false);
  const emergency = record.emergencyEligible;
  const fields = [
    ["Identifier / account", record.username],
    ["Email", record.email],
    ["Financial value", record.financial?.value ? formatINR(Number(record.financial.value)) : ""]
  ].filter(([, v]) => v && String(v).trim());
  // Masked like the secret field already was — bank/card details used to
  // render unmasked always (assessment DL-02). Same reveal gate for all
  // three now, behind a fresh passphrase check.
  const sensitiveFields = [
    ["Sensitive value", record.secret],
    ["Bank details", record.bankDetails],
    ["Card details", record.cardDetails]
  ].filter(([, v]) => v && String(v).trim());
  const stroke = AREA_TONE[area?.id] || "var(--ink-3)";
  const tint = "color-mix(in srgb, " + stroke + " 14%, transparent)";

  function toggleReveal() {
    if (revealed) { setRevealed(false); onHide?.(); return; }
    const show = () => { setRevealed(true); onReveal?.(); };
    if (runWithRecentAuth) runWithRecentAuth(show); else show();
  }

  function handleDelete() {
    if (runWithRecentAuth) runWithRecentAuth(onDelete); else onDelete();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] text-[var(--ink-2)] transition hover:text-[var(--ink)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
        </button>
        <span className="flex-1" />
        <button onClick={onEdit} aria-label="Edit" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] text-[var(--ink-2)] transition hover:text-[var(--ink)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20 h4 L18 10 l-4 -4 L4 16 Z" /><path d="M13.5 6.5 l4 4" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="flex items-center gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[13px]" style={{ background: tint }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={AREA_ICON[area?.id]} /></svg>
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[19px] font-semibold text-[var(--ink)]">{record.title || typeLabel(record.type)}</h2>
            <div className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">Updated {record.updatedAt ? new Date(record.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</div>
            <span className="mt-1.5 inline-block rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ink-2)]">{area?.label ?? typeLabel(record.type)}</span>
          </div>
        </div>

        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Details</div>
        <div className="mt-2.5 overflow-hidden rounded-xl border border-[var(--line)]">
          {fields.map(([k, v], i) => (
            <div key={k} className={cx("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-[var(--line)]")}>
              <span className="w-32 shrink-0 text-[13px] text-[var(--ink-3)]">{k}</span>
              <span className="flex-1 break-words text-[13.5px] font-medium text-[var(--ink)]">{v}</span>
            </div>
          ))}
          {sensitiveFields.length > 0 && (
            <div className={cx("flex items-center justify-between gap-4 px-4 py-2.5", fields.length > 0 && "border-t border-[var(--line)]")}>
              <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ink-4)]">Sensitive</span>
              <button onClick={toggleReveal} className="shrink-0 text-[12px] font-semibold text-[var(--accent)]">{revealed ? "Hide" : "Reveal"}</button>
            </div>
          )}
          {sensitiveFields.map(([k, v]) => (
            <div key={k} className="flex items-center gap-4 border-t border-[var(--line)] px-4 py-3">
              <span className="w-32 shrink-0 text-[13px] text-[var(--ink-3)]">{k}</span>
              <span className="flex-1 break-all text-[13.5px] font-medium text-[var(--ink)]">{revealed ? v : maskSecret(v)}</span>
            </div>
          ))}
          {fields.length === 0 && sensitiveFields.length === 0 && (
            <div className="px-4 py-3 text-[13px] text-[var(--ink-3)]">No details added yet.</div>
          )}
        </div>

        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Who can access this</div>
        <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", emergency ? "bg-[var(--green-soft)]" : "bg-[var(--surface-3)]")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={emergency ? "var(--accent)" : "var(--ink-3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L20 6 V12 C 20 17 16 20 12 21 C 8 20 4 17 4 12 V6 Z" />{emergency && <path d="M9 12 l2 2 l4 -4" />}</svg>
          </span>
          <div>
            <div className="text-[13.5px] font-semibold text-[var(--ink)]">{emergency ? "Part of your release plan" : "Private to you"}</div>
            <div className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">{emergency ? "Your circle of trust can recover this for your family." : "Not included in your release plan. Only you can see this."}</div>
          </div>
        </div>

        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">History</div>
        <div className="mt-2.5 overflow-hidden rounded-xl border border-[var(--line)]">
          <div className="flex items-center gap-3 px-4 py-3 text-[13.5px]"><span className="h-2 w-2 rounded-full bg-[var(--green)]" /><span className="flex-1 text-[var(--ink-2)]">Last updated</span><span className="text-[var(--ink-4)]">{record.updatedAt ? new Date(record.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
          <div className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-3 text-[13.5px]"><span className="h-2 w-2 rounded-full bg-[var(--ink-4)]" /><span className="flex-1 text-[var(--ink-2)]">Added to your vault</span><span className="text-[var(--ink-4)]">{record.createdAt ? new Date(record.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
        </div>

        {(record.attachments?.length ?? 0) > 0 && (
          <>
            <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Attachments</div>
            <div className="mt-2.5"><AttachmentGrid attachments={record.attachments ?? []} onDelete={onAttachmentDelete} onReplace={onAttachmentReplace} onExtract={onExtract} tone="light" /></div>
          </>
        )}
      </div>

      <div className="flex gap-3 border-t border-[var(--line)] px-4 py-3.5">
        <button onClick={onEdit} className="flex-1 rounded-xl border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">Edit</button>
        <button onClick={handleDelete} className="rounded-xl border border-[var(--red-2)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--red-2)] transition hover:bg-[var(--red-soft)]">Delete</button>
      </div>
    </div>
  );
}

function maskSecret(value) {
  if (!value) return "Not added";
  return "•••• •••• ••••";
}

function primaryDetailPlaceholder(type, area) {
  if (["password", "pin", "email_account"].includes(type)) return "Email, login, or device";
  if (type === "bank_account") return "Account number or customer ID";
  if (type === "card") return "Card ending or card name";
  if (type === "insurance_policy") return "Policy number";
  if (type === "identity_document") return "Document number";
  if (type === "emergency_instruction") return "Person, place, or first action";
  return `${area?.label ?? "Record"} detail`;
}

function hasMoreRecordDetails(record) {
  return [
    record?.secret,
    record?.notes,
    record?.bankDetails,
    record?.cardDetails,
    record?.email,
    record?.financial?.value,
    record?.financial?.liability
  ].some((value) => String(value ?? "").trim()) || (record?.attachments?.length ?? 0) > 0 || record?.emergencyEligible === false;
}

function RecordEditorDrawer({ area, record, onCancel, onSave }) {
  const [draft, setDraft] = useState(record ?? createBlankRecord(area));
  const [showMore, setShowMore] = useState(() => hasMoreRecordDetails(record));
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("green");

  function handleSave() {
    const title = draft.title.trim();
    const hasSubstance = [
      draft.username,
      draft.secret,
      draft.notes,
      draft.bankDetails,
      draft.cardDetails,
      draft.email,
      draft.financial?.value,
      draft.financial?.liability
    ].some((value) => String(value ?? "").trim()) || (draft.attachments?.length ?? 0) > 0;

    if (!title) {
      setMessageTone("red");
      setMessage("Name the record before saving. A blank dossier damages trust during recovery.");
      return;
    }

    if (!hasSubstance) {
      setMessageTone("red");
      setMessage("Add at least one identifier, secret, note, financial value, or proof file before saving.");
      return;
    }

    onSave({ ...draft, title }, undefined, draft.attachments?.length ? "attachment_change" : "record_change");
  }

  async function uploadFiles(files) {
    const attachments = await readFilesAsAttachments(files, draft.attachments ?? []);
    setDraft((current) => ({ ...current, attachments: [...attachments, ...(current.attachments ?? [])] }));
  }

  function deleteDraftAttachment(attachment) {
    setDraft((current) => deleteAttachmentFromRecord(current, attachment.id));
  }

  async function replaceDraftAttachment(attachment, files) {
    const file = files?.[0];
    if (!file) return;
    const replacement = await readFileAsAttachment(file, (draft.attachments ?? []).filter((item) => item.id !== attachment.id).map((item) => item.name));
    setDraft((current) => replaceAttachmentOnRecord(current, attachment.id, replacement));
  }

  async function extractFromScreenshot(file) {
    if (!file?.type?.startsWith("image/")) {
      setMessage("Choose a screenshot or image for extraction.");
      return;
    }
    setMessageTone("green");
    setMessage("Reading screenshot locally...");
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const result = await worker.recognize(file);
    await worker.terminate();
    const extracted = analyzeMessyInput(result.data.text || "");
    setDraft((current) => ({
      ...current,
      type: extracted.type || current.type,
      title: current.title || extracted.title,
      username: current.username || extracted.username,
      secret: current.secret || extracted.secret,
      bankDetails: current.bankDetails || extracted.bankDetails,
      notes: `${current.notes || ""}\n\nExtracted from screenshot:\n${extracted.bankDetails}`.trim(),
      financial: { ...current.financial, ...extracted.financial }
    }));
    setMessageTone("green");
    setMessage("Screenshot details added to the draft. Review before saving.");
  }

  return (
    <div className="p-6 text-[var(--ink)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--green-ink)]">{draft.id ? "Edit dossier" : "Create dossier"}</p>
          <h3 className="mt-2 text-3xl font-semibold md:text-4xl">{area.label} record</h3>
        </div>
        <button onClick={onCancel} className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">Close</button>
      </div>

      <div className="mt-6 grid gap-4">
        <EditorField label="Title" dark>
          <input className="editor-input-dark" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={`${area.label} record name`} />
        </EditorField>
        <EditorField label="Record type" dark>
          <select className="editor-input-dark" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
            {TYPE_OPTIONS.filter(([id]) => area.types.includes(id) || area.types.length === 1).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </EditorField>
        <EditorField label="Primary detail" dark>
          <input className="editor-input-dark" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder={primaryDetailPlaceholder(draft.type, area)} />
        </EditorField>
      </div>

      <button
        type="button"
        onClick={() => setShowMore((value) => !value)}
        className="mt-5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
      >
        {showMore ? "Hide details" : "+ Add more details"}
      </button>

      {showMore && (
        <>
          <div className="mt-5 grid gap-4">
            <EditorField label="Sensitive value" dark>
              <input className="editor-input-dark" value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} placeholder="Password, PIN, locker code" />
            </EditorField>
            <EditorField label="Emergency release" dark>
              <select className="editor-input-dark" value={draft.emergencyEligible ? "yes" : "no"} onChange={(event) => setDraft({ ...draft, emergencyEligible: event.target.value === "yes" })}>
                <option value="yes">Emergency-enabled</option>
                <option value="no">Private</option>
              </select>
            </EditorField>
            <EditorField label="Financial value" dark>
              <input className="editor-input-dark" value={draft.financial?.value ?? ""} onChange={(event) => setDraft({ ...draft, financial: { ...draft.financial, value: event.target.value } })} placeholder="Amount" />
            </EditorField>
          </div>

          <EditorField label="Notes" className="mt-4" dark>
            <textarea className="editor-input-dark min-h-32" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Details for later" />
          </EditorField>

          <div className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface-3)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--ink)]">Files</p>
              <div className="flex flex-wrap gap-2">
                <AttachmentUploader onFiles={uploadFiles} />
                <label className="cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">
                  Extract screenshot
                  <input className="hidden" type="file" accept="image/*" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) await extractFromScreenshot(file);
                    event.target.value = "";
                  }} />
                </label>
              </div>
            </div>
            {(draft.attachments?.length ?? 0) > 0 && <AttachmentGrid attachments={draft.attachments ?? []} onDelete={deleteDraftAttachment} onReplace={replaceDraftAttachment} tone="dark" />}
          </div>
        </>
      )}

      {message && <div className={cx("mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold", messageTone === "red" ? "border-[#ff453a]/25 bg-[#ff453a]/10 text-[var(--red-2)]" : "border-[#34c759]/20 bg-[#34c759]/10 text-[var(--green-ink)]")}>{message}</div>}

      <button onClick={handleSave} className="mt-6 w-full rounded-full bg-[var(--accent)] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]">Save changes</button>
    </div>
  );
}

function EditorField({ label, children, className = "", dark = false }) {
  return (
    <label className={cx("block text-sm font-semibold", dark ? "text-[var(--ink-3)]" : "text-[var(--ink-2)]", className)}>
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function AttachmentUploader({ onFiles, dark = true }) {
  return (
    <label className={cx("cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition", dark ? "border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)] hover:bg-[var(--surface-2)]" : "border border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]")}>
      Upload file
      <input className="hidden" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,application/pdf" onChange={(event) => {
        if (event.target.files?.length) onFiles(event.target.files);
        event.target.value = "";
      }} />
    </label>
  );
}

function AttachmentGrid({ attachments, onDelete, onReplace, onExtract, tone = "light" }) {
  const dark = tone === "dark";
  useEffect(() => {
    return () => revokeAttachmentPreviews(attachments);
  }, [attachments]);

  if (!attachments?.length) {
    return <div className={cx("mt-4 rounded-[1.25rem] border border-dashed p-5 text-sm", dark ? "border-[var(--line)] bg-[var(--surface-3)] text-[var(--ink-3)]" : "border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--ink-2)]")}>No proof files attached yet.</div>;
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {attachments.map((attachment) => {
        const kind = attachmentKind(attachment);
        return (
          <div key={attachment.id} className={cx("overflow-hidden rounded-[1.25rem] border", dark ? "border-[var(--line)] bg-[var(--surface-3)]" : "border-[var(--line-2)] bg-[var(--surface)] shadow-sm")}>
            {kind === "Image" ? (
              <img src={attachment.dataUrl} alt={attachment.name} className="h-32 w-full object-cover" />
            ) : kind === "PDF" ? (
              <iframe src={attachment.dataUrl} title={attachment.name} className={cx("h-32 w-full", dark ? "bg-[var(--surface-2)]" : "bg-[var(--bg)]")} />
            ) : (
              <div className={cx("grid h-32 place-items-center text-sm font-semibold", dark ? "bg-[var(--surface-2)] text-[var(--ink-3)]" : "bg-[var(--bg)] text-[var(--ink-3)]")}>{attachmentIcon(kind)}</div>
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className={cx("block break-all text-sm", dark ? "text-white/86" : "text-[var(--ink)]")}>{attachment.name}</strong>
                  <span className={cx("mt-1 block text-xs font-semibold", dark ? "text-white/38" : "text-[var(--ink-3)]")}>{kind} • {Math.max(1, Math.round((attachment.size ?? 0) / 1024))} KB</span>
                </div>
                <a href={attachment.dataUrl} download={attachment.name} className={cx("rounded-full border px-3 py-1 text-xs font-semibold", dark ? "border-white/[0.1] bg-white/[0.06] text-white" : "border-[var(--line-2)] text-[var(--ink)]")}>Open</a>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {kind === "Image" && onExtract && (
                  <button onClick={async () => {
                    const response = await fetch(attachment.dataUrl);
                    const blob = await response.blob();
                    const file = new File([blob], attachment.name, { type: attachment.type });
                    const { createWorker } = await import("tesseract.js");
                    const worker = await createWorker("eng");
                    const result = await worker.recognize(file);
                    await worker.terminate();
                    await onExtract(result.data.text || "");
                  }} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold", dark ? "border border-[#8fd5a6]/20 bg-[#8fd5a6]/12 text-[#b7f3c4]" : "bg-[#1d1d1f] text-white")}>Extract</button>
                )}
                {onReplace && (
                  <label className={cx("cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold", dark ? "border border-white/[0.1] bg-white/[0.06] text-white" : "border border-[var(--line-2)] text-[var(--ink)]")}>
                    Replace
                    <input className="hidden" type="file" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,application/pdf" onChange={async (event) => {
                      if (event.target.files?.length) await onReplace(attachment, event.target.files);
                      event.target.value = "";
                    }} />
                  </label>
                )}
                {onDelete && (
                  <button onClick={() => onDelete(attachment)} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold", dark ? "border border-[#ff453a]/20 bg-[#ff453a]/10 text-[#ffb4ae]" : "border border-[#ff3b30]/20 text-[var(--red-2)]")}>Delete</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CaptureScreen({ vault, onSave, entitlements, onNavigate }) {
  const [messyText, setMessyText] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [manual, setManual] = useState({ ...EMPTY_ITEM, title: "", type: "important_document" });
  const [attachments, setAttachments] = useState([]);
  const [message, setMessage] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const activeDraft = drafts[selectedDraftIndex] ?? manual;
  const hasStructuredDrafts = drafts.length > 0;
  const itemLimit = entitlements?.vaultItemLimit;
  const limitReached = Number.isFinite(itemLimit) && vault.items.length >= itemLimit;

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    setMessage("");
    try {
      if (file.type.startsWith("image/")) {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng");
        const result = await worker.recognize(file);
        await worker.terminate();
        setMessyText(result.data.text || `${file.name} uploaded. OCR did not find readable text.`);
        setMessage("Screenshot read locally. Review the text before saving.");
      } else {
        const attachment = await readFileAsAttachment(file);
        setAttachments((current) => [attachment, ...current]);
        if (file.type.startsWith("text/") || file.name.match(/\.(txt|csv|md)$/i)) {
          setMessyText(await file.text());
        }
        setMessage("Proof file attached to the draft.");
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      event.target.value = "";
      setOcrBusy(false);
    }
  }

  function structure() {
    const nextDrafts = analyzeMessyInputRecords(messyText);
    setDrafts(nextDrafts);
    setSelectedDraftIndex(0);
    setManual((current) => ({ ...current, ...nextDrafts[0] }));
    setMessage(nextDrafts.length > 1 ? `${nextDrafts.length} possible records found. Review each before saving.` : "Structured draft ready. Nothing is saved until you confirm.");
  }

  async function saveRecord() {
    if (limitReached) {
      setMessage(`Free Forever includes ${itemLimit} entries. Upgrade to Vault for unlimited entries, balance sheet, and Circle of Trust release.`);
      return;
    }
    const title = activeDraft.title?.trim();
    if (!title) {
      setMessage("Add a clear title before saving.");
      return;
    }
    const now = new Date().toISOString();
    const nextItem = {
      ...EMPTY_ITEM,
      ...activeDraft,
      id: crypto.randomUUID(),
      title,
      attachments: [
        ...attachments,
        ...(hasStructuredDrafts ? [buildTextAttachment("capture-source.txt", messyText)] : [])
      ],
      createdAt: now,
      updatedAt: now
    };
    await onSave({
      ...vault,
      items: [nextItem, ...vault.items],
      audit: [{ id: crypto.randomUUID(), event: `Captured record: ${nextItem.title}`, at: now }, ...vault.audit]
    }, attachments.length || hasStructuredDrafts ? "attachment_change" : "record_change");
    const remainingDrafts = drafts.filter((_, index) => index !== selectedDraftIndex);
    setMessage(remainingDrafts.length ? "Saved. Continue reviewing the remaining extracted records." : "Saved as a protected record.");
    setDrafts(remainingDrafts);
    setSelectedDraftIndex(0);
    setAttachments([]);
    setManual({ ...EMPTY_ITEM, title: "", type: "important_document" });
    setShowManualMore(false);
    if (!remainingDrafts.length) onNavigate("life");
  }

  const [showManual, setShowManual] = useState(true);
  const [showManualMore, setShowManualMore] = useState(false);

  return (
    <section className="mx-auto max-w-2xl">
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Add record</p>
        <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">Secure what matters.</h1>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-[var(--ink-2)]">Add one important thing. Lyfos keeps it private, organized, and ready when your family needs clarity.</p>
      </div>

      {limitReached && (
        <div className="mt-6 rounded-2xl border border-[#c88719]/30 bg-[var(--amber-soft)] px-4 py-3 text-[13px] leading-5 text-[var(--amber-ink)]">
          <strong>Free Forever limit reached.</strong> You have {vault.items.length} of {itemLimit} entries. Existing entries stay editable; upgrade to Vault to add more.
        </div>
      )}

      {message && <div className={cx("mt-6 rounded-2xl border px-4 py-3 text-[13px] font-medium", message.includes("Free Forever") ? "border-[#c88719]/30 bg-[var(--amber-soft)] text-[var(--amber-ink)]" : "border-[#34c759]/20 bg-[#34c759]/8 text-[var(--green-ink)]")}>{message}</div>}

      {hasStructuredDrafts && drafts.length > 1 && (
        <div className="mt-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Review queue · {drafts.length}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {drafts.map((item, index) => (
              <button
                key={item.candidateId}
                onClick={() => setSelectedDraftIndex(index)}
                className={cx("rounded-full border px-3 py-1.5 text-[12px] font-medium transition", selectedDraftIndex === index ? "border-[#1d1d1f] bg-[#1d1d1f] text-white" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)] hover:text-[var(--ink)]")}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasStructuredDrafts && (
        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[20px] font-semibold tracking-tight">{activeDraft.title || "Untitled draft"}</h2>
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ink-3)]">{confidenceLabel(activeDraft.confidence)}</span>
          </div>

          <div className="mt-6 divide-y divide-[var(--line)]">
            <DraftRowLight label="Type" value={TYPE_OPTIONS.find(([id]) => id === activeDraft.type)?.[1] ?? "Not selected"} />
            <DraftRowLight label="Identifier" value={activeDraft.username || "Not detected"} />
            <DraftRowLight label="Sensitive key" value={activeDraft.secret || "Not detected"} muted={!activeDraft.secret} />
            <DraftRowLight label="Emergency release" value={activeDraft.emergencyEligible ? "Eligible after confirmation" : "Owner only"} />
          </div>

          {activeDraft?.warnings?.length > 0 && (
            <div className="mt-6 rounded-xl bg-[var(--amber-soft)] px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--amber-ink)]">Review before saving</p>
              <div className="mt-2 space-y-1">
                {activeDraft.warnings.map((warning) => (
                  <p key={warning} className="text-[13px] leading-5 text-[var(--amber-ink)]">{warning}</p>
                ))}
              </div>
            </div>
          )}

          <button onClick={saveRecord} className="mt-8 w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black">
            Save as protected record
          </button>
          <p className="mt-3 text-center text-[11px] text-[var(--ink-4)]">Nothing is saved until you confirm.</p>
        </div>
      )}

      <div className={cx("mt-8 rounded-[1.75rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]", hasStructuredDrafts && "opacity-70")}>
        <button
          onClick={() => setShowManual((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span>
            <span className="block text-[15px] font-semibold text-[var(--ink)]">{hasStructuredDrafts ? "Edit details" : "Enter details"}</span>
            <span className="mt-0.5 block text-[12px] text-[var(--ink-3)]">The fastest path: title, type, detail, save.</span>
          </span>
          <span className={cx("text-[var(--ink-5)] transition", showManual && "rotate-90")}>›</span>
          </button>
        {showManual && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <input aria-label="Record title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)]" placeholder="Title" value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} />
            <select aria-label="Record type" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)]" value={manual.type} onChange={(event) => setManual({ ...manual, type: event.target.value })}>
              {TYPE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <input aria-label="Primary detail" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)] md:col-span-2" placeholder={primaryDetailPlaceholder(manual.type)} value={manual.username} onChange={(event) => setManual({ ...manual, username: event.target.value })} />
            <button
              type="button"
              onClick={() => setShowManualMore((value) => !value)}
              className="md:col-span-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 py-2.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
            >
              {showManualMore ? "Hide details" : "+ Add more details"}
            </button>
            {showManualMore && (
              <>
                <input aria-label="Secret, PIN, or key" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)]" placeholder="Secret / PIN / key" value={manual.secret} onChange={(event) => setManual({ ...manual, secret: event.target.value })} />
                <select aria-label="Emergency release" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)]" value={manual.emergencyEligible ? "yes" : "no"} onChange={(event) => setManual({ ...manual, emergencyEligible: event.target.value === "yes" })}>
                  <option value="yes">Emergency-enabled</option>
                  <option value="no">Private</option>
                </select>
                <textarea aria-label="Notes" className="min-h-28 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)] md:col-span-2" placeholder="Notes" value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} />
              </>
            )}
            <button
              onClick={saveRecord}
              className="md:col-span-2 mt-2 h-12 rounded-full bg-[var(--accent)] px-5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(22,163,74,0.18)] transition hover:translate-y-[-1px] hover:bg-[var(--accent-hover)]"
            >
              Save protected record
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-[1.5rem] border border-dashed border-[var(--line-2)] bg-[var(--surface-2)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[var(--ink)]">Have a screenshot or long note?</p>
            <p className="mt-1 text-[12.5px] leading-5 text-[var(--ink-3)]">Paste it here. Lyfos can structure it before you save.</p>
          </div>
          <label className="shrink-0 cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[12px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">
            <input className="hidden" type="file" accept="image/*,.txt,.csv,.md,application/pdf" onChange={handleUpload} />
            {ocrBusy ? "Reading locally…" : "Upload file"}
          </label>
        </div>
        <textarea
          className="mt-4 min-h-28 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[14px] leading-6 outline-none transition focus:border-[var(--ink)]"
          placeholder="Paste details, screenshot text, policy notes, or account instructions"
          value={messyText}
          onChange={(event) => setMessyText(event.target.value)}
        />
        <button
          onClick={structure}
          disabled={ocrBusy || !messyText.trim()}
          className="mt-3 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 py-2.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Structure before saving
        </button>
      </div>
    </section>
  );
}

function DraftRowLight({ label, value, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{label}</span>
      <span className={cx("max-w-[60%] break-words text-right text-[14px] font-medium", muted ? "text-[var(--ink-4)]" : "text-[var(--ink)]")}>{value}</span>
    </div>
  );
}

function RecoveryPreview({ vault, settings, onClose }) {
  const [step, setStep] = useState(0);
  const nomineeRaw = (settings.mainNominee || "your nominee").split(/[-–·]/)[0].trim() || "your nominee";
  const holders = settings.keyHolders.filter((h) => h.trim());
  const need = RELEASE_POLICY.requiredKeys;
  const grouped = AREAS.map((a) => ({ area: a, records: vault.items.filter((it) => a.types.includes(it.type)) })).filter((g) => g.records.length);

  const steps = [
    {
      tone: "green", icon: "shield",
      title: "See what your family would see",
      lead: `This is exactly what ${nomineeRaw} and your circle of trust would experience if your vault ever needed to be opened. It's a safe practice run — nothing is shared, and no one is contacted.`
    },
    {
      tone: "blue", icon: "person",
      title: `${nomineeRaw} asks to open the vault`,
      lead: `When the time comes, ${nomineeRaw} signs in and makes a request, explaining why. Your circle of trust is notified at once — and ${nomineeRaw} can never do this alone.`
    },
    {
      tone: "green", icon: "people",
      title: "Your circle agrees",
      lead: `At least ${need} of your trusted people must approve together. No single person — not even ${nomineeRaw} — can open the vault alone.`,
      holders: true
    },
    {
      tone: "amber", icon: "clock",
      title: "You have 14 days to stop it",
      lead: "The moment a request begins, you're alerted on every device. If something isn't right, you stop everything with a single tap. The vault only opens after 14 quiet days."
    },
    {
      tone: "green", icon: "unlock",
      title: `${nomineeRaw} can now see everything`,
      lead: "Here's what your family receives — clearly organised, area by area.",
      receive: true
    }
  ];
  const s = steps[step];
  const toneClass = { green: "bg-[var(--green-soft)] text-[var(--green-ink)]", blue: "bg-[var(--blue-soft)] text-[var(--blue)]", amber: "bg-[var(--amber-soft)] text-[var(--amber-ink)]" };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
      <div className="flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-5">
        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--amber-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--amber-ink)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber)]" />Practice run
        </span>
        <span className="text-[13px] text-[var(--ink-3)]">Nothing is shared and no one is contacted.</span>
        <button onClick={onClose} aria-label="Exit practice run" className="ml-auto grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] text-[var(--ink-2)] transition hover:text-[var(--ink)]">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-12">
          <div className={cx("mb-6 grid h-16 w-16 place-items-center rounded-2xl text-2xl", toneClass[s.tone])}>
            {s.icon === "shield" ? "🛡️" : s.icon === "person" ? "🙋" : s.icon === "people" ? "👥" : s.icon === "clock" ? "🕑" : "🔓"}
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight text-[var(--ink)]">{s.title}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">{s.lead}</p>

          {s.holders && (
            <div className="mt-6 flex flex-col gap-2">
              {(holders.length ? holders : ["(no key holders added yet)"]).map((h, i) => {
                const ok = i < need && holders.length;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
                    <span className={cx("grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold", ok ? "bg-[var(--green-soft)] text-[var(--green-ink)]" : "bg-[var(--surface-3)] text-[var(--ink-4)]")}>{(h[0] || "?").toUpperCase()}</span>
                    <span className="flex-1 truncate text-[14px] font-medium text-[var(--ink)]">{h.split(/[-–]/)[0].trim()}</span>
                    <span className={cx("text-[12.5px] font-semibold", ok ? "text-[var(--green-ink)]" : "text-[var(--ink-4)]")}>{ok ? "Agreed" : "Not needed"}</span>
                  </div>
                );
              })}
            </div>
          )}

          {s.receive && (
            <div className="mt-6">
              {grouped.length ? grouped.map((g) => (
                <div key={g.area.id} className="mb-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">{g.area.label} · {g.records.length}</div>
                  <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
                    {g.records.map((r, i) => (
                      <div key={i} className={cx("px-4 py-3 text-[14px] text-[var(--ink)]", i > 0 && "border-t border-[var(--line)]")}>{r.title || typeLabel(r.type)}</div>
                    ))}
                  </div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-[var(--line-2)] p-6 text-center text-[13.5px] text-[var(--ink-3)]">Records you add will appear here for your family.</div>}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--line)] bg-[var(--surface)] px-5 py-3.5">
        <div className="flex gap-1.5">
          {steps.map((_, i) => <span key={i} className={cx("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-[var(--green)]" : "w-1.5 bg-[var(--line-2)]")} />)}
        </div>
        <div className="ml-auto flex gap-2.5">
          {step > 0 && <button onClick={() => setStep(step - 1)} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">Back</button>}
          <button onClick={() => step < steps.length - 1 ? setStep(step + 1) : onClose()} className="rounded-full bg-[var(--solid)] px-5 py-2 text-[13px] font-semibold text-[var(--on-solid)] transition hover:opacity-90">{step < steps.length - 1 ? "Next" : "Finish"}</button>
        </div>
      </div>
    </div>
  );
}

function ReleaseScreen({ vault, onSave, session, vaultKey, entitlements, autoPreview }) {
  const [previewOpen, setPreviewOpen] = useState(Boolean(autoPreview));
  const [settings, setSettings] = useState(vault.releaseSettings);
  const [activeKeys, setActiveKeys] = useState(() => settings.keyHolders.map((holder, index) => holder.trim() ? index : null).filter((index) => index !== null).slice(0, RELEASE_POLICY.requiredKeys));
  const [releaseStep, setReleaseStep] = useState(1);
  const [message, setMessage] = useState("");
  const filledKeys = settings.keyHolders.filter((holder) => holder.trim()).length;
  const normalizedHolders = settings.keyHolders.map((holder) => holder.trim().toLowerCase());
  const duplicateIndexes = normalizedHolders
    .map((holder, index) => holder && normalizedHolders.indexOf(holder) !== index ? index : null)
    .filter((index) => index !== null);
  const hasDuplicates = duplicateIndexes.length > 0;
  const nomineeReady = Boolean(settings.mainNominee.trim());
  const confirmed = nomineeReady && !hasDuplicates && activeKeys.length >= RELEASE_POLICY.requiredKeys;
  const remainingKeys = Math.max(0, RELEASE_POLICY.requiredKeys - activeKeys.length);
  const releaseStatus = !nomineeReady
    ? "Add a Main Nominee before any recovery request can begin."
    : hasDuplicates
      ? "Each trusted key must be a different person."
    : filledKeys < RELEASE_POLICY.requiredKeys
      ? `Add ${RELEASE_POLICY.requiredKeys - filledKeys} more trusted key holder${RELEASE_POLICY.requiredKeys - filledKeys === 1 ? "" : "s"}.`
      : confirmed
        ? "Plan looks complete. The live release service is not active yet — share these details with your nominee manually for now."
        : `Select ${remainingKeys} more trusted key${remainingKeys === 1 ? "" : "s"} to simulate the threshold.`;

  useEffect(() => {
    setActiveKeys((current) => current.filter((index) => settings.keyHolders[index]?.trim()));
  }, [settings.keyHolders]);

  async function saveSettings() {
    if (hasDuplicates) {
      setMessage("Duplicate key holders are not allowed. Recovery depends on independent people.");
      return;
    }
    const now = new Date().toISOString();
    await onSave({
      ...vault,
      releaseSettings: settings,
      audit: [{ id: crypto.randomUUID(), event: "Release circle updated", at: now }, ...vault.audit]
    }, null);
    setMessage(confirmed ? "Plan saved locally. Lyfos cannot yet contact your nominees — share these details with them yourself." : "Plan saved as a draft.");
  }

  const supabaseOn = isSupabaseConfigured();
  const cloudEnabled = supabaseOn && Boolean(session);

  return (
    <section className="mx-auto max-w-2xl">
      {previewOpen && <RecoveryPreview vault={vault} settings={settings} onClose={() => setPreviewOpen(false)} />}

      <div className="mb-8 flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--green-soft)] text-lg">👁️</div>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold text-[var(--ink)]">See what your family would see</div>
          <div className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">A safe practice run — walk through the whole recovery, step by step. Nothing is shared.</div>
        </div>
        <button onClick={() => setPreviewOpen(true)} className="shrink-0 rounded-full bg-[var(--solid)] px-4 py-2.5 text-[13px] font-semibold text-[var(--on-solid)] transition hover:opacity-90">Start practice run</button>
      </div>

      {cloudEnabled && <CloudKeyHolders vaultKey={vaultKey} entitlements={entitlements} />}

      {!cloudEnabled && (
      <div className="mb-10 rounded-2xl border border-[#c88719]/30 bg-[var(--amber-soft)] px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#c88719] text-[11px] font-bold text-white">!</span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--amber-ink)]">Planning mode only</p>
            <p className="mt-1.5 text-[13px] leading-5 text-[var(--amber-ink)]">
              {supabaseOn
                ? <>Sign in to activate the real release service. Without an account, this page only stores your plan locally — Lyfos cannot contact anyone for you.</>
                : <>This deployment is local-only. Sign in is not available. Your release plan stays on this device; you must share these instructions with your nominee yourself.</>}
            </p>
          </div>
        </div>
      </div>
      )}

      {!cloudEnabled && (
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Release plan · Draft</p>
        <h1 className="mt-3 text-[36px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
          {confirmed ? "Your plan is complete." : "Plan who would help your family."}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-6 text-[var(--ink-2)]">
          You name a nominee and five trusted key holders. In the future, three keys plus a 14-day hold will be required to release.
        </p>
      </div>
      )}

      {!cloudEnabled && (
      <div className={cx("mt-10 rounded-2xl border p-5", confirmed ? "border-[#34c759]/25 bg-[#34c759]/8" : hasDuplicates ? "border-[#ff453a]/25 bg-[#ff453a]/6" : "border-[var(--line)] bg-[var(--surface)]")}>
        <div className="grid grid-cols-3 gap-3 text-center">
          <ReleaseStat label="Nominee" value={nomineeReady ? "Set" : "—"} ok={nomineeReady} />
          <ReleaseStat label="Key holders" value={`${filledKeys}/5`} ok={filledKeys >= RELEASE_POLICY.requiredKeys} />
          <ReleaseStat label="Threshold" value={`${activeKeys.length}/3`} ok={activeKeys.length >= RELEASE_POLICY.requiredKeys} />
        </div>
        <p className={cx("mt-4 text-center text-[13px] leading-5", confirmed ? "text-[var(--green-ink)]" : hasDuplicates ? "text-[var(--red-2)]" : "text-[var(--ink-2)]")}>
          {releaseStatus}
        </p>
      </div>
      )}

      {!cloudEnabled && (
      <>
      <ReleaseStepNav step={releaseStep} onStep={setReleaseStep} />

      <div className="mt-8">
        {releaseStep === 1 && (
          <ReleasePanelLight subtitle="Choose the Main Nominee" body="This is the person who starts a recovery request. They still cannot open the vault alone.">
            <input
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--ink)]"
              value={settings.mainNominee}
              onChange={(event) => { setMessage(""); setSettings({ ...settings, mainNominee: event.target.value }); }}
              placeholder="Name or email"
            />
          </ReleasePanelLight>
        )}

        {releaseStep === 2 && (
          <ReleasePanelLight subtitle="Add five independent key holders" body="Not all from the same household. Recovery depends on independent humans.">
            <div className="grid gap-2.5">
              {settings.keyHolders.map((holder, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="w-6 text-[12px] font-medium text-[var(--ink-4)]">{index + 1}</span>
                  <input
                    className={cx("flex-1 rounded-xl border bg-[var(--surface)] px-4 py-2.5 text-[14px] outline-none", duplicateIndexes.includes(index) ? "border-[#ff453a]/40 focus:border-[#ff453a]" : "border-[var(--line)] focus:border-[var(--ink)]")}
                    value={holder}
                    onChange={(event) => {
                      setMessage("");
                      const keyHolders = [...settings.keyHolders];
                      keyHolders[index] = event.target.value;
                      setSettings({ ...settings, keyHolders });
                      if (!event.target.value.trim()) setActiveKeys((current) => current.filter((item) => item !== index));
                    }}
                    placeholder="Name or email"
                  />
                  <button
                    onClick={() => {
                      if (!settings.keyHolders[index]?.trim()) return;
                      setActiveKeys((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index].slice(-5));
                    }}
                    disabled={!holder.trim()}
                    className={cx("rounded-full border px-3 py-1.5 text-[11px] font-semibold transition", activeKeys.includes(index) ? "border-[#34c759]/40 bg-[#34c759]/10 text-[var(--green-ink)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:text-[var(--ink)] disabled:opacity-30")}
                  >
                    {activeKeys.includes(index) ? "Selected" : "Select"}
                  </button>
                </div>
              ))}
            </div>
          </ReleasePanelLight>
        )}

        {releaseStep === 3 && (
          <ReleasePanelLight subtitle="Owner alert and threshold rules" body="These rules are shown as product logic. A production release requires a backend alert service.">
            <div className="divide-y divide-[var(--line)]">
              <RuleRow label="Threshold" value="Recipient + 2 other keys" />
              <RuleRow label="Owner hold" value="14 days" />
              <RuleRow label="Owner alerts" value="2 per day" />
            </div>
          </ReleasePanelLight>
        )}

        {releaseStep === 4 && (
          <ReleasePanelLight subtitle="Preview emergency access" body="The exact sequence a nominee should expect. Simulated in this prototype.">
            <div className="space-y-0">
              {["Primary or approved backup signs in", "Two other nominees release keys", "14-day owner alert hold", "Entire vault opens read-only"].map((step, index) => (
                <div key={step} className="flex items-center gap-4 border-b border-[var(--line)] py-3.5 last:border-0">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--surface-2)] text-[12px] font-semibold text-[var(--ink-2)]">{index + 1}</span>
                  <span className="text-[14px] text-[var(--ink)]">{step}</span>
                </div>
              ))}
            </div>
          </ReleasePanelLight>
        )}

        {releaseStep === 5 && (
          <ReleasePanelLight subtitle="Readiness state" body={confirmed ? "Coherent for demo. Production still needs identity, alert delivery, and server-side enforcement." : "Not ready. Fix the readiness gaps before relying on it."}>
            <div className="divide-y divide-[var(--line)]">
              <RuleRow label="Nominee" value={nomineeReady ? "Ready" : "Missing"} tone={nomineeReady ? "ok" : "warn"} />
              <RuleRow label="Key holders" value={`${filledKeys}/5 added`} tone={filledKeys >= 5 ? "ok" : "warn"} />
              <RuleRow label="Supporting keys" value={`${Math.min(activeKeys.length, 2)}/2 selected`} tone={activeKeys.length >= 2 ? "ok" : "warn"} />
            </div>
          </ReleasePanelLight>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => setReleaseStep(Math.max(1, releaseStep - 1))} disabled={releaseStep === 1} className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)] disabled:opacity-30">‹ Back</button>
        <button onClick={() => setReleaseStep(Math.min(5, releaseStep + 1))} disabled={releaseStep === 5} className="text-xs font-medium text-[var(--ink)] hover:text-black disabled:opacity-30">Next ›</button>
      </div>

      {message && <div className={cx("mt-6 rounded-2xl px-4 py-3 text-[13px] font-medium", message.includes("Duplicate") ? "bg-[#ff453a]/8 text-[var(--red-2)]" : "bg-[#34c759]/8 text-[var(--green-ink)]")}>{message}</div>}

      <div className="mt-10 flex flex-col items-center">
        <button onClick={saveSettings} className="rounded-full bg-[#1d1d1f] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black">
          Save release circle
        </button>
        <p className="mt-3 text-[11px] text-[var(--ink-4)]">Saved locally. No emails are sent in this prototype.</p>
      </div>
      </>
      )}
    </section>
  );
}

function CloudKeyHolders({ vaultKey, entitlements }) {
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState(null);
  const [inviteFeedback, setInviteFeedback] = useState(null); // { holderId, inviteUrl }
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeFeedback, setFinalizeFeedback] = useState("");

  const holderSummary = useMemo(() => summarizeKeyHolders(holders), [holders]);
  const { activeHolders, readyHolders, invited, accepted, verified, finalized } = holderSummary;
  const rosterSlots = useMemo(() => buildTrustRosterSlots(holders), [holders]);
  const activeGenerations = new Set(activeHolders.map((holder) => holder.circle_generation).filter((generation) => Number(generation) > 0));
  const planActive = finalized >= 5 && activeGenerations.size === 1;
  const canPay = entitlements ? entitlements.releaseEnabled : false;
  const circleReadiness = useMemo(() => validateCircleForActivation(readyHolders), [readyHolders]);
  const canFinalize = !planActive && circleReadiness.ok && canPay;

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const list = await listMyKeyHolders();
      setHolders(list);
    } catch (err) {
      setError(err?.message || "Couldn't load your key holders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleInviteCreated({ label, holderEmail, holderPhone, role }) {
    setBusy(true);
    setError("");
    try {
      const created = await createKeyHolderInvite({ label, holderEmail, holderPhone, role });
      const inviteUrl = buildExternalAppUrl(PUBLIC_APP_URL, `/invite/${created.invite_token}`);
      let delivery = { status: "failed", message: "The invite was created, but the email could not be sent." };
      try {
        const result = await sendInviteEmail({ deliveryId: created.delivery_id });
        delivery = result?.state === "failed"
          ? { status: "failed", message: result.reason || "The provider rejected this email." }
          : { status: result?.state || "sent", message: "The provider accepted the email. Delivery confirmation may take a moment." };
      } catch (sendErr) {
        if (typeof console !== "undefined") {
          console.warn("[lyfos] invite email send failed:", sendErr?.message ?? sendErr);
        }
        delivery = { status: "failed", message: sendErr?.message || "The email provider rejected the invite." };
      }
      setInviteFeedback({ holderId: created.id, inviteUrl, holderLabel: label, holderEmail, delivery });
      setShowInvite(false);
      await refresh();
    } catch (err) {
      setError(err?.message || "Couldn't create invite.");
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite(holder) {
    setResendingId(holder.id);
    setError("");
    let inviteUrl = null;
    try {
      const next = await requeueKeyHolderInvite(holder.id);
      inviteUrl = buildExternalAppUrl(PUBLIC_APP_URL, `/invite/${next.invite_token}`);
      const result = await sendInviteEmail({ deliveryId: next.delivery_id });
      setInviteFeedback({
        holderId: holder.id,
        inviteUrl,
        holderLabel: holder.label,
        holderEmail: holder.holder_email,
        delivery: result?.state === "failed"
          ? { status: "failed", message: result.reason || "The provider rejected this email." }
          : { status: result?.state || "sent", message: "The provider accepted the email. Delivery confirmation may take a moment." }
      });
    } catch (err) {
      setInviteFeedback({
        holderId: holder.id,
        inviteUrl,
        holderLabel: holder.label,
        holderEmail: holder.holder_email,
        delivery: { status: "failed", message: err?.message || "The email provider rejected the invite." }
      });
    } finally {
      setResendingId(null);
    }
  }

  async function revoke(holder) {
    const extraWarning = holder.status === "verified"
      ? `\n\nThis nominee is part of your active recovery generation. Revoking them makes the plan incomplete, and primary or backup recovery may stop working. Invite a replacement and activate a fresh five-person generation before relying on it again.`
      : "";
    if (!window.confirm(`Revoke ${holder.label}'s invite? They will no longer be a key holder.${extraWarning}`)) return;
    try {
      await revokeKeyHolder(holder.id);
      await refresh();
    } catch (err) {
      setError(err?.message || "Couldn't revoke.");
    }
  }

  async function remove(holder) {
    if (!window.confirm(`Delete ${holder.label}'s invite permanently? This removes the invite so you can send a new one to the same email.`)) return;
    try {
      await deleteKeyHolder(holder.id);
      setHolders((current) => current.filter((h) => h.id !== holder.id));
      await refresh();
    } catch (err) {
      setError(err?.message || "Couldn't delete the invite.");
    }
  }

  async function finalize(instructions) {
    if (!vaultKey) {
      setError("Unlock your vault first.");
      return;
    }
    if (!canFinalize) return;
    setFinalizing(true);
    setError("");
    let rawKey = null;
    try {
      // Export the raw 32-byte AES key from the unlocked CryptoKey
      rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey));
      await activateCircleGeneration({ rawVaultKey: rawKey, holders: readyHolders, instructions });
      setFinalizeOpen(false);
      setFinalizeFeedback("Plan active. Your circle is ready.");
      await refresh();
    } catch (err) {
      setError(err?.message || "Couldn't finalize.");
    } finally {
      rawKey?.fill(0);
      setFinalizing(false);
    }
  }

  return (
    <div className="mb-12">
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Release plan</p>
        <h1 className="mt-3 text-[36px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
          {planActive ? "Your circle is active." : "Build your circle of five."}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-6 text-[var(--ink-2)]">
          Choose one primary, one backup, and three trusted nominees. The selected recipient plus two other nominees—and a 14-day owner-protection hold—are required to recover the vault.
        </p>
      </div>

      {/* Readiness pill row */}
      <div className="mt-10 grid grid-cols-3 gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-center">
        <ReleaseStat label="Invited" value={invited} ok={invited === 5} />
        <ReleaseStat label="Accepted" value={accepted} ok={accepted === 5} />
        <ReleaseStat label="Verified" value={verified} ok={verified === 5} />
      </div>

      {error && <div className="mt-4 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[var(--red-2)]">{error}</div>}
      {!planActive && invited === 5 && !circleReadiness.ok && (
        <div className="mt-4 rounded-xl bg-[var(--amber-soft)] px-4 py-3 text-[13px] font-medium text-[var(--amber-ink)]">{circleReadiness.reason}</div>
      )}
      {inviteFeedback && <InviteFeedback feedback={inviteFeedback} onClose={() => setInviteFeedback(null)} />}

      <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="grid grid-cols-[44px_1fr_1fr_112px] gap-3 border-b border-[var(--line)] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">
          <span>#</span>
          <span>Name</span>
          <span>Email</span>
          <span className="text-right">Status</span>
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--ink-3)]">Loading trust circle…</div>
        ) : rosterSlots.map((slot) => slot.kind === "holder" ? (
          <KeyHolderRow
            key={slot.holder.id}
            slot={slot}
            holder={slot.holder}
            onRevoke={() => revoke(slot.holder)}
            onDelete={() => remove(slot.holder)}
            onResend={() => resendInvite(slot.holder)}
            resending={resendingId === slot.holder.id}
          />
        ) : (
          <EmptyTrustSlot key={`empty-${slot.slotNumber}`} slot={slot} onInvite={() => setShowInvite(true)} disabled={showInvite || planActive} />
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        {invited < 5 && !showInvite && !planActive && (
          <button
            onClick={() => setShowInvite(true)}
            className="rounded-full bg-[#1d1d1f] px-7 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black"
          >
            Invite trusted nominee {invited + 1} of 5
          </button>
        )}
        {showInvite && (
          <InviteForm
            busy={busy}
            occupiedRoles={activeHolders.map((holder) => holder.role).filter(Boolean)}
            onCancel={() => setShowInvite(false)}
            onSubmit={handleInviteCreated}
          />
        )}
        {invited === 5 && accepted < 5 && (
          <p className="text-[12px] text-[var(--ink-3)]">Waiting on {5 - accepted} trusted {5 - accepted === 1 ? "person" : "people"} to accept.</p>
        )}
        {canFinalize && (
          <>
            <button
              onClick={() => setFinalizeOpen(true)}
              className="rounded-full bg-[#1d1d1f] px-7 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black"
            >
              Finalize plan
            </button>
            <p className="max-w-sm text-center text-[12px] text-[var(--ink-3)]">
              All five are ready. Activate to bind the primary, backup, and two-person support rule in one encrypted generation.
            </p>
          </>
        )}
        {!planActive && invited === 5 && verified === 5 && !canPay && (
          <FreeReleaseUpgradePrompt />
        )}
        {planActive && (
          <p className="text-[12px] text-[var(--green-ink)]">Your circle is active. The primary or approved backup needs two other nominees after review and the 14-day hold.</p>
        )}
      </div>

      {finalizeFeedback && (
        <div className="mt-6 rounded-2xl border border-[#34c759]/30 bg-[#34c759]/8 px-4 py-3 text-center text-[13px] font-medium text-[var(--green-ink)]">
          {finalizeFeedback}
        </div>
      )}

      {finalizeOpen && (
        <FinalizeModal
          acceptedHolders={readyHolders}
          finalizing={finalizing}
          hasVaultKey={Boolean(vaultKey)}
          onCancel={() => setFinalizeOpen(false)}
          onConfirm={finalize}
        />
      )}
    </div>
  );
}

function FreeReleaseUpgradePrompt() {
  return (
    <div className="w-full max-w-md rounded-2xl border border-[#c88719]/30 bg-[var(--amber-soft)] p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--amber-ink)]">Upgrade to finalize</p>
      <h3 className="mt-1 text-[16px] font-semibold tracking-tight text-[var(--amber-ink)]">Your five are ready.</h3>
      <p className="mt-2 text-[13px] leading-5 text-[var(--amber-ink)]">
        Finalizing splits your vault key into 5 cryptographic shares and turns on the live release service. It's the central paid feature.
      </p>
      <p className="mt-3 text-[13px] leading-5 text-[var(--amber-ink)]">
        Open <strong>Settings → Billing</strong> to upgrade to Lyfos Vault — a one-time ₹999 (India) or $9 (international) payment, yours for life.
      </p>
    </div>
  );
}

function ClaimUrlPanel() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nomineeEmail, setNomineeEmail] = useState("");
  const [nomineeLabel, setNomineeLabel] = useState("");
  const [claimText, setClaimText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showUrl, setShowUrl] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const s = await loadMyReleaseSettings();
      setSettings(s);
      setNomineeEmail(s?.nominee_email ?? "");
      setNomineeLabel(s?.nominee_label ?? "");
      setClaimText(s?.claim_text ?? "");
    } catch (err) {
      setError(err?.message || "Couldn't load claim settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!isValidNomineeEmail(nomineeEmail)) {
      setError("Enter a valid email so your nominee can receive the key.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await upsertMyReleaseSettings({
        nomineeEmail: nomineeEmail.trim() || null,
        nomineeLabel: nomineeLabel.trim() || null,
        claimText: claimText.trim() || null
      });
      setSettings(next);
      setEditing(false);
    } catch (err) {
      setError(err?.message || "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!window.confirm("Rotate the claim link? The old URL will stop working. You'll need to share the new one with your nominee.")) return;
    setBusy(true);
    try {
      const next = await rotateMyClaimToken();
      setSettings(next);
    } catch (err) {
      setError(err?.message || "Couldn't rotate.");
    } finally { setBusy(false); }
  }

  if (loading) return null;

  const url = settings?.claim_token ? buildExternalAppUrl(PUBLIC_APP_URL, `/claim/${settings.claim_token}`) : null;

  async function copyUrl() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch {}
  }

  return (
    <div className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Claim link for your nominee</p>
        {!editing && settings && (
          <button onClick={() => setEditing(true)} className="text-[11px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">Edit</button>
        )}
      </div>

      {!settings && !editing && (
        <div className="mt-3">
          <p className="text-[13px] leading-5 text-[var(--ink-2)]">
            Generate a stable URL you share once with your nominee. They keep it (printed copy, password manager, sealed envelope). If you ever need to release the vault — this is the link.
          </p>
          <button
            onClick={() => setEditing(true)}
            className="mt-4 rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white"
          >
            Set up claim link
          </button>
        </div>
      )}

      {settings && !editing && (
        <div className="mt-3">
          <p className="text-[13px] text-[var(--ink)]">
            Nominee: <strong>{settings.nominee_label || "—"}</strong>
            {settings.nominee_email && <span className="text-[var(--ink-3)]"> · {settings.nominee_email}</span>}
          </p>
          {settings.claim_text && (
            <p className="mt-2 text-[12px] leading-5 text-[var(--ink-2)]">"{settings.claim_text}"</p>
          )}
          <button onClick={() => setShowUrl((v) => !v)} className="mt-3 text-[11px] font-medium text-[var(--ink-3)] underline-offset-2 hover:text-[var(--ink)] hover:underline">
            {showUrl ? "Hide URL" : "Show claim URL"}
          </button>
          {showUrl && url && (
            <div className="mt-2">
              <div className="break-all rounded-md bg-[var(--surface-2)] px-3 py-2 font-mono text-[11px]">{url}</div>
              <div className="mt-2 flex items-center gap-3">
                <button onClick={copyUrl} className="text-[11px] font-medium text-[var(--ink)] underline-offset-2 hover:underline">Copy</button>
                <button onClick={rotate} className="text-[11px] font-medium text-[var(--red-2)] underline-offset-2 hover:underline" disabled={busy}>Rotate</button>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Nominee label</span>
            <input
              value={nomineeLabel}
              onChange={(e) => setNomineeLabel(e.target.value)}
              placeholder="Priya Sharma (spouse)"
              className="mt-1 w-full rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink)]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Nominee email · required</span>
            <input
              type="email"
              value={nomineeEmail}
              onChange={(e) => setNomineeEmail(e.target.value)}
              placeholder="priya@example.com"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink)]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Note for them · optional, shown on the claim page</span>
            <textarea
              value={claimText}
              onChange={(e) => setClaimText(e.target.value)}
              rows={3}
              placeholder="If you're reading this, something has happened to me. Bank passwords + property papers are inside. Call my CA Nikhil first."
              className="mt-1 w-full rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] leading-5 outline-none focus:border-[var(--ink)]"
            />
          </label>
          {error && <div className="rounded-md bg-[#ff453a]/8 px-3 py-2 text-[12px] text-[var(--red-2)]">{error}</div>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button onClick={() => { setEditing(false); refresh(); }} className="text-[11px] text-[var(--ink-3)] hover:text-[var(--ink)]" disabled={busy}>Cancel</button>
            <button onClick={save} disabled={busy || !isValidNomineeEmail(nomineeEmail)} className="rounded-full bg-[#1d1d1f] px-4 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FinalizeModal({ acceptedHolders, finalizing, hasVaultKey, onCancel, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [instructions, setInstructions] = useState("");
  const ready = confirmText.trim().toLowerCase() === "finalize";

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 backdrop-blur-sm md:items-center" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[var(--surface-2)] p-6 shadow-[0_-12px_40px_rgba(0,0,0,0.12)] md:rounded-3xl md:p-8"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">Finalize</p>
        <h2 className="mt-2 text-[24px] font-semibold tracking-tight">Activate your release plan.</h2>

        <p className="mt-4 text-[14px] leading-6 text-[var(--ink-2)]">
          Lyfos will seal a recovery share to each nominee. The primary—or the approved backup—can recover only with two other nominees after review and the owner-protection hold.
        </p>
        <ul className="mt-3 space-y-1.5 pl-5 text-[13px] leading-5 text-[var(--ink-2)] list-disc">
          <li>Your primary nominee files a death/incapacity request with proof</li>
          <li>Lyfos approves the claim after review</li>
          <li>Two other nominees release their own keys</li>
          <li>A 14-day hold passes during which you are alerted daily and can cancel with one tap</li>
        </ul>

        <div className="mt-5 rounded-xl bg-[var(--amber-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--amber-ink)]">
          <strong>Nothing happens to your vault.</strong> Your vault stays encrypted; Lyfos still cannot read it. You can continue using Lyfos exactly as before.
        </div>

        <label className="mt-6 block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Personal instructions for your family</span>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Who to call first, where originals are kept, and anything your family should know before acting."
            disabled={!hasVaultKey || finalizing}
            className="mt-2 w-full rounded-xl border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] leading-5 outline-none focus:border-[var(--ink)] disabled:opacity-50"
          />
          <span className="mt-1.5 block text-[11px] leading-4 text-[var(--ink-4)]">Encrypted for the primary and backup only. It appears above the recovered vault when access is approved.</span>
        </label>

        <div className="mt-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Provisioning shares to</p>
          <ul className="mt-2 space-y-1">
            {acceptedHolders.map((h, i) => (
              <li key={h.id} className="flex items-center justify-between rounded-md bg-[var(--surface)] px-3 py-1.5 text-[12px]">
                <span>{i + 1}. {h.label}</span>
                <span className="text-[10px] text-[var(--ink-3)]">{h.holder_email}</span>
              </li>
            ))}
          </ul>
        </div>

        {!hasVaultKey && (
          <div className="mt-5 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[12px] font-medium text-[var(--red-2)]">
            Unlock your vault first. The unlock has to happen on this device so the key never leaves your browser.
          </div>
        )}

        <label className="mt-6 block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Type <strong>finalize</strong> to confirm</span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="finalize"
            disabled={!hasVaultKey || finalizing}
            className="mt-2 w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--ink)] disabled:opacity-50"
          />
        </label>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button onClick={onCancel} disabled={finalizing} className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)]">Cancel</button>
          <button
            onClick={() => onConfirm(instructions)}
            disabled={!ready || !hasVaultKey || finalizing}
            className="rounded-full bg-[#1d1d1f] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {finalizing ? "Sealing shares…" : "Activate plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyHolderRow({ slot, holder, onRevoke, onDelete, onResend, resending }) {
  return (
    <div className="border-b border-[var(--line)] px-4 py-3 last:border-b-0">
      <div className="grid grid-cols-[44px_1fr_1fr_112px] items-center gap-3">
        <div className="text-[12px] font-semibold text-[var(--ink-3)]">{slot?.slotNumber ?? ""}</div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-[var(--ink)]">{holder.label}</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">{slot?.roleLabel || "Trusted"}</div>
        </div>
        <div className="min-w-0 truncate text-[12px] text-[var(--ink-3)]">{holder.holder_email}</div>
        <div className="shrink-0 text-right"><KeyHolderStatusPill holder={holder} /></div>
      </div>

      {holder.status === "pending" && (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onResend}
              disabled={resending}
              className="text-[11px] font-medium text-[var(--ink-3)] underline-offset-2 hover:text-[var(--ink)] hover:underline disabled:opacity-50"
            >
              {resending ? "Creating fresh invite…" : "Resend and create fresh link"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end">
        <div className="flex items-center gap-4">
          {(["pending", "revoked"].includes(holder.status)) && (
            <button onClick={onDelete} className="text-[11px] font-medium text-[var(--red-2)] hover:underline">Delete</button>
          )}
          <button onClick={onRevoke} className="text-[11px] font-medium text-[var(--red-2)] hover:underline">Revoke</button>
        </div>
      </div>
    </div>
  );
}

function EmptyTrustSlot({ slot, onInvite, disabled }) {
  return (
    <div className="grid grid-cols-[44px_1fr_1fr_112px] items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
      <div className="text-[12px] font-semibold text-[var(--ink-3)]">{slot.slotNumber}</div>
      <div className="text-[13px] text-[var(--ink-4)]">Name</div>
      <div className="text-[13px] text-[var(--ink-4)]">Email address</div>
      <div className="text-right">
        <button
          onClick={onInvite}
          disabled={disabled}
          className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Invite
        </button>
      </div>
    </div>
  );
}

function KeyHolderStatusPill({ holder }) {
  const status = holder?.status;
  const displayStatus = status === "accepted" && holder?.release_pubkey ? "verified" : status;
  const deliveryTone = {
    queued: ["bg-[var(--amber-soft)] text-[var(--amber-ink)]", "Email queued"],
    sent: ["bg-[#007aff]/10 text-[#075985]", "Email sent"],
    delivered: ["bg-[#34c759]/20 text-[var(--green-ink)]", "Email delivered"],
    delayed: ["bg-[var(--amber-soft)] text-[var(--amber-ink)]", "Email delayed"],
    bounced: ["bg-[#ff453a]/8 text-[var(--red-2)]", "Email bounced"],
    suppressed: ["bg-[#ff453a]/8 text-[var(--red-2)]", "Email blocked"],
    failed: ["bg-[#ff453a]/8 text-[var(--red-2)]", "Email failed"]
  }[holder?.delivery_state];
  const tone = {
    pending:  ["bg-[var(--amber-soft)] text-[var(--amber-ink)]", "Pending invite"],
    accepted: ["bg-[#34c759]/10 text-[var(--green-ink)]", "Accepted"],
    verified: ["bg-[#34c759]/20 text-[var(--green-ink)]", "Verified"],
    revoked:  ["bg-[#ff453a]/8 text-[var(--red-2)]", "Revoked"]
  }[displayStatus] ?? ["bg-[var(--surface-3)] text-[var(--ink-2)]", displayStatus];
  const visibleTone = displayStatus === "pending" && deliveryTone ? deliveryTone : tone;
  return <span title={holder?.delivery_failure_reason || undefined} className={cx("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", visibleTone[0])}>{visibleTone[1]}</span>;
}

function InviteForm({ busy, occupiedRoles = [], onCancel, onSubmit }) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(() => !occupiedRoles.includes("primary")
    ? "primary"
    : !occupiedRoles.includes("backup") ? "backup" : "trusted");

  function submit(event) {
    event.preventDefault();
    onSubmit({ label, holderEmail: email, holderPhone: phone, role });
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">Invite a trusted nominee</p>
      <label className="mt-3 block">
        <span className="text-[11px] text-[var(--ink-3)]">Label</span>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          placeholder="Vikram Sharma (brother)"
          className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--ink)]"
        />
      </label>
      <fieldset className="mt-3">
        <legend className="text-[11px] text-[var(--ink-3)]">Role in recovery</legend>
        <div className="mt-1 grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-2)] p-1">
          {[
            ["primary", "Primary"],
            ["backup", "Backup"],
            ["trusted", "Trusted"]
          ].map(([value, text]) => {
            const occupied = value !== "trusted" && occupiedRoles.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRole(value)}
                disabled={occupied}
                className={cx(
                  "rounded-lg px-2 py-2 text-[11px] font-semibold transition",
                  role === value ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-3)]",
                  occupied && "cursor-not-allowed opacity-35"
                )}
              >
                {text}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-[var(--ink-4)]">
          Primary opens the recovered vault. Backup steps in only after review. Two other nominees must always help.
        </p>
      </fieldset>
      <label className="mt-3 block">
        <span className="text-[11px] text-[var(--ink-3)]">Their email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vikram@example.com"
          className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--ink)]"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-[11px] text-[var(--ink-3)]">Their phone <span className="text-[var(--ink-4)]">· optional, for SMS alerts</span></span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--ink)]"
        />
      </label>
      <div className="mt-5 flex items-center justify-between gap-2">
        <button type="button" onClick={onCancel} className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)]">Cancel</button>
        <button
          type="submit"
          disabled={busy || !label.trim() || !email.trim()}
          className="rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white transition hover:bg-black disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
    </form>
  );
}

function holderWhatsAppUrl(inviteUrl) {
  const msg = `I'm naming you as one of my trusted nominees/key holders on Lyfos — the people who could help my family recover everything if something ever happened to me. It takes two minutes to accept, and you never see anything while I'm fine.\n\n${inviteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function InviteFeedback({ feedback, onClose }) {
  async function copyLink() {
    try { await navigator.clipboard.writeText(feedback.inviteUrl); } catch {}
  }
  return (
    <div className="mt-4 rounded-2xl border border-[#34c759]/30 bg-[#34c759]/8 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={cx("text-[13px] font-medium", ["sent", "delivered"].includes(feedback.delivery?.status) ? "text-[var(--green-ink)]" : "text-[var(--amber-ink)]")}>
            {feedback.delivery?.status === "delivered"
              ? "Invite delivered."
              : feedback.delivery?.status === "sent" ? "Invite accepted by email provider." : "Invite created; email needs attention."}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--ink-2)]">
            Invited: <strong>{feedback.holderLabel}</strong> · {feedback.holderEmail}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--ink-3)]">
            {feedback.delivery?.message || "Share this link directly if needed — they should open it on their own device:"}
          </p>
          {feedback.inviteUrl && (
            <>
              <div className="mt-2 break-all rounded-md bg-[var(--surface-3)] px-3 py-2 font-mono text-[11px]">{feedback.inviteUrl}</div>
              <div className="mt-2.5 flex items-center gap-3">
                <a href={holderWhatsAppUrl(feedback.inviteUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-[#25d366] px-3.5 py-1.5 text-[11.5px] font-semibold text-white">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1a13 13 0 0 1-1.5-.5c-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.8-.9c.2-.2.4-.2.6-.1l2 .9c.2.1.4.2.4.3v.8z"/></svg>
                  Share on WhatsApp
                </a>
                <button onClick={copyLink} className="text-[11px] font-medium text-[var(--green-ink)] underline-offset-2 hover:underline">Copy link</button>
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className="shrink-0 text-[11px] text-[var(--ink-3)] hover:text-[var(--ink)]">Close</button>
      </div>
    </div>
  );
}

function ReleaseStat({ label, value, ok }) {
  return (
    <div>
      <div className={cx("text-[26px] font-semibold tracking-tight", ok ? "text-[var(--ink)]" : "text-[var(--ink-4)]")}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">{label}</div>
    </div>
  );
}

function ReleaseStepNav({ step, onStep }) {
  const steps = ["Nominee", "Keys", "Rules", "Preview", "Ready"];
  return (
    <div className="mt-10 flex justify-center">
      <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1">
        {steps.map((label, index) => {
          const id = index + 1;
          return (
            <button key={label} onClick={() => onStep(id)} className={cx("rounded-full px-3 py-1.5 text-[11px] font-semibold transition", step === id ? "bg-[#1d1d1f] text-white" : "text-[var(--ink-3)] hover:text-[var(--ink)]")}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReleasePanelLight({ subtitle, body, children }) {
  return (
    <div>
      <h3 className="text-[20px] font-semibold tracking-tight">{subtitle}</h3>
      <p className="mt-2 text-[13px] leading-5 text-[var(--ink-2)]">{body}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function RuleRow({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between py-3.5">
      <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{label}</span>
      <span className={cx("text-[14px] font-medium", tone === "warn" ? "text-[var(--red-2)]" : tone === "ok" ? "text-[var(--green-ink)]" : "text-[var(--ink)]")}>{value}</span>
    </div>
  );
}

function keyHolderLabel(holder, index) {
  const name = holder.split("-")[0].trim();
  if (!name) return `K${index + 1}`;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || `K${index + 1}`;
}

function RecoveryKeyPanel({ recoveryKey, recoveryConfirm, onGenerate, onConfirmChange }) {
  const isBip39 = recoveryKey && /\s/.test(recoveryKey);
  const words = useMemo(() => (isBip39 ? recoveryKey.split(/\s+/).filter(Boolean) : []), [recoveryKey, isBip39]);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [legacy, setLegacy] = useState("");

  // Three random word positions to confirm — proves the phrase was recorded,
  // without forcing all 24 words to be re-typed.
  const challenge = useMemo(() => {
    if (!isBip39 || words.length < 6) return [];
    const idx = new Set();
    while (idx.size < 3) idx.add(Math.floor(Math.random() * words.length));
    return [...idx].sort((a, b) => a - b);
  }, [recoveryKey, isBip39, words.length]);

  // Reset when a new phrase is generated.
  useEffect(() => { setAnswers(["", "", ""]); setLegacy(""); setSaved(false); onConfirmChange(""); }, [recoveryKey]);

  // Mark confirmed (set recoveryConfirm = the full key) only when the saved box
  // is checked AND the three challenged words match.
  useEffect(() => {
    if (!recoveryKey) return;
    if (!isBip39) { onConfirmChange(legacy.trim() ? legacy : ""); return; }
    const ok = saved && challenge.every((pos, i) => answers[i].trim().toLowerCase() === words[pos].toLowerCase());
    onConfirmChange(ok ? recoveryKey : "");
  }, [answers, saved, legacy, recoveryKey]);

  async function copy() {
    if (!recoveryKey) return;
    try { await copyToClipboardWithAutoClear(recoveryKey); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }
  function download() {
    if (!recoveryKey) return;
    const body = `Lyfos recovery phrase\n\nKeep this somewhere only you can reach — on paper is best.\nAnyone with this phrase can open your vault.\n\n${recoveryKey}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = "lyfos-recovery-phrase.txt"; a.click();
    URL.revokeObjectURL(url); setSaved(true);
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Recovery phrase</p>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--ink-2)]">
            {recoveryKey
              ? "Write these 24 words down and keep them offline. They are your backup key if the passphrase is ever forgotten."
              : "Generate a private backup key. It stays with you and gives you a way back if the passphrase is forgotten."}
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-1.5 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-black/[0.03]"
        >
          {recoveryKey ? "Regenerate" : "Generate"}
        </button>
      </div>

      {recoveryKey && (
        <div className="mt-4">
          {isBip39 ? (
            <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-4">
              {words.map((word, i) => (
                <div key={i} className="flex items-baseline gap-2 rounded-md bg-[var(--surface)] px-2 py-1.5">
                  <span className="w-5 text-right text-[10px] font-medium tabular-nums text-[var(--ink-4)]">{i + 1}</span>
                  <span className="select-all text-[13px] font-medium text-[var(--ink)]">{word}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="select-all break-words rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 font-mono text-xs font-semibold text-[var(--ink)]">
              {recoveryKey}
            </div>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={copy} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">{copied ? "Copied ✓" : "Copy"}</button>
            <button type="button" onClick={download} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--ink-2)] transition hover:text-[var(--ink)]">Download .txt</button>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-4)]">Store offline</span>
          </div>
          {isBip39 && (
            <p className="mt-3 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[12px] leading-5 text-[var(--ink-2)]">
              Next: save the phrase, tick the checkbox, then confirm three words.
            </p>
          )}

          {isBip39 ? (
            <div className="mt-4">
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
                <span className="text-[12.5px] text-[var(--ink-2)]">I've saved my recovery phrase somewhere safe.</span>
              </label>
              {saved && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Quick check — type these words</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {challenge.map((pos, i) => (
                      <label key={pos} className="block">
                        <span className="text-[10px] font-medium text-[var(--ink-4)]">Word #{pos + 1}</span>
                        <input
                          value={answers[i]}
                          onChange={(e) => setAnswers((a) => { const n = [...a]; n[i] = e.target.value; return n; })}
                          className="mt-1 h-9 w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-2.5 text-[13px] text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
                          autoComplete="off" spellCheck="false"
                        />
                      </label>
                    ))}
                  </div>
                  {recoveryConfirm === recoveryKey && <p className="mt-2 text-[12px] font-medium text-[var(--green-ink)]">Confirmed ✓</p>}
                </div>
              )}
            </div>
          ) : (
            <label className="mt-4 block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Confirm by re-typing</span>
              <input
                className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-4)] focus:border-[var(--ink)]"
                value={legacy}
                onChange={(event) => setLegacy(event.target.value)}
                placeholder="OS1A-…"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function ImportBackup({ currentRecord, onImported, onRestoreConfirmed }) {
  const [error, setError] = useState("");
  const [backupText, setBackupText] = useState("");
  const [backupName, setBackupName] = useState("");
  const [secret, setSecret] = useState("");
  const [mode, setMode] = useState("passphrase");
  const [preview, setPreview] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setPreview(null);
    try {
      const text = await file.text();
      setBackupText(text);
      setBackupName(file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      event.target.value = "";
    }
  }

  async function decryptPreview() {
    setError("");
    setBusy(true);
    try {
      const result = await createRestoreDryRun({ backupText, secret, mode, currentRecord });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      createPendingAuditEvent(localStorage, "Restore preview created");
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!preview?.ok) return;
    if (!canConfirmDestructiveRestore(confirmText)) return;
    const auditedVault = appendAuditEvent(appendAuditEvents(preview.vault, drainPendingAuditEvents(localStorage)), "Restore confirmed");
    const nextRecord = await updateEncryptedVault(preview.record, preview.vaultKey, auditedVault);
    saveStage1Record(localStorage, nextRecord);
    onImported(nextRecord);
    onRestoreConfirmed?.(nextRecord, preview.vaultKey, auditedVault);
    setBackupText("");
    setBackupName("");
    setSecret("");
    setConfirmText("");
    setPreview(null);
  }

  function refusePreview() {
    createPendingAuditEvent(localStorage, "Restore preview refused");
    setBackupText("");
    setBackupName("");
    setSecret("");
    setConfirmText("");
    setPreview(null);
    setError("");
  }

  return (
    <div>
      <label className="cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm transition hover:bg-[var(--surface-2)]">
        Practice restore preview
        <input className="hidden" type="file" accept="application/json,.json" onChange={importBackup} />
      </label>
      <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--ink-3)]">Preview decrypts a backup in memory so you can inspect its impact. Nothing is replaced until you complete the destructive confirmation.</p>
      {backupText && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[var(--line-2)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-2)]">Practice preview only</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{backupName}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-full bg-[var(--surface)] p-1">
            {[
              ["passphrase", "Phrase"],
              ["recovery", "Recovery"]
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold transition", mode === id ? "bg-[#1d1d1f] text-white" : "text-[var(--ink-2)]")}>{label}</button>
            ))}
          </div>
          <input className="mt-3 w-full rounded-2xl border border-[var(--line-2)] bg-[var(--surface)] px-4 py-3 text-sm outline-none focus:border-[#0071e3]" type={mode === "passphrase" ? "password" : "text"} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={mode === "passphrase" ? "Vault phrase for this backup" : "Recovery key for this backup"} />
          <button type="button" onClick={decryptPreview} disabled={busy || !secret.trim()} className="mt-3 w-full rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking..." : "Run practice preview"}</button>
        </div>
      )}
      {preview?.ok && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[#0071e3]/20 bg-[#0071e3]/8 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--blue)]">{preview.impactCopy.eyebrow}</p>
          <p className="mt-2 text-sm font-semibold text-[var(--blue)]">{preview.impactCopy.summary}</p>
          <p className="mt-2 text-xs leading-5 text-[var(--blue)]/80">{preview.impactCopy.unchanged}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <RestoreMetric label="Format" value={`v${preview.metadata.formatVersion}`} />
            <RestoreMetric label="Records" value={preview.metadata.recordCount} />
            <RestoreMetric label="Attachments" value={preview.metadata.attachmentCount} />
            <RestoreMetric label="Audit events" value={preview.metadata.auditEventCount} />
          </div>
          <div className="mt-3 rounded-2xl bg-[var(--surface-3)] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-2)]">Restore impact</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--ink-2)]">
              <span>Current records: {preview.impact.current?.recordCount ?? "locked"}</span>
              <span>Incoming records: {preview.impact.incoming.recordCount}</span>
              <span>Current attachments: {preview.impact.current?.attachmentCount ?? "locked"}</span>
              <span>Incoming attachments: {preview.impact.incoming.attachmentCount}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-2)]">{preview.impactCopy.destructiveWarning}</p>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--blue)]">Created {preview.metadata.createdAt ? new Date(preview.metadata.createdAt).toLocaleString() : "unknown"}. Updated {preview.metadata.updatedAt ? new Date(preview.metadata.updatedAt).toLocaleString() : "unknown"}.</p>
          <div className="mt-3 rounded-2xl border border-[#ff3b30]/20 bg-[#ff3b30]/8 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--red-2)]">Destructive replace</p>
            <p className="mt-2 text-xs leading-5 text-[var(--red-2)]">This is the only path that changes local vault data. Type the exact phrase below to continue.</p>
          </div>
          <label className="mt-3 block text-xs font-semibold text-[var(--red-2)]">
            Type {DESTRUCTIVE_RESTORE_CONFIRMATION} to confirm
            <input className="mt-2 w-full rounded-2xl border border-[#34c759]/20 bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)] outline-none" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={refusePreview} className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)]">Close preview without replacing</button>
            <button type="button" onClick={confirmRestore} disabled={!canConfirmDestructiveRestore(confirmText)} className="rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">Replace local vault</button>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-xs font-semibold text-[var(--red-2)]">{error}</div>}
    </div>
  );
}

function BackupVerificationPanel({ currentRecord, backupHealth, onBackupHealthChange }) {
  const [backupText, setBackupText] = useState("");
  const [backupName, setBackupName] = useState("");
  const [mode, setMode] = useState("passphrase");
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const healthCopy = getBackupHealthCopy(backupHealth);

  async function selectBackup(event) {
    const file = event.target.files?.[0];
    setResult(null);
    setSecret("");
    if (!file) return;

    try {
      setBackupText(await file.text());
      setBackupName(file.name);
    } catch {
      setBackupText("");
      setBackupName("");
      setResult({ ok: false, code: "invalid_shape", reason: "Lyfos could not read this backup file." });
    } finally {
      event.target.value = "";
    }
  }

  async function runVerification() {
    if (!backupText || !secret.trim()) return;
    setBusy(true);
    const verification = await verifyBackup({ backupText, secret, mode });
    setResult(verification);
    createPendingAuditEvent(localStorage, verification.ok ? "Backup verification succeeded" : "Backup verification failed");
    onBackupHealthChange?.(verification.ok
      ? markBackupVerified({
        health: backupHealth,
        verificationResult: verification,
        currentVault: { updatedAt: currentRecord?.updatedAt }
      })
      : markBackupVerificationFailed({
        health: backupHealth,
        reason: verification.code
      }));
    setBusy(false);
  }

  return (
    <div className="max-w-sm">
      <BackupHealthPanel copy={healthCopy} health={backupHealth} />
      <label className="cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm transition hover:bg-[var(--surface-2)]">
        Verify backup
        <input className="hidden" type="file" accept="application/json,.json" onChange={selectBackup} />
      </label>
      <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--ink-3)]">Verification decrypts a backup in memory to confirm it can open. It does not replace your local vault or prove the backup is current.</p>
      {backupText && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[var(--line-2)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-2)]">Verification only</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{backupName}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-full bg-[var(--surface)] p-1">
            {[
              ["passphrase", "Phrase"],
              ["recovery", "Recovery"]
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold transition", mode === id ? "bg-[#1d1d1f] text-white" : "text-[var(--ink-2)]")}>{label}</button>
            ))}
          </div>
          <input className="mt-3 w-full rounded-2xl border border-[var(--line-2)] bg-[var(--surface)] px-4 py-3 text-sm outline-none focus:border-[#0071e3]" type={mode === "passphrase" ? "password" : "text"} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={mode === "passphrase" ? "Vault phrase for this backup" : "Recovery key for this backup"} />
          <button type="button" onClick={runVerification} disabled={busy || !secret.trim()} className="mt-3 w-full rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Verifying..." : "Verify without restoring"}</button>
        </div>
      )}
      {result?.ok && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[#34c759]/20 bg-[#34c759]/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--green-ink)]">Backup opens</p>
          <p className="mt-2 text-sm font-semibold text-[var(--green-ink)]">This file decrypted successfully. It has not replaced your local vault.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <RestoreMetric label="Format" value={result.formatLabel.replace(" encrypted backup manifest", "")} />
            <RestoreMetric label="Records" value={result.metadata.recordCount} />
            <RestoreMetric label="Attachments" value={result.metadata.attachmentCount} />
            <RestoreMetric label="Audit events" value={result.metadata.auditEventCount} />
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--green-ink)]">Verification does not mean this backup is the newest copy. Backup health comes in the next stage.</p>
        </div>
      )}
      {result && !result.ok && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[#ff3b30]/20 bg-[#ff3b30]/8 p-4 text-sm font-semibold text-[var(--red-2)]">
          {verificationErrorCopy(result)}
        </div>
      )}
    </div>
  );
}

function BackupHealthPanel({ copy, health }) {
  const status = health?.status;
  const reminder = getBackupReminderCopy(health);
  const tone = status === "verified_current"
    ? "border-[#34c759]/20 bg-[#34c759]/10 text-[var(--green-ink)]"
    : status === "verified_stale" || status === "verification_failed"
      ? "border-[#ff9500]/25 bg-[#ff9500]/10 text-[var(--amber-ink)]"
      : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink)]";

  return (
    <div className={cx("mb-3 rounded-[1.25rem] border p-4", tone)}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">{copy.eyebrow}</p>
      <h3 className="mt-2 text-base font-semibold">{copy.title}</h3>
      <p className="mt-2 text-xs leading-5 opacity-75">{copy.body}</p>
      {reminder.level === "stale" && (
        <div className="mt-3 rounded-2xl bg-[var(--surface-3)] p-3">
          <p className="text-xs font-semibold">{reminder.title}</p>
          <p className="mt-1 text-xs leading-5 opacity-75">{reminder.body}</p>
        </div>
      )}
      <p className="mt-3 text-xs font-semibold">Next: {copy.primaryAction}</p>
    </div>
  );
}

function verificationErrorCopy(result) {
  if (result.code === "wrong_secret") return "This backup did not open with that phrase or recovery key. No local vault data was changed.";
  if (result.code === "corrupted_payload") return "This backup appears damaged or unreadable. Lyfos did not change your local vault.";
  if (result.code === "unsupported_version") return "This backup format is not supported by this version. No local vault data was changed.";
  return "This does not look like a valid Lyfos encrypted backup. No local vault data was changed.";
}

function restoreEraCopy(era) {
  if (era === "newer") return "This backup appears newer than the current local vault.";
  if (era === "older") return "This backup appears older than the current local vault.";
  if (era === "same-era") return "This backup appears from the same time window as the current local vault.";
  return "Lyfos can verify this backup, but cannot compare its age to the current local vault.";
}

function RestoreMetric({ label, value }) {
  return (
    <div className="rounded-2xl bg-[var(--surface-3)] p-3">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-2)]">{label}</span>
      <strong className="mt-1 block text-lg text-[var(--ink)]">{value}</strong>
    </div>
  );
}

initTelemetry();
registerServiceWorker();
function ThemeToggle() {
  const [theme, setTheme] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("lyfos-theme")) === "dark" ? "dark" : "light");
  useEffect(() => {
    document.body.dataset.theme = theme;
    try { localStorage.setItem("lyfos-theme", theme); } catch {}
  }, [theme]);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      aria-label="Switch theme"
      title={dark ? "Switch to light" : "Switch to dark"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="fixed right-4 top-4 z-30 grid h-9 w-9 place-items-center rounded-full border border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)] shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition hover:text-[var(--ink)]"
    >
      {dark ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2 V4 M12 20 V22 M4 12 H2 M22 12 H20 M5 5 l1.5 1.5 M17.5 17.5 L19 19 M19 5 l-1.5 1.5 M6.5 17.5 L5 19" /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8 A9 9 0 1 1 11.2 3 a7 7 0 0 0 9.8 9.8 Z" /></svg>
      )}
    </button>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Lyfos crashed:", error, info?.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--ink)]">
        <div className="w-full max-w-sm rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] bg-[var(--amber-soft)]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--amber-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          </div>
          <h1 className="mt-5 text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-[14px] leading-6 text-[var(--ink-2)]">
            Lyfos hit an unexpected error. Your vault stays encrypted on this device — nothing was sent anywhere or lost. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 h-12 w-full rounded-full bg-[var(--accent)] text-[15px] font-semibold text-white transition hover:bg-[var(--accent-hover)]"
          >
            Reload Lyfos
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(<ErrorBoundary><App /><ThemeToggle /></ErrorBoundary>);

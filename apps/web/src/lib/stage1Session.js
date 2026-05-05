import { sanitizeAuditEvent } from "./stage1Audit.js";

export const AUTO_LOCK_MS = 5 * 60 * 1000;
export const DEFAULT_AUTO_LOCK_MS = AUTO_LOCK_MS;
export const PENDING_AUDIT_KEY = "os-one.stage1.pending-audit.v1";
export const AUTO_LOCK_POLICY_KEY = "os-one.stage1.auto-lock-ms.v1";
export const LOCK_TIMEOUT_OPTIONS = [
  { label: "1 minute", ms: 60 * 1000 },
  { label: "5 minutes", ms: 5 * 60 * 1000 },
  { label: "15 minutes", ms: 15 * 60 * 1000 },
  { label: "30 minutes", ms: 30 * 60 * 1000 }
];

export function shouldAutoLockForActivity(lastActivityAt, now = Date.now(), timeoutMs = AUTO_LOCK_MS) {
  return now - lastActivityAt >= timeoutMs;
}

export function shouldLockForVisibility(visibilityState) {
  return visibilityState === "hidden";
}

export function loadAutoLockPolicy(storage = globalThis.localStorage) {
  const raw = Number(storage.getItem(AUTO_LOCK_POLICY_KEY));
  return LOCK_TIMEOUT_OPTIONS.some((option) => option.ms === raw) ? raw : DEFAULT_AUTO_LOCK_MS;
}

export function saveAutoLockPolicy(storage = globalThis.localStorage, timeoutMs) {
  const next = LOCK_TIMEOUT_OPTIONS.some((option) => option.ms === Number(timeoutMs))
    ? Number(timeoutMs)
    : DEFAULT_AUTO_LOCK_MS;
  storage.setItem(AUTO_LOCK_POLICY_KEY, String(next));
  return next;
}

export function getAutoLockLabel(timeoutMs) {
  return LOCK_TIMEOUT_OPTIONS.find((option) => option.ms === Number(timeoutMs))?.label ?? "5 minutes";
}

export function formatLockReason(reason) {
  if (reason === "Auto-lock after inactivity") return "Locked after inactivity. Decrypted vault state was cleared from this session.";
  if (reason === "Auto-lock after app moved to background") return "Locked because the app moved to the background. Decrypted vault state was cleared from this session.";
  return "Locked manually. Decrypted vault state was cleared from this session.";
}

export function createPendingAuditEvent(storage = globalThis.localStorage, event) {
  const events = readPendingAuditEvents(storage);
  const nextEvent = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    event: sanitizeAuditEvent(event),
    at: new Date().toISOString()
  };
  storage.setItem(PENDING_AUDIT_KEY, JSON.stringify([nextEvent, ...events].slice(0, 25)));
  return nextEvent;
}

export function drainPendingAuditEvents(storage = globalThis.localStorage) {
  const events = readPendingAuditEvents(storage);
  storage.removeItem(PENDING_AUDIT_KEY);
  return events;
}

function readPendingAuditEvents(storage) {
  try {
    const raw = storage.getItem(PENDING_AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

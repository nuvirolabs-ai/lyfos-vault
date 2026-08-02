export const CIRCLE_ROLES = Object.freeze({
  PRIMARY: "primary",
  BACKUP: "backup",
  TRUSTED: "trusted"
});

const READY_HOLDER_STATES = new Set(["accepted", "verified"]);
const TERMINAL_RECOVERY_STATES = new Set(["rejected", "aborted", "expired", "opened"]);

const RECOVERY_TRANSITIONS = Object.freeze({
  draft: { submit_evidence: "under_review", abort: "aborted" },
  under_review: { approve: "collecting_support", reject: "rejected", abort: "aborted" },
  collecting_support: { threshold_met: "holding", abort: "aborted", expire: "expired" },
  holding: { hold_complete: "ready_to_recover", abort: "aborted", expire: "expired" },
  ready_to_recover: { open: "opened", abort: "aborted", expire: "expired" }
});

const DELIVERY_EVENT_STATES = Object.freeze({
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.suppressed": "suppressed",
  "email.failed": "failed"
});

export function validateCircleForActivation(holders = []) {
  const active = holders.filter((holder) => holder?.status !== "revoked");
  if (active.length !== 5) return { ok: false, reason: "The circle needs exactly five nominees." };
  if (active.filter((holder) => holder.role === CIRCLE_ROLES.PRIMARY).length !== 1) {
    return { ok: false, reason: "Choose exactly one primary nominee." };
  }
  if (active.filter((holder) => holder.role === CIRCLE_ROLES.BACKUP).length !== 1) {
    return { ok: false, reason: "Choose exactly one backup nominee." };
  }
  if (active.some((holder) => !READY_HOLDER_STATES.has(holder.status) || !holder.release_pubkey)) {
    return { ok: false, reason: "All five nominees must accept and create recovery keys." };
  }
  return { ok: true, reason: "" };
}

export function countValidSupport({ recipientHolderId, approvals = [] } = {}) {
  return new Set(
    approvals
      .map((approval) => approval?.holderId ?? approval?.key_holder_id)
      .filter((holderId) => holderId && holderId !== recipientHolderId)
  ).size;
}

export function canStartRecovery({ role, kind } = {}) {
  return (kind === "normal" && role === CIRCLE_ROLES.PRIMARY)
    || (kind === "backup" && role === CIRCLE_ROLES.BACKUP);
}

export function canSupportRecovery({ holderId, recipientHolderId, state } = {}) {
  return Boolean(holderId)
    && holderId !== recipientHolderId
    && state === "collecting_support";
}

export function nextRecoveryState(currentState, event) {
  if (TERMINAL_RECOVERY_STATES.has(currentState)) {
    throw new Error(`Invalid recovery transition from terminal state "${currentState}"`);
  }
  const next = RECOVERY_TRANSITIONS[currentState]?.[event];
  if (!next) throw new Error(`Invalid recovery transition: ${currentState} + ${event}`);
  return next;
}

export function reduceDeliveryState(currentState, eventType) {
  return DELIVERY_EVENT_STATES[eventType] ?? currentState;
}

export function mergeLatestInviteDeliveries(holders = [], deliveries = []) {
  const latestByHolder = new Map();
  for (const delivery of deliveries) {
    const holderId = delivery?.related_holder_id;
    if (!holderId) continue;
    const current = latestByHolder.get(holderId);
    const attempt = Number(delivery.attempt) || 0;
    const currentAttempt = Number(current?.attempt) || 0;
    const isNewerAttempt = attempt > currentAttempt;
    const isNewerUpdateForSameAttempt = attempt === currentAttempt
      && String(delivery.updated_at ?? "") > String(current?.updated_at ?? "");
    if (!current || isNewerAttempt || isNewerUpdateForSameAttempt) {
      latestByHolder.set(holderId, delivery);
    }
  }
  return holders.map((holder) => {
    const delivery = latestByHolder.get(holder.id);
    return {
      ...holder,
      delivery_state: delivery?.state ?? null,
      delivery_failure_reason: delivery?.failure_reason ?? null,
      delivery_updated_at: delivery?.updated_at ?? null
    };
  });
}

export function createRecoveredVaultViewModel(vault = {}) {
  const {
    ownerSettings: _ownerSettings,
    settings: _settings,
    releaseSettings: _releaseSettings,
    devices: _devices,
    billing: _billing,
    subscription: _subscription,
    ...vaultContents
  } = vault;
  const items = [...(Array.isArray(vault.items) ? vault.items : [])].sort((left, right) => {
    const leftPinned = left?.type === "emergency_instruction" ? 1 : 0;
    const rightPinned = right?.type === "emergency_instruction" ? 1 : 0;
    return rightPinned - leftPinned;
  });
  return {
    ...vaultContents,
    items,
    recovered: true,
    readOnly: true,
    capabilities: {
      reveal: true,
      copy: true,
      downloadAttachments: true,
      mutate: false,
      sync: false,
      ownerSettings: false
    }
  };
}

const SENSITIVE_RECOVERY_FIELDS = new Set(["secret", "bankDetails", "cardDetails"]);

export function isSensitiveRecoveredField(fieldName) {
  return SENSITIVE_RECOVERY_FIELDS.has(fieldName);
}

export function filterRecoveredItems(items = [], query = "") {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => [item?.title, item?.type?.replaceAll("_", " "), item?.username, item?.email, item?.notes]
    .some((value) => String(value ?? "").toLowerCase().includes(needle)));
}

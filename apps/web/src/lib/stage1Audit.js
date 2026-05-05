const MAX_AUDIT_EVENTS = 100;

export function appendAuditEvent(vault, event) {
  const safeEvent = sanitizeAuditEvent(event);
  return {
    ...vault,
    audit: [
      {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        event: safeEvent,
        at: new Date().toISOString()
      },
      ...(vault.audit ?? [])
    ].slice(0, MAX_AUDIT_EVENTS)
  };
}

export function getRecentAuditEvents(vault, limit = 6) {
  return (vault.audit ?? []).slice(0, limit);
}

export function appendAuditEvents(vault, events) {
  return events.reduce((current, event) => appendAuditEvent(current, event.event ?? event), vault);
}

export function sanitizeAuditEvent(event) {
  return String(event ?? "Vault event")
    .replace(/:.+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "Vault event";
}

export function parseAuditEvent(event) {
  const name = sanitizeAuditEvent(event.event);
  const base = {
    id: event.id,
    at: event.at,
    actor: "Owner",
    action: name,
    reason: "User action",
    group: "Vault activity"
  };

  if (name.includes("Failed unlock")) {
    return { ...base, actor: "Unknown", action: "Failed unlock", reason: "Incorrect phrase or recovery key", group: "Session security" };
  }
  if (name === "Manual lock") {
    return { ...base, actor: "Owner", action: "Locked vault", reason: "Manual seal", group: "Session security" };
  }
  if (name === "Auto-lock after inactivity") {
    return { ...base, actor: "OS-One", action: "Locked vault", reason: "Inactivity timeout", group: "Session security" };
  }
  if (name === "Auto-lock after app moved to background") {
    return { ...base, actor: "OS-One", action: "Locked vault", reason: "App moved to background", group: "Session security" };
  }
  if (name.includes("unlocked")) {
    return { ...base, actor: "Owner", action: "Unlocked vault", reason: name.includes("recovery") ? "Recovery key used" : "Vault phrase used", group: "Session security" };
  }
  if (name === "Recovery key replaced") {
    return { ...base, actor: "Owner", action: "Recovery key replaced", reason: "Recovery envelope rotated while vault was unlocked", group: "Session security" };
  }
  if (name === "Backup verification succeeded") {
    return { ...base, action: "Backup verification succeeded", reason: "Encrypted backup decrypted for verification only", group: "Backup and restore" };
  }
  if (name === "Backup verification failed") {
    return { ...base, action: "Backup verification failed", reason: "Verification failed without changing local vault", group: "Backup and restore" };
  }
  if (name === "Restore preview created") {
    return { ...base, action: "Restore preview created", reason: "Backup decrypted for practice preview only", group: "Backup and restore" };
  }
  if (name === "Restore preview refused") {
    return { ...base, action: "Restore preview refused", reason: "Preview closed without replacing local vault", group: "Backup and restore" };
  }
  if (name === "Restore confirmed") {
    return { ...base, action: "Restore confirmed", reason: "Local vault replaced after typed confirmation", group: "Backup and restore" };
  }
  if (name.includes("backup") || name.includes("Backup") || name.includes("Restore") || name.includes("restore")) {
    return { ...base, action: name, reason: "Encrypted backup flow", group: "Backup and restore" };
  }
  if (name.includes("Attachment") || name.includes("Record") || name.includes("Sensitive value")) {
    return { ...base, action: name, reason: name.includes("Sensitive value") ? "Screen privacy action" : "Vault content change", group: "Records and attachments" };
  }

  return base;
}

export function getAuditGroups(vault, limit = 18) {
  const orderedLabels = ["Session security", "Records and attachments", "Backup and restore", "Vault activity"];
  const parsed = getRecentAuditEvents(vault, limit).map(parseAuditEvent);
  return orderedLabels
    .map((label) => ({ label, events: parsed.filter((event) => event.group === label) }))
    .filter((group) => group.events.length > 0);
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const EXPLICIT_STALE_REASONS = new Set(["record_change", "attachment_change", "recovery_key_replaced"]);

export function isBackupStale({ currentVaultUpdatedAt, lastVerifiedVaultUpdatedAt, lastVaultChangeReason } = {}) {
  if (EXPLICIT_STALE_REASONS.has(lastVaultChangeReason)) return true;
  if (!currentVaultUpdatedAt || !lastVerifiedVaultUpdatedAt) return false;
  return new Date(currentVaultUpdatedAt).getTime() - new Date(lastVerifiedVaultUpdatedAt).getTime() > STALE_AFTER_MS;
}

export function getBackupReminderLevel(health) {
  if (health?.status === "verified_stale") return "stale";
  if (health?.status === "exported_unverified") return "verify";
  if (health?.status === "verification_failed") return "failed";
  return "none";
}

export function getBackupReminderCopy(health) {
  const level = getBackupReminderLevel(health);
  if (level === "stale") {
    return {
      level,
      title: "Backup is not current",
      body: staleBody(health?.lastVaultChangeReason),
      primaryAction: "Export fresh backup"
    };
  }
  if (level === "verify") {
    return {
      level,
      title: "Backup needs verification",
      body: "A backup was exported, but it has not been opened in a verification check yet.",
      primaryAction: "Verify backup"
    };
  }
  if (level === "failed") {
    return {
      level,
      title: "Backup verification needs attention",
      body: "The last selected backup did not verify. Your local vault was not changed.",
      primaryAction: "Try another file"
    };
  }
  return {
    level: "none",
    title: "No backup reminder",
    body: "No backup action is needed from this state.",
    primaryAction: null
  };
}

function staleBody(reason) {
  if (reason === "attachment_change") {
    return "Your vault has attachment changes after the last verified backup. The backup is not current; export a fresh encrypted backup when ready.";
  }
  if (reason === "record_change") {
    return "Your vault has record changes after the last verified backup. The backup is not current; export a fresh encrypted backup when ready.";
  }
  if (reason === "recovery_key_replaced") {
    return "Your recovery key changed after the last verified backup. The backup is not current; export a fresh encrypted backup when ready.";
  }
  return "Your vault changed after the last verified backup. The backup is not current; export a fresh encrypted backup when ready.";
}

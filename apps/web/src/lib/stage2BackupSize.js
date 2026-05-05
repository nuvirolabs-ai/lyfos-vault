export const BACKUP_SIZE_SOFT_THRESHOLD_BYTES = 20 * 1024 * 1024;
export const BACKUP_SIZE_STRONG_THRESHOLD_BYTES = 100 * 1024 * 1024;

export function getBackupSizeWarning({
  encryptedPayloadBytes = 0,
  encryptedAttachmentBytes = 0
} = {}) {
  const payloadBytes = normalizeByteCount(encryptedPayloadBytes);
  const attachmentBytes = normalizeByteCount(encryptedAttachmentBytes);
  const totalBytes = payloadBytes + attachmentBytes;

  if (totalBytes >= BACKUP_SIZE_STRONG_THRESHOLD_BYTES) {
    return {
      level: "strong",
      totalBytes,
      copy: `This is a large encrypted backup (${formatBackupSize(totalBytes)}). Export will continue, but the file may need more time and storage to move or store.`
    };
  }

  if (totalBytes >= BACKUP_SIZE_SOFT_THRESHOLD_BYTES) {
    return {
      level: "soft",
      totalBytes,
      copy: `This encrypted backup is ${formatBackupSize(totalBytes)}. Export will continue, but it may take longer to move or store.`
    };
  }

  return {
    level: "none",
    totalBytes,
    copy: ""
  };
}

export function formatBackupSize(bytes) {
  const normalizedBytes = normalizeByteCount(bytes);
  if (normalizedBytes < 1024) return `${normalizedBytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = normalizedBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${units[unitIndex]}`;
}

function normalizeByteCount(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

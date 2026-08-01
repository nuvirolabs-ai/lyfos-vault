export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

const ACCEPTED_MIME_PREFIXES = ["image/"];
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const ACCEPTED_EXTENSIONS = /\.(pdf|png|jpe?g|webp|gif|txt|csv|md|doc|docx)$/i;

export function validateAttachmentFile(file) {
  if (!file?.name) return { ok: false, reason: "Attachment is missing a filename." };
  if ((file.size ?? 0) > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: `${file.name} is larger than 2 MB. Add a smaller proof file for this local vault.` };
  }
  const type = file.type || "";
  const typeAccepted = ACCEPTED_MIME_TYPES.has(type) || ACCEPTED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix));
  const extensionAccepted = ACCEPTED_EXTENSIONS.test(file.name);
  if (!typeAccepted && !extensionAccepted) {
    return { ok: false, reason: `${file.name} is not supported. Use PDF, image, text, CSV, Markdown, DOC, or DOCX.` };
  }
  return { ok: true };
}

export function normalizeAttachmentName(name, existingNames = []) {
  const cleanName = String(name ?? "attachment").replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "attachment";
  if (!existingNames.includes(cleanName)) return cleanName;

  const extensionMatch = cleanName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const base = extension ? cleanName.slice(0, -extension.length) : cleanName;
  let counter = 2;
  let candidate = `${base}-${counter}${extension}`;
  while (existingNames.includes(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}${extension}`;
  }
  return candidate;
}

export function makeAttachment(fileLike, existingNames = []) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    name: normalizeAttachmentName(fileLike.name, existingNames),
    type: fileLike.type || "application/octet-stream",
    size: fileLike.size ?? 0,
    dataUrl: fileLike.dataUrl,
    addedAt: new Date().toISOString()
  };
}

export function addAttachmentToRecord(record, fileLike) {
  const attachments = record.attachments ?? [];
  return {
    ...record,
    attachments: [...attachments, makeAttachment(fileLike, attachments.map((attachment) => attachment.name))]
  };
}

export function deleteAttachmentFromRecord(record, attachmentId) {
  return {
    ...record,
    attachments: (record.attachments ?? []).filter((attachment) => attachment.id !== attachmentId)
  };
}

export function replaceAttachmentOnRecord(record, attachmentId, fileLike) {
  const attachments = record.attachments ?? [];
  const existingNames = attachments.filter((attachment) => attachment.id !== attachmentId).map((attachment) => attachment.name);
  return {
    ...record,
    attachments: attachments.map((attachment) => (
      attachment.id === attachmentId ? makeAttachment(fileLike, existingNames) : attachment
    ))
  };
}

export function revokeAttachmentPreviews(attachments = [], revoke = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)) {
  if (!revoke) return;
  for (const attachment of attachments) {
    if (typeof attachment?.dataUrl === "string" && attachment.dataUrl.startsWith("blob:")) {
      revoke(attachment.dataUrl);
    }
  }
}

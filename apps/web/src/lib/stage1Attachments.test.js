import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_BYTES,
  addAttachmentToRecord,
  deleteAttachmentFromRecord,
  normalizeAttachmentName,
  replaceAttachmentOnRecord,
  revokeAttachmentPreviews,
  validateAttachmentFile
} from "./stage1Attachments.js";

function fileLike(overrides = {}) {
  return {
    name: "passport.pdf",
    type: "application/pdf",
    size: 1200,
    dataUrl: "data:application/pdf;base64,AAAA",
    ...overrides
  };
}

test("validates large and unsupported attachment files", () => {
  assert.equal(validateAttachmentFile(fileLike()).ok, true);
  assert.equal(validateAttachmentFile(fileLike({ size: MAX_ATTACHMENT_BYTES + 1 })).ok, false);
  assert.match(validateAttachmentFile(fileLike({ type: "application/x-msdownload", name: "run.exe" })).reason, /not supported/i);
});

test("normalizes duplicate attachment names", () => {
  assert.equal(normalizeAttachmentName("passport.pdf", ["passport.pdf"]), "passport-2.pdf");
  assert.equal(normalizeAttachmentName("passport.pdf", ["passport.pdf", "passport-2.pdf"]), "passport-3.pdf");
});

test("adds, deletes, and replaces attachments without leaking stale entries", () => {
  const record = { id: "r1", attachments: [] };
  const added = addAttachmentToRecord(record, fileLike());
  const duplicated = addAttachmentToRecord(added, fileLike());
  const replaced = replaceAttachmentOnRecord(duplicated, duplicated.attachments[0].id, fileLike({ name: "new-passport.png", type: "image/png" }));
  const deleted = deleteAttachmentFromRecord(replaced, duplicated.attachments[1].id);

  assert.equal(added.attachments.length, 1);
  assert.equal(duplicated.attachments[1].name, "passport-2.pdf");
  assert.equal(replaced.attachments[0].name, "new-passport.png");
  assert.equal(deleted.attachments.length, 1);
  assert.equal(deleted.attachments[0].name, "new-passport.png");
});

test("revokes object URL previews on cleanup without touching data URLs", () => {
  const revoked = [];
  const attachments = [
    fileLike({ dataUrl: "blob:http://local/one" }),
    fileLike({ dataUrl: "data:text/plain;base64,AAAA" })
  ];

  revokeAttachmentPreviews(attachments, (url) => revoked.push(url));

  assert.deepEqual(revoked, ["blob:http://local/one"]);
});

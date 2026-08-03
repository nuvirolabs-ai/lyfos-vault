import { attachmentKind } from "../../lib/stage1Attachments.js";

// Read-only when onAdd/onDelete are omitted (record detail screen);
// editable when both are supplied (create/edit form) — same on/off
// pattern the older AttachmentGrid uses for onDelete/onReplace.
export default function AttachmentList({ attachments, onAdd, onDelete, busy }) {
  const editable = Boolean(onAdd);

  return (
    <div className="space-y-2">
      {attachments.length === 0 ? (
        <p className="text-[13px] text-[var(--ink-3)]">No files attached yet.</p>
      ) : (
        attachments.map((attachment) => (
          <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-[var(--ink)]">{attachment.name}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--ink-3)]">{attachmentKind(attachment)} · {Math.max(1, Math.round((attachment.size ?? 0) / 1024))} KB</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <a href={attachment.dataUrl} download={attachment.name} className="rounded-full border border-[var(--line-2)] px-3 py-1 text-[11px] font-semibold text-[var(--ink)]">Open</a>
              {editable && (
                <button type="button" onClick={() => onDelete(attachment.id)} className="rounded-full border border-[#ff3b30]/20 px-3 py-1 text-[11px] font-semibold text-[var(--red-2)]">Delete</button>
              )}
            </div>
          </div>
        ))
      )}
      {editable && (
        <label className="inline-block cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2 text-[12px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]">
          {busy ? "Adding…" : "Add a file"}
          <input
            className="hidden"
            type="file"
            multiple
            disabled={busy}
            accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,application/pdf"
            onChange={(event) => {
              if (event.target.files?.length) onAdd(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

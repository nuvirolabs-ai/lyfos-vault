export default function LegacyEmptyState({ title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-10 text-center">
      <p className="text-[14px] font-medium text-[var(--ink)]">{title}</p>
      {body && <p className="mt-2 text-[13px] text-[var(--ink-3)]">{body}</p>}
    </div>
  );
}

import { getCategory } from "@os-one/digital-legacy";
import ServiceIcon from "./ServiceIcon.jsx";

export default function PriorityActions({ actions, records, onOpenRecord, suggestedCategory, onOpenCategory }) {
  if (!actions.length) {
    if (suggestedCategory) {
      return (
        <button
          onClick={() => onOpenCategory(suggestedCategory.id)}
          className="flex w-full items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface-2)]"
        >
          <ServiceIcon iconKey={suggestedCategory.iconKey} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-[var(--ink)]">Set up {suggestedCategory.name} next.</span>
            <span className="mt-0.5 block text-[12px] text-[var(--ink-3)]">Keeps your coverage moving forward.</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-[var(--ink-4)]">›</span>
        </button>
      );
    }
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--line-2)] p-6 text-center">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--green-soft)] text-[var(--green-ink)]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </span>
        <p className="text-[13px] font-medium text-[var(--ink)]">All clear.</p>
        <p className="text-[12px] text-[var(--ink-3)]">Every category's been looked at, and nothing needs fixing.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {actions.map((action) => {
        const record = records.find((r) => r.id === action.recordId);
        const category = record ? getCategory(record.categoryId) : null;
        return (
          <button
            key={action.recordId}
            onClick={() => onOpenRecord(action.recordId)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface-2)]"
          >
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-[var(--ink)]">{action.message}</span>
              {category && <span className="mt-0.5 block text-[11px] text-[var(--ink-3)]">{category.name}</span>}
            </span>
            <span aria-hidden="true" className="shrink-0 text-[var(--ink-4)]">›</span>
          </button>
        );
      })}
    </div>
  );
}

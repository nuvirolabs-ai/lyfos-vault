import { getCategory } from "@os-one/digital-legacy";

export default function PriorityActions({ actions, records, onOpenRecord }) {
  if (!actions.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-6 text-center text-[13px] text-[var(--ink-3)]">
        Nothing needs attention right now.
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

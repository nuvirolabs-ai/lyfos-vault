import ServiceIcon from "./ServiceIcon.jsx";

const TONE_CLASSES = {
  protected: "text-[var(--green-ink)]",
  attention: "text-[var(--amber-ink)]",
  neutral: "text-[var(--ink-3)]",
  muted: "text-[var(--ink-4)]"
};

// Populated categories get a tinted card so status reads at a glance
// (color, not just label text) — empty ones stay quiet so real data
// stands out in the grid, per the "keep the grid, just quieter" call.
const CARD_TONE_CLASSES = {
  protected: "border-[var(--green-soft)] bg-[var(--green-soft)]/40",
  attention: "border-[var(--amber-soft,#f3e2c4)] bg-[var(--amber-soft,#fdf4e3)]/50",
  neutral: "border-[var(--line)] bg-[var(--surface)] opacity-70",
  muted: "border-[var(--line)] bg-[var(--surface)] opacity-50"
};

// Fixed height with an always-reserved second row (invisible when
// unused) — so every card in the grid is the same height whether or
// not "Mark not applicable" is showing, and rows line up cleanly.
export default function CategoryCard({ category, recordCount, state, onClick, onMarkNotApplicable }) {
  return (
    <div className={`flex h-[86px] flex-col justify-between rounded-2xl border px-4 py-3 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-[var(--line-2)] hover:opacity-100 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] active:translate-y-0 ${CARD_TONE_CLASSES[state.tone] ?? CARD_TONE_CLASSES.neutral}`}>
      <button onClick={onClick} className="flex flex-1 items-center gap-3 text-left">
        <ServiceIcon iconKey={category.iconKey} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{category.name}</span>
          <span className="mt-0.5 block text-[11px] text-[var(--ink-3)]">{recordCount ? `${recordCount} record${recordCount === 1 ? "" : "s"}` : "No records yet"}</span>
        </span>
        <span className={`shrink-0 text-[11px] font-semibold ${TONE_CLASSES[state.tone] ?? TONE_CLASSES.neutral}`}>
          {state.label} <span aria-hidden="true">›</span>
        </span>
      </button>
      <button
        onClick={onMarkNotApplicable}
        tabIndex={onMarkNotApplicable ? 0 : -1}
        aria-hidden={onMarkNotApplicable ? undefined : "true"}
        className={`self-start pl-[52px] text-left text-[11px] font-medium text-[var(--ink-3)] underline decoration-dotted hover:text-[var(--ink)] ${onMarkNotApplicable ? "" : "invisible"}`}
      >
        Mark not applicable
      </button>
    </div>
  );
}

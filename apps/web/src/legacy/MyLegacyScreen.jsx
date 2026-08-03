import { useMemo } from "react";
import { LEGACY_CATEGORIES, calculateDigitalLegacyScore, createPriorityActions, getCategory } from "@os-one/digital-legacy";
import { DIGITAL_LEGACY_FEATURE_FLAGS } from "./featureFlags.js";
import LegacyScore from "./components/LegacyScore.jsx";
import PriorityActions from "./components/PriorityActions.jsx";
import CategoryCard from "./components/CategoryCard.jsx";

// Category-card status is a fresh, small rollup over Digital Legacy
// record status — it is NOT the deprecated vault-item completion
// algorithm the assessment says must not be reused as this score
// (docs/LYFOS_DIGITAL_LEGACY_ASSESSMENT.md §"Current vault model").
const ATTENTION_ORDER = ["action_required", "incomplete", "needs_review", "started"];

function categoryState(recordsInCategory, reviewEntry) {
  if (recordsInCategory.length === 0) {
    return reviewEntry?.state === "not_applicable"
      ? { tone: "muted", label: "Not applicable" }
      : { tone: "neutral", label: "Needs setup" };
  }
  for (const status of ATTENTION_ORDER) {
    if (recordsInCategory.some((r) => r.status === status)) {
      return { tone: "attention", label: status === "needs_review" ? "Review due" : "Needs details" };
    }
  }
  return { tone: "protected", label: "Protected" };
}

export default function MyLegacyScreen({ digitalLegacy, onOpenCategory, onOpenRecord, onMarkNotApplicable }) {
  const activeRecords = useMemo(() => digitalLegacy.records.filter((r) => r.status !== "archived"), [digitalLegacy]);
  const score = useMemo(() => calculateDigitalLegacyScore(digitalLegacy), [digitalLegacy]);
  const priorityActions = useMemo(() => createPriorityActions(activeRecords, 3), [activeRecords]);
  const recent = useMemo(
    () => [...activeRecords].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5),
    [activeRecords]
  );

  return (
    <div className="space-y-10">
      <header>
        <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--ink-3)]">My Legacy</p>
        <h1 className="mt-3 max-w-2xl text-[32px] font-semibold leading-[1.1] tracking-tight text-[var(--ink)] md:text-[40px]">Everything your family would need to find.</h1>
        <p className="mt-3 max-w-xl text-[13.5px] leading-6 text-[var(--ink-2)]">
          Kept inside your encrypted vault, alongside everything else. Passwords, PINs and recovery codes aren't available here yet — this only holds account labels, instructions, and where to look.
        </p>
      </header>

      <LegacyScore score={score} />

      <section>
        <h2 className="mb-3 text-[16px] font-semibold text-[var(--ink)]">Needs your attention</h2>
        <PriorityActions actions={priorityActions} records={activeRecords} onOpenRecord={onOpenRecord} />
      </section>

      <section>
        <h2 className="mb-3 text-[16px] font-semibold text-[var(--ink)]">Categories</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {LEGACY_CATEGORIES.filter((category) => category.id !== "custom").map((category) => {
            const recordsInCategory = activeRecords.filter((r) => r.categoryId === category.id);
            const reviewEntry = digitalLegacy.categoryReviews.find((r) => r.categoryId === category.id);
            const showMarkNotApplicable = DIGITAL_LEGACY_FEATURE_FLAGS.serviceCatalogue
              && recordsInCategory.length === 0
              && reviewEntry?.state !== "not_applicable";
            return (
              <div key={category.id}>
                <CategoryCard
                  category={category}
                  recordCount={recordsInCategory.length}
                  state={categoryState(recordsInCategory, reviewEntry)}
                  onClick={() => onOpenCategory(category.id)}
                />
                {showMarkNotApplicable && (
                  <button
                    onClick={() => onMarkNotApplicable(category.id)}
                    className="ml-2 mt-1 text-[11px] font-medium text-[var(--ink-3)] underline decoration-dotted hover:text-[var(--ink)]"
                  >
                    Mark not applicable
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[16px] font-semibold text-[var(--ink)]">Recently updated</h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line-2)] p-10 text-center text-[13px] text-[var(--ink-3)]">Records you add will appear here.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {recent.map((rec, index) => {
              const category = getCategory(rec.categoryId);
              const label = rec.accountLabel || category?.name || "Untitled";
              return (
                <button
                  key={rec.id}
                  onClick={() => onOpenRecord(rec.id)}
                  className={`flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-[var(--surface-2)] ${index > 0 ? "border-t border-[var(--line)]" : ""}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--green-soft)] text-[var(--green-ink)]">{label.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{label}</span>
                    <span className="block text-[12px] text-[var(--ink-3)]">{category?.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

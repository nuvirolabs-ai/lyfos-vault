import { useMemo } from "react";
import { LEGACY_CATEGORIES, calculateDigitalLegacyScore, calculateReadinessScore, createPriorityActions, getCategory } from "@os-one/digital-legacy";
import { DIGITAL_LEGACY_FEATURE_FLAGS } from "./featureFlags.js";
import LegacyScore from "./components/LegacyScore.jsx";
import PriorityActions from "./components/PriorityActions.jsx";
import CategoryCard from "./components/CategoryCard.jsx";

// Category-card status is a fresh, small rollup over Digital Legacy
// record status — it is NOT the deprecated vault-item completion
// algorithm the assessment says must not be reused as this score
// (docs/LYFOS_DIGITAL_LEGACY_ASSESSMENT.md §"Current vault model").
const ATTENTION_ORDER = ["action_required", "incomplete", "needs_review", "started"];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

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
  // Populated categories first (glanceable — what you've actually done),
  // empty ones after and visually quiet (CategoryCard handles the tint).
  // "custom" (migrated/imported records that couldn't be auto-classified)
  // only appears once it actually holds something — there's no way to
  // create new custom-category records yet, so an always-empty tile
  // there would just be confusing.
  const categoryRows = useMemo(() => {
    const rows = LEGACY_CATEGORIES
      .filter((category) => category.id !== "custom" || activeRecords.some((r) => r.categoryId === "custom"))
      .map((category) => {
        const recordsInCategory = activeRecords.filter((r) => r.categoryId === category.id);
        const reviewEntry = digitalLegacy.categoryReviews.find((r) => r.categoryId === category.id);
        const readiness = recordsInCategory.length ? calculateReadinessScore(recordsInCategory).value : 0;
        return { category, recordsInCategory, reviewEntry, readiness };
      });
    return rows.sort((a, b) => {
      const aEmpty = a.recordsInCategory.length === 0;
      const bEmpty = b.recordsInCategory.length === 0;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      return a.category.sortOrder - b.category.sortOrder;
    });
  }, [activeRecords, digitalLegacy.categoryReviews]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--ink)] md:text-[34px]">{greeting()}</h1>
        <p className="mt-1 text-[13px] text-[var(--ink-3)]">{new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date())}</p>
      </header>

      <LegacyScore score={score} />

      <section>
        <h2 className="mb-3 text-[16px] font-semibold text-[var(--ink)]">Needs your attention</h2>
        <PriorityActions actions={priorityActions} records={activeRecords} onOpenRecord={onOpenRecord} />
      </section>

      <section id="legacy-categories">
        <h2 className="mb-3 text-[16px] font-semibold text-[var(--ink)]">Categories</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {categoryRows.map(({ category, recordsInCategory, reviewEntry, readiness }, index) => {
            const showMarkNotApplicable = DIGITAL_LEGACY_FEATURE_FLAGS.serviceCatalogue
              && recordsInCategory.length === 0
              && reviewEntry?.state !== "not_applicable";
            return (
              <div key={category.id} className="animate-card-in" style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}>
                <CategoryCard
                  category={category}
                  recordCount={recordsInCategory.length}
                  state={categoryState(recordsInCategory, reviewEntry)}
                  onClick={() => onOpenCategory(category.id)}
                  onMarkNotApplicable={showMarkNotApplicable ? () => onMarkNotApplicable(category.id) : undefined}
                  readiness={readiness}
                />
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

import { useMemo, useState } from "react";
import { getCategory, listServices, searchLegacyRecords } from "@os-one/digital-legacy";
import { DIGITAL_LEGACY_FEATURE_FLAGS } from "./featureFlags.js";
import { STATUS_LABELS } from "./labels.js";
import ServiceIcon from "./components/ServiceIcon.jsx";
import LegacyEmptyState from "./components/LegacyEmptyState.jsx";

const STATUS_TONE = {
  protected: "text-[var(--green-ink)]",
  scheduled_for_release: "text-[var(--green-ink)]",
  needs_review: "text-[var(--amber-ink)]",
  action_required: "text-[var(--rose,#c0335e)]",
  incomplete: "text-[var(--amber-ink)]",
  started: "text-[var(--ink-3)]",
  released: "text-[var(--ink-3)]",
  archived: "text-[var(--ink-4)]"
};

export default function LegacyCategoryScreen({ digitalLegacy, categoryId, onOpenRecord, onAddRecord, onBack }) {
  const category = getCategory(categoryId);
  const [query, setQuery] = useState("");

  const categoryRecords = useMemo(
    () => digitalLegacy.records.filter((r) => r.categoryId === categoryId && r.status !== "archived"),
    [digitalLegacy, categoryId]
  );
  // Metadata-only search — never touches field values (search.js).
  const filtered = useMemo(() => searchLegacyRecords(categoryRecords, query), [categoryRecords, query]);
  const serviceById = useMemo(() => new Map(listServices({ categoryId }).map((s) => [s.id, s])), [categoryId]);

  if (!category) return <LegacyEmptyState title="Category not found" />;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ My Legacy</button>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ServiceIcon iconKey={category.iconKey} size="lg" />
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-tight text-[var(--ink)]">{category.name}</h1>
            <p className="mt-1 text-[13px] text-[var(--ink-3)]">{category.description}</p>
          </div>
        </div>
        {DIGITAL_LEGACY_FEATURE_FLAGS.serviceCatalogue && (
          <button
            onClick={() => onAddRecord(categoryId)}
            className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white"
          >
            + Add record
          </button>
        )}
      </header>

      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${category.name.toLowerCase()}`}
        className="w-full rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
      />

      {filtered.length === 0 ? (
        <LegacyEmptyState
          title={categoryRecords.length === 0 ? "No records yet" : "No matches"}
          body={categoryRecords.length === 0 ? "Records you add to this category will appear here." : "Try a different search term."}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((rec) => {
            const service = serviceById.get(rec.serviceTemplateId);
            const label = rec.accountLabel || service?.name || category.name;
            return (
              <button
                key={rec.id}
                onClick={() => onOpenRecord(rec.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface-2)]"
              >
                <ServiceIcon iconKey={service?.iconKey ?? category.iconKey} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-3)]">{service?.name ?? "Custom"}</span>
                </span>
                <span className={`shrink-0 text-[11px] font-semibold ${STATUS_TONE[rec.status] ?? "text-[var(--ink-3)]"}`}>{STATUS_LABELS[rec.status] ?? rec.status}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

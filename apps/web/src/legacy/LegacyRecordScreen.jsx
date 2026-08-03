import { useMemo } from "react";
import { FIELD_TEMPLATES, getCategory, getFreshnessState, getService } from "@os-one/digital-legacy";
import { getSampleDigitalLegacy } from "./sampleLegacyData.js";
import ServiceIcon from "./components/ServiceIcon.jsx";
import LegacyEmptyState from "./components/LegacyEmptyState.jsx";

const LEGACY_ACTION_LABELS = {
  transfer: "Transfer this to the right person.",
  memorialise: "Memorialise this account rather than deleting it.",
  close: "Close this account.",
  delete: "Delete this account and its data.",
  archive: "Archive this — keep it, but stop using it.",
  contact_provider: "Contact the provider directly.",
  release_information: "Share the information needed, nothing more.",
  custom: "See the note below."
};

const AUDIENCE_LABELS = {
  owner_only: "Private — visible only to you",
  existence_only: "Nominees would see this exists, not its details",
  instructions_only: "Nominees would see your instructions, not stored values",
  full_record: "Full record would be included in a release"
};

const RECIPIENT_LABELS = {
  primary: "Primary nominee",
  backup_fallback: "Backup nominee (fallback only)",
  all_authorized: "All authorized nominees",
  selected: "Selected nominees"
};

const FRESHNESS_LABELS = {
  current: "Reviewed recently.",
  review_recommended: "Worth a review soon.",
  needs_review: "Review recommended.",
  potentially_outdated: "Hasn't been reviewed — details may be outdated."
};

export default function LegacyRecordScreen({ recordId, onBack }) {
  const digitalLegacy = useMemo(() => getSampleDigitalLegacy(), []);
  const record = digitalLegacy.records.find((r) => r.id === recordId);

  if (!record) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Back</button>
        <LegacyEmptyState title="Record not found" body="It may have moved — go back and try again." />
      </div>
    );
  }

  const category = getCategory(record.categoryId);
  const service = record.serviceTemplateId ? getService(record.serviceTemplateId) : null;
  const freshness = getFreshnessState(record.review?.lastReviewedAt);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button onClick={onBack} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Back</button>

      <header className="flex items-center gap-4">
        <ServiceIcon iconKey={service?.iconKey ?? category?.iconKey} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">{record.accountLabel || service?.name || category?.name}</h1>
          <p className="mt-1 text-[13px] text-[var(--ink-3)]">{category?.name}{service ? ` · ${service.name}` : ""}</p>
        </div>
      </header>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Details</p>
        {record.fields.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--ink-3)]">No details added yet.</p>
        ) : (
          <dl className="mt-3 divide-y divide-[var(--line)]">
            {record.fields.map((field) => {
              const template = FIELD_TEMPLATES[field.fieldKey];
              // Any field whose template requires reauthentication to reveal
              // stays masked here, unconditionally — reveal is a Phase 4B
              // control gated on a recent-auth service that doesn't exist
              // yet (assessment DL-02/DL-03). This screen never bypasses it.
              const masked = template?.revealRequiresReauthentication;
              return (
                <div key={field.fieldKey} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[12.5px] text-[var(--ink-3)]">{template?.label ?? field.fieldKey}</dt>
                  <dd className="max-w-[60%] text-right text-[13px] text-[var(--ink)]">
                    {masked ? <span className="text-[var(--ink-4)]">•••• Hidden — needs reauthentication in a later release</span> : String(field.value ?? "—")}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">If something happens to you</p>
        <p className="mt-2 text-[13.5px] leading-6 text-[var(--ink)]">{record.instructions?.customText || LEGACY_ACTION_LABELS[record.instructions?.action] || "No instruction set yet."}</p>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Release intent</p>
        <p className="mt-2 text-[13.5px] text-[var(--ink)]">{AUDIENCE_LABELS[record.releasePolicy?.audience] ?? "Not set"}</p>
        <p className="mt-1 text-[12px] text-[var(--ink-3)]">{RECIPIENT_LABELS[record.releasePolicy?.recipientMode]}</p>
        <p className="mt-3 text-[11.5px] leading-5 text-[var(--ink-4)]">
          This is your stated intent, shown for your own planning. It is not cryptographically enforced yet — anyone who completes a Circle of Trust recovery today receives your full vault, not only what is marked here.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Review</p>
        <p className="mt-2 text-[13.5px] text-[var(--ink)]">{FRESHNESS_LABELS[freshness.label]}</p>
        {freshness.ageDays !== null && <p className="mt-1 text-[12px] text-[var(--ink-3)]">Last reviewed {freshness.ageDays} day{freshness.ageDays === 1 ? "" : "s"} ago.</p>}
      </section>
    </div>
  );
}

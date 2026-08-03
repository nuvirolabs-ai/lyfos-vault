import { FIELD_TEMPLATES, deriveRecordStatus, getCategory, getFreshnessState, getService } from "@os-one/digital-legacy";
import { appendAuditEvent } from "../lib/stage1Audit.js";
import { DIGITAL_LEGACY_FEATURE_FLAGS } from "./featureFlags.js";
import { AUDIENCE_LABELS, LEGACY_ACTION_LABELS, RECIPIENT_LABELS } from "./labels.js";
import ServiceIcon from "./components/ServiceIcon.jsx";
import LegacyEmptyState from "./components/LegacyEmptyState.jsx";
import AttachmentList from "./components/AttachmentList.jsx";

const FRESHNESS_LABELS = {
  current: "Reviewed recently.",
  review_recommended: "Worth a review soon.",
  needs_review: "Review recommended.",
  potentially_outdated: "Hasn't been reviewed — details may be outdated."
};

export default function LegacyRecordScreen({ digitalLegacy, vault, onSave, recordId, onBack, onEdit }) {
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
  const service = record.serviceTemplateId
    ? getService(record.serviceTemplateId)
    : (digitalLegacy.customServices ?? []).find((s) => s.id === record.customServiceId) ?? null;
  const freshness = getFreshnessState(record.review?.lastReviewedAt);
  const canEdit = DIGITAL_LEGACY_FEATURE_FLAGS.serviceCatalogue;
  const needsOwnerReview = record.migration?.classification === "needs_owner_review";

  async function handleArchive() {
    const label = record.accountLabel || service?.name || category?.name || "this record";
    if (!window.confirm(`Archive "${label}"? It stays in your vault but leaves the active list.`)) return;
    const now = new Date().toISOString();
    const archivedRecord = { ...record, archivedAt: now, updatedAt: now };
    archivedRecord.status = deriveRecordStatus(archivedRecord, { now });
    const nextVault = {
      ...vault,
      digitalLegacy: {
        ...digitalLegacy,
        records: digitalLegacy.records.map((r) => (r.id === record.id ? archivedRecord : r)),
        updatedAt: now
      }
    };
    await onSave(appendAuditEvent(nextVault, "Digital Legacy record archived"), "record_change");
    onBack();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Back</button>
        {canEdit && record.status !== "archived" && (
          <div className="flex items-center gap-3">
            <button onClick={() => onEdit(record.id)} className="text-[12px] font-semibold text-[var(--green-ink)] hover:underline">Edit</button>
            <button onClick={handleArchive} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--red-2)]">Archive</button>
          </div>
        )}
      </div>

      <header className="flex items-center gap-4">
        <ServiceIcon iconKey={service?.iconKey ?? category?.iconKey} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">{record.accountLabel || service?.name || category?.name}</h1>
          <p className="mt-1 text-[13px] text-[var(--ink-3)]">{category?.name}{service ? ` · ${service.name}` : ""}</p>
        </div>
      </header>

      {needsOwnerReview && (
        <div className="rounded-2xl border border-[var(--amber-soft,#f3e2c4)] bg-[var(--amber-soft,#fdf4e3)] px-5 py-3.5 text-[13px] text-[var(--amber-ink,#7a4b00)]">
          Brought over from your old vault records and couldn't be auto-filed with confidence — worth a quick look and, if it belongs elsewhere, re-add it in the right category.
        </div>
      )}

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

      {record.attachments?.length > 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Files</p>
          <AttachmentList attachments={record.attachments} />
        </section>
      )}

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

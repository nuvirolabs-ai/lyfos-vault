import { useEffect, useMemo, useState } from "react";
import {
  FIELD_TEMPLATES,
  LEGACY_ACTIONS,
  RECIPIENT_MODES,
  RELEASE_AUDIENCES,
  createLegacyRecord,
  getCategory,
  getService,
  listServices
} from "@os-one/digital-legacy";
import { appendAuditEvent } from "../lib/stage1Audit.js";
import { AUDIENCE_LABELS, LEGACY_ACTION_LABELS, RECIPIENT_LABELS, REVIEW_FREQUENCY_LABELS } from "./labels.js";
import ServiceIcon from "./components/ServiceIcon.jsx";

const REVIEW_FREQUENCIES = ["3_months", "6_months", "yearly", "custom", "none"];
const BASIC_CLASSIFICATIONS = ["identity_information", "account_information"];
const BASIC_FIELD_COUNT = 3;

function fieldInput(template, value, onChange) {
  const props = {
    value,
    onChange: (e) => onChange(e.target.value),
    className: "w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
  };
  if (template.fieldType === "textarea" || template.fieldType === "secure-note") {
    return <textarea rows={3} {...props} />;
  }
  if (template.fieldType === "date") {
    return <input type="date" {...props} />;
  }
  return <input type="text" placeholder={template.placeholder || undefined} {...props} />;
}

export default function LegacyRecordForm({ digitalLegacy, vault, onSave, categoryId, recordId, onDone, onCancel }) {
  const existingRecord = useMemo(() => digitalLegacy.records.find((r) => r.id === recordId) ?? null, [digitalLegacy, recordId]);
  const effectiveCategoryId = existingRecord?.categoryId ?? categoryId;
  const category = getCategory(effectiveCategoryId);
  const services = useMemo(() => listServices({ categoryId: effectiveCategoryId }), [effectiveCategoryId]);

  const [selectedServiceId, setSelectedServiceId] = useState(existingRecord?.serviceTemplateId ?? null);
  const [serviceQuery, setServiceQuery] = useState("");
  const selectedService = selectedServiceId ? getService(selectedServiceId) : null;

  const [accountLabel, setAccountLabel] = useState(existingRecord?.accountLabel ?? "");
  const [action, setAction] = useState(existingRecord?.instructions?.action ?? "custom");
  const [customText, setCustomText] = useState(existingRecord?.instructions?.customText ?? "");
  const [audience, setAudience] = useState(existingRecord?.releasePolicy?.audience ?? "owner_only");
  const [recipientMode, setRecipientMode] = useState(existingRecord?.releasePolicy?.recipientMode ?? "primary");
  const [reviewFrequency, setReviewFrequency] = useState(existingRecord?.review?.frequency ?? "yearly");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Editing starts fully expanded (nothing already filled in should be
  // hidden); creating starts basics-only — "add more later, on that
  // record's own screen" is the toggle below, not a separate flow.
  const [showMore, setShowMore] = useState(Boolean(existingRecord));

  const allowedFieldKeys = useMemo(() => {
    const suggested = selectedService?.suggestedFieldKeys ?? [];
    const existingKeys = existingRecord?.fields?.map((f) => f.fieldKey) ?? [];
    return [...new Set([...suggested, ...existingKeys])]
      // "account-label" duplicates the record's own top-level Label field.
      .filter((key) => key !== "account-label" && FIELD_TEMPLATES[key]?.storagePolicy === "allowed");
  }, [selectedService, existingRecord]);

  const basicFieldKeys = useMemo(
    () => allowedFieldKeys.filter((key) => BASIC_CLASSIFICATIONS.includes(FIELD_TEMPLATES[key]?.classification)).slice(0, BASIC_FIELD_COUNT),
    [allowedFieldKeys]
  );
  const moreFieldKeys = useMemo(() => allowedFieldKeys.filter((key) => !basicFieldKeys.includes(key)), [allowedFieldKeys, basicFieldKeys]);

  const [fieldValues, setFieldValues] = useState(() => {
    const initial = {};
    for (const field of existingRecord?.fields ?? []) initial[field.fieldKey] = String(field.value ?? "");
    return initial;
  });

  useEffect(() => {
    setFieldValues((prev) => {
      const next = {};
      for (const key of allowedFieldKeys) next[key] = prev[key] ?? "";
      return next;
    });
    // Only re-seed when the field set itself changes (service picked/changed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedFieldKeys.join(",")]);

  if (!category) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <button onClick={onCancel} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Back</button>
        <p className="text-[13px] text-[var(--ink-3)]">Category not found.</p>
      </div>
    );
  }

  // New records need a service before the field form makes sense — the
  // suggested fields, action list, and icon all come from the service.
  if (!selectedServiceId) {
    const needle = serviceQuery.trim().toLowerCase();
    const filtered = needle
      ? services.filter((s) => s.name.toLowerCase().includes(needle) || s.aliases.some((a) => a.toLowerCase().includes(needle)))
      : services;
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <button onClick={onCancel} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Cancel</button>
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">Add to {category.name}</h1>
          <p className="mt-1 text-[13px] text-[var(--ink-3)]">Pick what this record is for.</p>
        </header>
        <input
          type="text"
          value={serviceQuery}
          onChange={(e) => setServiceQuery(e.target.value)}
          placeholder="Search"
          className="w-full rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 py-2.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
        />
        <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedServiceId(s.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--surface-2)]"
            >
              <ServiceIcon iconKey={s.iconKey} size="sm" />
              <span className="text-[13px] font-medium text-[var(--ink)]">{s.name}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-1 py-4 text-[13px] text-[var(--ink-3)]">No matches.</p>}
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!accountLabel.trim()) { setError("Give this record a label so you can find it later."); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const input = {
        categoryId: effectiveCategoryId,
        serviceTemplateId: selectedServiceId,
        accountLabel: accountLabel.trim(),
        tags: existingRecord?.tags ?? [],
        fields: Object.entries(fieldValues)
          .filter(([, value]) => value.trim())
          .map(([fieldKey, value]) => ({ fieldKey, value: value.trim() })),
        instructions: { action, ...(action === "custom" && customText.trim() ? { customText: customText.trim() } : {}) },
        releasePolicy: { audience, recipientMode, trigger: "existing_circle" },
        review: { frequency: reviewFrequency, ...(existingRecord?.review?.lastReviewedAt ? { lastReviewedAt: existingRecord.review.lastReviewedAt } : {}) },
        attachments: existingRecord?.attachments ?? [],
        createdAt: existingRecord?.createdAt
      };
      const options = { now };
      if (existingRecord) options.idFactory = () => existingRecord.id;
      const record = createLegacyRecord(input, options);
      const nextRecords = existingRecord
        ? digitalLegacy.records.map((r) => (r.id === record.id ? record : r))
        : [record, ...digitalLegacy.records];
      const nextVault = {
        ...vault,
        digitalLegacy: { ...digitalLegacy, records: nextRecords, updatedAt: now }
      };
      const eventName = existingRecord ? "Digital Legacy record updated" : "Digital Legacy record created";
      await onSave(appendAuditEvent(nextVault, eventName), "record_change");
      onDone(record.id);
    } catch (err) {
      setError(err?.message || "Couldn't save this record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6">
      <button type="button" onClick={onCancel} className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">‹ Cancel</button>

      <header className="flex items-center gap-4">
        <ServiceIcon iconKey={selectedService?.iconKey ?? category.iconKey} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">{existingRecord ? "Edit record" : `Add ${selectedService?.name ?? "record"}`}</h1>
          <p className="mt-1 text-[13px] text-[var(--ink-3)]">{category.name}{selectedService ? ` · ${selectedService.name}` : ""}</p>
        </div>
      </header>

      {error && <div className="rounded-md bg-[#ff453a]/8 px-3 py-2 text-[12px] font-medium text-[var(--red-2)]">{error}</div>}

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Details</p>
        <div>
          <label className="mb-1 block text-[12px] text-[var(--ink-3)]">Label</label>
          <input
            type="text"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
            placeholder={selectedService ? `e.g. ${selectedService.name} — primary` : "e.g. Personal account"}
            className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
          />
        </div>
        {basicFieldKeys.map((key) => {
          const template = FIELD_TEMPLATES[key];
          return (
            <div key={key}>
              <label className="mb-1 block text-[12px] text-[var(--ink-3)]">{template.label}</label>
              {fieldInput(template, fieldValues[key] ?? "", (value) => setFieldValues((prev) => ({ ...prev, [key]: value })))}
            </div>
          );
        })}
      </section>

      {!showMore ? (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="text-[13px] font-medium text-[var(--green-ink)] hover:underline"
        >
          + Add more details
        </button>
      ) : (
        <>
          {moreFieldKeys.length > 0 && (
            <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">More details</p>
              {moreFieldKeys.map((key) => {
                const template = FIELD_TEMPLATES[key];
                return (
                  <div key={key}>
                    <label className="mb-1 block text-[12px] text-[var(--ink-3)]">{template.label}</label>
                    {fieldInput(template, fieldValues[key] ?? "", (value) => setFieldValues((prev) => ({ ...prev, [key]: value })))}
                  </div>
                );
              })}
            </section>
          )}

          <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">If something happens to you</p>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
            >
              {LEGACY_ACTIONS.map((value) => <option key={value} value={value}>{LEGACY_ACTION_LABELS[value]}</option>)}
            </select>
            {action === "custom" && (
              <textarea
                rows={2}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="What should happen?"
                className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
              />
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Release intent</p>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
            >
              {RELEASE_AUDIENCES.map((value) => <option key={value} value={value}>{AUDIENCE_LABELS[value]}</option>)}
            </select>
            <select
              value={recipientMode}
              onChange={(e) => setRecipientMode(e.target.value)}
              className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
            >
              {RECIPIENT_MODES.map((value) => <option key={value} value={value}>{RECIPIENT_LABELS[value]}</option>)}
            </select>
            <p className="text-[11.5px] leading-5 text-[var(--ink-4)]">
              This records your intent for your own planning. It is not cryptographically enforced yet — anyone who completes a Circle of Trust recovery today receives your full vault, not only what's marked here.
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Review reminder</p>
            <select
              value={reviewFrequency}
              onChange={(e) => setReviewFrequency(e.target.value)}
              className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--green)]"
            >
              {REVIEW_FREQUENCIES.map((value) => <option key={value} value={value}>{REVIEW_FREQUENCY_LABELS[value]}</option>)}
            </select>
          </section>
        </>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-full bg-[#1d1d1f] px-4 py-3 text-[13px] font-semibold text-white disabled:cursor-wait disabled:opacity-50"
      >
        {saving ? "Saving…" : existingRecord ? "Save changes" : "Save record"}
      </button>
    </form>
  );
}

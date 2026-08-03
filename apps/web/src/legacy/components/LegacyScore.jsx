// Copy deliberately says "prepared", never "secure"/"guaranteed"/"100%
// protected" — this score is a transparent estimate, not a security
// claim (docs/LEGACY_SCORE_SPECIFICATION.md).
export default function LegacyScore({ score }) {
  return (
    <div className="flex flex-wrap items-center gap-8 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7 md:flex-nowrap md:gap-12 md:p-10">
      <div
        className="grid h-32 w-32 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(var(--accent) ${score.overall}%, var(--surface-3) ${score.overall}% 100%)` }}
      >
        <div className="grid h-24 w-24 place-items-center rounded-full bg-[var(--surface)] text-[28px] font-semibold tracking-tight text-[var(--ink)]">
          {score.overall}%
        </div>
      </div>
      <div className="min-w-0 max-w-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">Digital Legacy</p>
        <h2 className="mt-3 text-[20px] font-semibold leading-tight text-[var(--ink)]">{score.label}</h2>
        <p className="mt-2 text-[13px] leading-5 text-[var(--ink-3)]">A transparent estimate of coverage, readiness and freshness — not a security guarantee.</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
          <div>
            <dt className="text-[var(--ink-4)]">Coverage</dt>
            <dd className="mt-0.5 font-semibold text-[var(--ink)]">{score.coverage.value}%</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-4)]">Readiness</dt>
            <dd className="mt-0.5 font-semibold text-[var(--ink)]">{score.readiness.value}%</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-4)]">Freshness</dt>
            <dd className="mt-0.5 font-semibold text-[var(--ink)]">{score.freshness.value}%</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

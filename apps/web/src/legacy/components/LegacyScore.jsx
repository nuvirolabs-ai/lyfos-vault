import { useEffect, useRef, useState } from "react";

// Copy deliberately says "prepared", never "secure"/"guaranteed"/"100%
// protected" — this score is a transparent estimate, not a security
// claim (docs/LEGACY_SCORE_SPECIFICATION.md).
export default function LegacyScore({ score }) {
  // Ring and number animate in together on mount/change, Activity-ring
  // style, instead of snapping straight to the value.
  const [displayed, setDisplayed] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    const target = score.overall;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(target);
      return;
    }
    const start = performance.now();
    const duration = 900;
    cancelAnimationFrame(frameRef.current);
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(target * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [score.overall]);

  return (
    <div className="flex flex-wrap items-center gap-8 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7 md:flex-nowrap md:gap-12 md:p-10">
      <div
        className="legacy-score-ring grid h-32 w-32 shrink-0 place-items-center rounded-full"
        style={{ "--score-pct": `${displayed}%` }}
      >
        <div className="grid h-24 w-24 place-items-center rounded-full bg-[var(--surface)] text-[28px] font-semibold tracking-tight text-[var(--ink)]">
          {displayed}%
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

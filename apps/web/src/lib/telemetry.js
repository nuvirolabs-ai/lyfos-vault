// Telemetry stubs — wired up but inactive until env vars are set in the host
// (Cloudflare Pages / Vercel / wherever app.lyfos.in is deployed).
//
// Set in deployment env:
//   VITE_PLAUSIBLE_DOMAIN=app.lyfos.in
//   VITE_SENTRY_DSN=https://...@sentry.io/...
//
// Both are evaluated at BUILD time by Vite. If unset, this module does nothing —
// no script tags injected, no Sentry SDK loaded, no telemetry leaves the device.

const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

// Build identity, set by vite.config.js
// eslint-disable-next-line no-undef
const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

const SOURCE_KEY = "lyfos-acq-src";

export function initTelemetry() {
  captureSource();
  initPlausible();
  initSentry();
}

/**
 * Remember which marketing CTA sent this visitor here (`?src=home_pricing`),
 * so the funnel can be joined across two origins without a cross-site cookie.
 *
 * Deliberately narrow: an allowlist-shaped pattern, capped length, and the
 * param is stripped from the URL afterwards so it can't leak into a referrer
 * or a screenshot. Anything that isn't a plain short slug is discarded.
 */
function captureSource() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("src");
    if (!raw) return;
    if (/^[a-z0-9_-]{1,32}$/i.test(raw)) {
      localStorage.setItem(SOURCE_KEY, raw.toLowerCase());
    }
    url.searchParams.delete("src");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    // Never let attribution break app startup.
  }
}

/** The remembered acquisition source, or "direct". Safe to send as a prop. */
export function getSource() {
  try {
    return localStorage.getItem(SOURCE_KEY) || "direct";
  } catch {
    return "direct";
  }
}

/**
 * Bucket a count into a coarse range. Vault sizes are sent as buckets, never
 * exact numbers — an exact item count is a weak fingerprint, a bucket isn't.
 */
export function bucketCount(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 10) return "6-10";
  if (n <= 25) return "11-25";
  if (n <= 50) return "26-50";
  return "50+";
}

function initPlausible() {
  if (!PLAUSIBLE_DOMAIN) return;
  if (typeof document === "undefined") return;
  if (document.querySelector("script[data-lyfos-plausible]")) return;
  const script = document.createElement("script");
  script.defer = true;
  script.dataset.domain = PLAUSIBLE_DOMAIN;
  script.dataset.lyfosPlausible = "1";
  script.src = "https://plausible.io/js/script.js";
  document.head.appendChild(script);
}

function initSentry() {
  if (!SENTRY_DSN) return;
  // Lazy-load Sentry browser SDK only when DSN is set so the default bundle
  // stays small. Sentry isn't installed yet — when ready, add @sentry/browser
  // to dependencies and uncomment the import below.
  //
  // import("@sentry/browser").then(({ init, setTag }) => {
  //   init({
  //     dsn: SENTRY_DSN,
  //     release: BUILD_ID,
  //     tracesSampleRate: 0.1,
  //     // We never send plaintext, but be safe: scrub everything that looks
  //     // like secrets or PII from breadcrumbs and event payloads.
  //     beforeSend: scrubEvent,
  //     beforeBreadcrumb: scrubBreadcrumb
  //   });
  //   setTag("build", BUILD_ID);
  // });
  if (typeof console !== "undefined") {
    console.info("[lyfos] Sentry DSN configured but @sentry/browser not yet installed.");
  }
}

/**
 * Every event this app is allowed to emit, and the prop keys allowed on each.
 * An allowlist, not a filter: an unknown event name or prop key is dropped,
 * not passed through. (Closes the "accepts arbitrary event props" half of
 * DL-04 in docs/LYFOS_DIGITAL_LEGACY_ASSESSMENT.md.)
 *
 * Nothing derived from vault contents may ever be added here — no record
 * titles, service names, nominee names or emails, no vault or user ids.
 * Counts go out as buckets via bucketCount(), never as exact numbers.
 */
const ALLOWED_EVENTS = {
  vault_created:      ["src"],
  record_added:       ["count"],
  nominee_added:      ["holders"],
  checkout_started:   ["plan", "coupon"],
  purchase_completed: ["plan"]
};

// A second line of defence: even an allowed key only carries a short slug, so
// an identifier can't ride along in a prop that happens to have a legal name.
const SAFE_PROP_VALUE = /^[a-z0-9 _+-]{1,32}$/i;

export function trackEvent(name, props) {
  if (typeof window === "undefined") return;
  if (typeof window.plausible !== "function") return; // inert until Plausible is configured

  const allowedKeys = ALLOWED_EVENTS[name];
  if (!allowedKeys) return;

  const safe = {};
  for (const key of allowedKeys) {
    const value = props?.[key];
    if (value === undefined || value === null) continue;
    const str = String(value);
    if (SAFE_PROP_VALUE.test(str)) safe[key] = str;
  }
  window.plausible(name, Object.keys(safe).length ? { props: safe } : undefined);
}

export function getBuildId() {
  return BUILD_ID;
}

// Scrubbers kept here so the contract is visible even before Sentry is wired in.
// eslint-disable-next-line no-unused-vars
function scrubEvent(event) {
  if (!event) return event;
  if (event.request?.cookies) delete event.request.cookies;
  if (event.user?.email) delete event.user.email;
  if (event.user?.ip_address) delete event.user.ip_address;
  return event;
}
// eslint-disable-next-line no-unused-vars
function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.category === "console") return null;
  if (breadcrumb.data?.url?.includes("data:")) breadcrumb.data.url = "[data-url-scrubbed]";
  return breadcrumb;
}

// Service worker registration. Safe to call multiple times; the browser dedupes.
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return; // Don't pollute local dev with SW caching
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[lyfos] Service worker registration failed:", err));
  });
}

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

export function initTelemetry() {
  initPlausible();
  initSentry();
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

export function trackEvent(name, props) {
  // Plausible custom events
  if (typeof window !== "undefined" && typeof window.plausible === "function") {
    window.plausible(name, { props });
  }
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

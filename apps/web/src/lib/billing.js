// Lyfos billing — client-side wrappers around subscriptions /
// billing_events / billing_profile, plus the upgrade-flow handoff
// to the Razorpay Checkout Edge Function.
//
// All Supabase calls are RLS-gated; the server is the source of
// truth and our table mirrors are reconciled by the webhook handler.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";
import { planFor } from "./plans.js";
import { trackEvent } from "./telemetry.js";

const WAITLIST_ENDPOINT =
  import.meta.env.VITE_WAITLIST_ENDPOINT ||
  "https://rifooyrwepkrhprakdec.supabase.co/functions/v1/waitlist";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================
// Read paths
// ============================================================

export async function fetchMySubscription() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchMyBillingEvents() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("billing_events")
    .select("id, event_type, amount_paise, currency, invoice_number, invoice_pdf_path, provider, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyBillingProfile() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb.from("billing_profile").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertMyBillingProfile(profile) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) throw new Error("Not signed in");
  const payload = { ...profile, user_id: userData.user.id };
  const { data, error } = await sb
    .from("billing_profile")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchInvoiceUrl(pdfPath) {
  if (!pdfPath) return null;
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from("invoices")
    .createSignedUrl(pdfPath, 300); // 5 minutes
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ============================================================
// Upgrade flow — creates a real recurring Razorpay subscription via
// the create-checkout-session Edge Function and hands back its hosted
// checkout URL. The subscription only becomes 'active' in our database
// once Razorpay's webhook confirms the first charge — this function
// does not (and cannot) mark the user as upgraded itself.
// ============================================================

/**
 * Kick off an upgrade. Returns { checkoutUrl } — the caller should
 * redirect the browser there to complete payment on Razorpay's hosted
 * page. Do not treat a successful call as "upgraded"; the plan only
 * flips once Razorpay's webhook fires after the first successful charge.
 *
 * @param {object} opts
 * @param {string} opts.plan       'vault'
 * @param {string} [opts.provider] 'razorpay' (only provider currently wired)
 * @param {string} [opts.couponCode]
 */
export async function startUpgrade({ plan, provider = "razorpay", couponCode }) {
  if (plan !== "vault") throw new Error("plan must be 'vault'");
  if (!planFor(plan).checkoutEnabled) throw new Error("Vault launches this fall. Join the launch list instead.");
  if (provider !== "razorpay") throw new Error("Only Razorpay is configured");
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");

  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("create-checkout-session", {
    body: { plan, provider, couponCode: couponCode || undefined }
  });
  if (error) throw new Error(data?.error || error.message || "Could not start checkout");
  if (!data?.ok || !data?.checkoutUrl) throw new Error(data?.error || "Checkout session did not return a payment link");

  // Instrumented here rather than at the two button handlers, so both upgrade
  // paths are covered by one call. Fires only once the session really exists —
  // a checkout that failed to open was never started. The coupon *code* is
  // never sent, only whether one was used.
  trackEvent("checkout_started", { plan, coupon: couponCode ? "yes" : "no" });

  return { checkoutUrl: data.checkoutUrl, subscriptionId: data.subscription_id };
}

/**
 * Check a coupon code against a plan before checkout, so the UI can show
 * the discounted price. Returns { valid, code, originalAmountPaise,
 * discountPaise, amountPaise } on a valid code, or { valid: false, error }.
 * Doesn't reserve or redeem the coupon — create-checkout-session does the
 * real, authoritative check when the user actually pays.
 */
export async function validateCoupon({ plan, code }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("validate-coupon", {
    body: { plan, code }
  });
  if (error) throw new Error(data?.error || error.message || "Could not check that code");
  if (!data?.ok) return { valid: false, error: data?.error || "Invalid coupon code" };
  return {
    valid: true,
    code: data.code,
    originalAmountPaise: data.originalAmountPaise,
    discountPaise: data.discountPaise,
    amountPaise: data.amountPaise
  };
}

export async function joinVaultFallWaitlist({ email, source = "vault-fall-interest-app" } = {}) {
  const cleaned = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(cleaned) || cleaned.length > 254) throw new Error("Enter a valid email address.");

  const response = await fetch(WAITLIST_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: cleaned,
      source,
      referrer: typeof location !== "undefined" ? location.href : ""
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not save your email.");
  return data;
}


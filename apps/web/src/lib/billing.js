// Lyfos billing — client-side wrappers around subscriptions /
// billing_events / billing_profile, plus the upgrade-flow handoff
// to the Razorpay Checkout Edge Function.
//
// All Supabase calls are RLS-gated; the server is the source of
// truth and our table mirrors are reconciled by the webhook handler.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";
import { planFor } from "./plans.js";

const BILLING_API_BASE = (import.meta.env.VITE_BILLING_API_BASE || "").replace(/\/$/, "");

async function postBillingJson(path, payload) {
  const response = await fetch(`${BILLING_API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Payment request failed");
  return data;
}

function openRazorpayCheckout(options) {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("Razorpay checkout could not load"));
      return;
    }

    const checkout = new window.Razorpay({
      ...options,
      handler: async (response) => {
        try {
          const verified = await postBillingJson("/api/verify-payment", response);
          resolve(verified);
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () => reject(new Error("Checkout closed before payment."))
      },
      theme: { color: "#1d1d1f" }
    });

    checkout.on("payment.failed", (response) => {
      reject(new Error(response?.error?.description || "Payment failed. Please try again."));
    });

    checkout.open();
  });
}

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
// Upgrade flow — opens Razorpay Standard Checkout and verifies the
// payment signature through the backend.
// ============================================================

/**
 * Kick off an upgrade. Returns a verified payment response when the
 * backend signature check passes.
 *
 * @param {object} opts
 * @param {string} opts.plan       'vault'
 * @param {string} [opts.provider] 'razorpay' (default) | 'stripe'
 */
export async function startUpgrade({ plan, provider = "razorpay" }) {
  if (plan !== "vault") throw new Error("plan must be 'vault'");
  if (provider !== "razorpay") throw new Error("Only Razorpay Standard Checkout is configured");

  const selected = planFor(plan);
  const order = await postBillingJson("/api/create-order", {
    amount: selected.amountInr,
    currency: "INR",
    receipt: `lyfos_${plan}_${Date.now()}`
  });

  const verified = await openRazorpayCheckout({
    key: order.key_id,
    amount: order.amount,
    currency: order.currency,
    name: "Lyfos",
    description: `Lyfos ${selected.label} annual access`,
    order_id: order.order_id
  });

  return { provider: "razorpay", verified: true, ...verified };
}

/**
 * Cancel the user's subscription at the end of the current period.
 * Provider-side cancellation is handled by the Edge Function.
 */
export async function cancelSubscriptionAtPeriodEnd() {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("cancel-subscription", { body: {} });
  if (error) throw error;
  return data;
}

/**
 * Resume a previously cancelled subscription (only valid if cancel_at_period_end
 * is true and current_period_end hasn't passed).
 */
export async function resumeSubscription() {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("resume-subscription", { body: {} });
  if (error) throw error;
  return data;
}

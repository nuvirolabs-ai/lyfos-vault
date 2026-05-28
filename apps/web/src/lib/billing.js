// Lyfos billing — client-side wrappers around subscriptions /
// billing_events / billing_profile, plus the upgrade-flow handoff
// to the Razorpay Checkout Edge Function.
//
// All Supabase calls are RLS-gated; the server is the source of
// truth and our table mirrors are reconciled by the webhook handler.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";

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
// Upgrade flow — calls create-checkout-session Edge Function
// which talks to Razorpay (or Stripe) and returns a payment URL.
// ============================================================

/**
 * Kick off an upgrade. Returns { provider, checkoutUrl, subscriptionId? }
 * depending on what the Edge Function produced.
 *
 * @param {object} opts
 * @param {string} opts.plan       'vault' | 'family'
 * @param {string} [opts.provider] 'razorpay' (default) | 'stripe'
 */
export async function startUpgrade({ plan, provider = "razorpay" }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (plan !== "vault" && plan !== "family") throw new Error("plan must be 'vault' or 'family'");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("create-checkout-session", {
    body: { plan, provider }
  });
  if (error) throw error;
  return data;
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

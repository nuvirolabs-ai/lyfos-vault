import * as Linking from "expo-linking";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export async function fetchMySubscription() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase()!;
  const { data, error } = await sb.from("subscriptions").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchMyBillingEvents() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
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
  const sb = getSupabase()!;
  const { data, error } = await sb.from("billing_profile").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertMyBillingProfile(profile: any) {
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in");
  const payload = { ...profile, user_id: u.user.id };
  const { data, error } = await sb
    .from("billing_profile")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchInvoiceUrl(pdfPath: string) {
  if (!pdfPath || !isSupabaseConfigured()) return null;
  const sb = getSupabase()!;
  const { data, error } = await sb.storage.from("invoices").createSignedUrl(pdfPath, 300);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function startUpgrade({ plan, provider = "razorpay" }: { plan: "vault" | "family"; provider?: "razorpay" | "stripe" }) {
  const sb = getSupabase()!;
  const { data, error } = await sb.functions.invoke("create-checkout-session", { body: { plan, provider } });
  if (error) throw error;
  return data;
}

/**
 * Open the provider checkout in the OS browser. iOS / Android both
 * follow a billing-page-then-deep-link-back pattern. Razorpay's
 * short_url renders Razorpay's hosted page; on success the user is
 * redirected to a URL we configured in the dashboard, which on mobile
 * Universal Links back into the app.
 */
export async function openCheckoutInBrowser(url: string) {
  if (!url) throw new Error("No checkout URL");
  await Linking.openURL(url);
}

export async function cancelSubscriptionAtPeriodEnd() {
  const sb = getSupabase()!;
  const { data, error } = await sb.functions.invoke("cancel-subscription", { body: {} });
  if (error) throw error;
  return data;
}

export async function resumeSubscription() {
  const sb = getSupabase()!;
  const { data, error } = await sb.functions.invoke("resume-subscription", { body: {} });
  if (error) throw error;
  return data;
}

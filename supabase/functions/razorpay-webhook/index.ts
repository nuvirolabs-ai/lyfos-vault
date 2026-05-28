// Lyfos — Razorpay webhook handler.
//
// Receives subscription + payment events from Razorpay and reconciles
// the public.subscriptions and public.billing_events tables. Idempotent
// (we de-dup by provider_event_id in billing_events).
//
// Validates the X-Razorpay-Signature header before doing anything.
//
// Events we listen for:
//   subscription.activated  — first successful charge; plan goes active
//   subscription.charged    — recurring renewal; extend current_period_end
//   subscription.halted     — repeated payment failures; status=past_due
//   subscription.cancelled  — user / admin cancellation; status=cancelled
//   subscription.completed  — natural end of total_count; status=expired
//   payment.failed          — log only; halted will follow if it persists
//
// Required secrets:
//   RAZORPAY_WEBHOOK_SECRET — set the same value in Razorpay dashboard

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
// @ts-ignore — Deno has SubtleCrypto on globalThis

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const WH_SECRET    = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);

  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!WH_SECRET) return text("RAZORPAY_WEBHOOK_SECRET not set", 503);

  const ok = await verifyHmacSha256(WH_SECRET, raw, sig);
  if (!ok) return text("signature invalid", 401);

  let body: any;
  try { body = JSON.parse(raw); } catch { return text("bad json", 400); }

  const eventType = body?.event;
  const eventId   = body?.id ?? body?.payload?.subscription?.entity?.id ?? body?.payload?.payment?.entity?.id;

  // Idempotency: if we've seen this event before, ack.
  if (eventId) {
    const { data: dup } = await admin
      .from("billing_events")
      .select("id")
      .eq("provider", "razorpay")
      .eq("provider_event_id", eventId)
      .maybeSingle();
    if (dup) return text("ok (idempotent)", 200);
  }

  try {
    switch (eventType) {
      case "subscription.activated":
        await handleSubscriptionActivated(body, eventId);
        break;
      case "subscription.charged":
        await handleSubscriptionCharged(body, eventId);
        break;
      case "subscription.halted":
        await handleSubscriptionHalted(body, eventId);
        break;
      case "subscription.cancelled":
        await handleSubscriptionCancelled(body, eventId);
        break;
      case "subscription.completed":
        await handleSubscriptionCompleted(body, eventId);
        break;
      case "payment.failed":
        await handlePaymentFailed(body, eventId);
        break;
      default:
        // Log unhandled events so we can spot gaps without erroring.
        await logEvent(null, eventType, body, eventId, null);
    }
    return text("ok", 200);
  } catch (err: any) {
    console.warn("[lyfos] razorpay webhook error", err?.message);
    return text(`error: ${err?.message ?? "unknown"}`, 500);
  }
});

// ============================================================
// Handlers
// ============================================================

async function handleSubscriptionActivated(body: any, eventId: string) {
  const sub = body?.payload?.subscription?.entity;
  if (!sub) return;
  const lyfosUserId = sub?.notes?.lyfos_user_id;
  const lyfosPlan   = sub?.notes?.lyfos_plan ?? "vault";
  if (!lyfosUserId) return;

  await admin.from("subscriptions").upsert({
    user_id: lyfosUserId,
    plan: lyfosPlan,
    status: "active",
    provider: "razorpay",
    razorpay_subscription_id: sub.id,
    razorpay_customer_id: sub.customer_id,
    current_period_start: sub.current_start ? toIso(sub.current_start) : null,
    current_period_end:   sub.current_end   ? toIso(sub.current_end)   : null,
    cancel_at_period_end: false,
    cancelled_at: null,
    grace_until: null
  }, { onConflict: "user_id" });

  await logEvent(lyfosUserId, "subscription.activated", body, eventId, null);
}

async function handleSubscriptionCharged(body: any, eventId: string) {
  const sub = body?.payload?.subscription?.entity;
  const pay = body?.payload?.payment?.entity;
  if (!sub) return;
  const lyfosUserId = sub?.notes?.lyfos_user_id;
  if (!lyfosUserId) return;

  await admin.from("subscriptions").update({
    status: "active",
    current_period_start: sub.current_start ? toIso(sub.current_start) : null,
    current_period_end:   sub.current_end   ? toIso(sub.current_end)   : null,
    grace_until: null
  }).eq("razorpay_subscription_id", sub.id);

  const { data: inserted } = await admin.from("billing_events").insert({
    user_id: lyfosUserId,
    provider: "razorpay",
    event_type: "payment.captured",
    provider_event_id: eventId,
    provider_payment_id: pay?.id ?? null,
    amount_paise: pay?.amount ?? null,
    currency: pay?.currency ?? "INR",
    payload: scrub(body)
  }).select("id").single();

  // Fire-and-forget invoice generation. The function is idempotent.
  if (inserted?.id) {
    fetch(`${SUPABASE_URL}/functions/v1/generate-invoice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ event_id: inserted.id })
    }).catch((err) => console.warn("[lyfos] invoice gen kick failed", err?.message));
  }
}

async function handleSubscriptionHalted(body: any, eventId: string) {
  const sub = body?.payload?.subscription?.entity;
  if (!sub) return;
  const lyfosUserId = sub?.notes?.lyfos_user_id;
  if (!lyfosUserId) return;

  const graceUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await admin.from("subscriptions").update({
    status: "past_due",
    grace_until: graceUntil
  }).eq("razorpay_subscription_id", sub.id);

  await logEvent(lyfosUserId, "subscription.halted", body, eventId, null);
}

async function handleSubscriptionCancelled(body: any, eventId: string) {
  const sub = body?.payload?.subscription?.entity;
  if (!sub) return;
  const lyfosUserId = sub?.notes?.lyfos_user_id;
  if (!lyfosUserId) return;

  await admin.from("subscriptions").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancel_at_period_end: false
  }).eq("razorpay_subscription_id", sub.id);

  await logEvent(lyfosUserId, "subscription.cancelled", body, eventId, null);
}

async function handleSubscriptionCompleted(body: any, eventId: string) {
  const sub = body?.payload?.subscription?.entity;
  if (!sub) return;
  const lyfosUserId = sub?.notes?.lyfos_user_id;
  if (!lyfosUserId) return;

  await admin.from("subscriptions").update({
    status: "expired"
  }).eq("razorpay_subscription_id", sub.id);

  await logEvent(lyfosUserId, "subscription.completed", body, eventId, null);
}

async function handlePaymentFailed(body: any, eventId: string) {
  const pay = body?.payload?.payment?.entity;
  const lyfosUserId =
    body?.payload?.subscription?.entity?.notes?.lyfos_user_id ?? null;
  await admin.from("billing_events").insert({
    user_id: lyfosUserId,
    provider: "razorpay",
    event_type: "payment.failed",
    provider_event_id: eventId,
    provider_payment_id: pay?.id ?? null,
    amount_paise: pay?.amount ?? null,
    currency: pay?.currency ?? "INR",
    payload: scrub(body)
  });
}

// ============================================================
// helpers
// ============================================================

async function verifyHmacSha256(secret: string, payload: string, expectedHex: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare
  if (hex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

function toIso(seconds: number) { return new Date(seconds * 1000).toISOString(); }

async function logEvent(userId: string | null, eventType: string, body: any, eventId: string, paymentId: string | null) {
  await admin.from("billing_events").insert({
    user_id: userId,
    provider: "razorpay",
    event_type: eventType,
    provider_event_id: eventId,
    provider_payment_id: paymentId,
    payload: scrub(body)
  });
}

function scrub(body: any) {
  // Remove anything that even smells like card data before storing.
  // Razorpay shouldn't send raw PAN but be paranoid.
  try {
    const json = JSON.parse(JSON.stringify(body));
    if (json?.payload?.payment?.entity?.card) {
      delete json.payload.payment.entity.card.number;
      delete json.payload.payment.entity.card.cvv;
    }
    return json;
  } catch {
    return null;
  }
}

function text(s: string, status = 200) {
  return new Response(s, { status, headers: { "content-type": "text/plain" } });
}

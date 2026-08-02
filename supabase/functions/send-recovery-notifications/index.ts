import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.lyfos.in";

serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return Response.json({ error: "missing bearer" }, { status: 401 });
  if (!RESEND_KEY) return Response.json({ error: "email delivery is not configured" }, { status: 503 });

  let appOrigin: string;
  try {
    const parsed = new URL(APP_URL);
    if (parsed.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) throw new Error();
    appOrigin = parsed.origin;
  } catch {
    return Response.json({ error: "APP_URL must be a public HTTPS URL" }, { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: caller } = await admin.auth.getUser(authHeader.slice(7));
  if (caller.user?.user_metadata?.role !== "admin") return Response.json({ error: "not authorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const requestId = body?.request_id;
  if (typeof requestId !== "string") return Response.json({ error: "request_id required" }, { status: 400 });

  const { data: recovery, error: recoveryError } = await admin
    .from("release_requests")
    .select("id, state, nominee_email_at_request, recipient_holder_id")
    .eq("id", requestId)
    .maybeSingle();
  if (recoveryError) return Response.json({ error: recoveryError.message }, { status: 500 });
  if (!recovery?.recipient_holder_id || !["collecting_support", "holding", "ready_to_recover"].includes(recovery.state)) {
    return Response.json({ error: "recipient-gated recovery is not approved" }, { status: 409 });
  }

  const { data: deliveries, error: deliveryError } = await admin
    .from("email_deliveries")
    .select("id, purpose, recipient_email, state, idempotency_key")
    .eq("related_request_id", requestId)
    .in("purpose", ["recovery_support", "owner_alert"])
    .in("state", ["queued", "delayed", "failed"]);
  if (deliveryError) return Response.json({ error: deliveryError.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const delivery of deliveries ?? []) {
    const isOwner = delivery.purpose === "owner_alert";
    const actionUrl = isOwner ? `${appOrigin}/release/abort` : `${appOrigin}/hold-release`;
    const subject = isOwner ? "A recovery request for your Lyfos vault was approved" : "Your key is needed for a Lyfos recovery";
    const intro = isOwner
      ? `A recovery request from ${recovery.nominee_email_at_request} passed evidence review. Two nominees are now being asked for supporting keys. If this is unexpected, abort immediately.`
      : `A reviewed recovery request needs your independent support. Sign in to your own Lyfos account, inspect the request, and release only your key if you trust it.`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "content-type": "application/json",
        "Idempotency-Key": delivery.idempotency_key
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: delivery.recipient_email,
        subject,
        text: `${subject}\n\n${intro}\n\nContinue securely: ${actionUrl}\n\n— Lyfos`,
        html: emailHtml({ subject, intro, actionUrl, actionLabel: isOwner ? "Review or abort" : "Review request" }),
        tags: [{ name: "delivery_id", value: delivery.id }]
      })
    });

    if (!response.ok) {
      failed += 1;
      const reason = (await response.text()).slice(0, 500);
      await admin.from("email_deliveries").update({ state: "failed", failure_reason: reason, updated_at: new Date().toISOString() }).eq("id", delivery.id);
      continue;
    }

    sent += 1;
    const provider = await response.json().catch(() => ({}));
    await admin.from("email_deliveries").update({
      state: "sent",
      provider_message_id: provider?.id ?? null,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      failure_reason: null
    }).eq("id", delivery.id);
  }

  return Response.json({ ok: failed === 0, sent, failed, state: failed === 0 ? "sent" : "partial" });
});

function emailHtml({ subject, intro, actionUrl, actionLabel }: { subject: string; intro: string; actionUrl: string; actionLabel: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:48px 24px;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f"><div style="max-width:520px;margin:0 auto"><p style="font-size:11px;font-weight:600;letter-spacing:.18em;color:#86868b;text-transform:uppercase">Lyfos recovery</p><h1 style="font-size:32px;line-height:1.15">${escapeHtml(subject)}</h1><p style="font-size:15px;line-height:1.65;color:#6e6e73">${escapeHtml(intro)}</p><p style="margin:30px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1d1d1f;color:white;text-decoration:none;font-weight:600">${escapeHtml(actionLabel)}</a></p><p style="font-size:11px;color:#a1a1a6">Never share your recovery passphrase. Lyfos will not ask for it by email.</p></div></body></html>`;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

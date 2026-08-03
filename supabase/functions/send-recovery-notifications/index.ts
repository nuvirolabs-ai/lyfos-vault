import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { requireExternalAppUrl } from "../_shared/public-app-url.ts";
import { corsPreflight, CORS_HEADERS } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SHARED_SECRET = Deno.env.get("CRON_SHARED_SECRET") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.lyfos.in";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "missing bearer" }, 401);
  if (!RESEND_KEY) return json({ error: "email delivery is not configured" }, 503);

  let appOrigin: string;
  try {
    appOrigin = requireExternalAppUrl(APP_URL);
  } catch {
    return json({ error: "APP_URL must be a public HTTPS URL" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const jwt = authHeader.slice(7);
  const isServiceDispatcher = Boolean(CRON_SHARED_SECRET) && jwt === CRON_SHARED_SECRET;
  if (!isServiceDispatcher) {
    const { data: caller } = await admin.auth.getUser(jwt);
    if (caller.user?.app_metadata?.role !== "admin") return json({ error: "not authorized" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  let requestIds: string[];
  if (typeof body?.request_id === "string") {
    requestIds = [body.request_id];
  } else if (isServiceDispatcher) {
    const { data: queued, error: queuedError } = await admin
      .from("email_deliveries")
      .select("related_request_id")
      .in("purpose", ["recovery_support", "owner_alert"])
      .in("state", ["queued", "delayed", "failed"])
      .not("related_request_id", "is", null)
      .limit(250);
    if (queuedError) return json({ error: queuedError.message }, 500);
    requestIds = [...new Set((queued ?? []).map((row) => row.related_request_id).filter(Boolean))];
  } else {
    return json({ error: "request_id required" }, 400);
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const requestId of requestIds) {
    const result = await sendForRequest(admin, requestId, appOrigin);
    sent += result.sent;
    failed += result.failed;
    if (result.error) errors.push(`${requestId}: ${result.error}`);
  }

  return json({ ok: failed === 0 && errors.length === 0, sent, failed, requests: requestIds.length, errors });
});

async function sendForRequest(admin: ReturnType<typeof createClient>, requestId: string, appOrigin: string) {

  const { data: recovery, error: recoveryError } = await admin
    .from("release_requests")
    .select("id, state, nominee_email_at_request, recipient_holder_id")
    .eq("id", requestId)
    .maybeSingle();
  if (recoveryError) return { sent: 0, failed: 1, error: recoveryError.message };
  if (!recovery?.recipient_holder_id || !["collecting_support", "holding", "ready_to_recover"].includes(recovery.state)) {
    return { sent: 0, failed: 0, error: "recipient-gated recovery is not approved" };
  }

  const { data: deliveries, error: deliveryError } = await admin
    .from("email_deliveries")
    .select("id, purpose, recipient_email, state, idempotency_key")
    .eq("related_request_id", requestId)
    .in("purpose", ["recovery_support", "owner_alert"])
    .in("state", ["queued", "delayed", "failed"]);
  if (deliveryError) return { sent: 0, failed: 1, error: deliveryError.message };

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
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
      const { error: failedUpdateError } = await admin
        .from("email_deliveries")
        .update({ state: "failed", failure_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", delivery.id);
      if (failedUpdateError) {
        errors.push(`could not record failed delivery ${delivery.id}: ${failedUpdateError.message}`);
      }
      continue;
    }

    const provider = await response.json().catch(() => ({}));
    const providerMessageId = provider?.id ?? null;
    const { error: sentUpdateError } = await admin
      .from("email_deliveries")
      .update({
        state: "sent",
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        failure_reason: null
      })
      .eq("id", delivery.id);
    if (sentUpdateError) {
      failed += 1;
      errors.push(`provider accepted delivery ${delivery.id}, but its state could not be recorded: ${sentUpdateError.message}`);
      continue;
    }
    if (providerMessageId) {
      const { error: reconcileError } = await admin.rpc("apply_email_delivery_events", {
        p_provider_message_id: providerMessageId
      });
      if (reconcileError) {
        failed += 1;
        errors.push(`delivery event reconciliation failed for ${delivery.id}: ${reconcileError.message}`);
        continue;
      }
    }
    sent += 1;
  }

  return { sent, failed, error: errors.join("; ") };
}

function emailHtml({ subject, intro, actionUrl, actionLabel }: { subject: string; intro: string; actionUrl: string; actionLabel: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:48px 24px;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f"><div style="max-width:520px;margin:0 auto"><p style="font-size:11px;font-weight:600;letter-spacing:.18em;color:#86868b;text-transform:uppercase">Lyfos recovery</p><h1 style="font-size:32px;line-height:1.15">${escapeHtml(subject)}</h1><p style="font-size:15px;line-height:1.65;color:#6e6e73">${escapeHtml(intro)}</p><p style="margin:30px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1d1d1f;color:white;text-decoration:none;font-weight:600">${escapeHtml(actionLabel)}</a></p><p style="font-size:11px;color:#a1a1a6">Never share your recovery passphrase. Lyfos will not ask for it by email.</p></div></body></html>`;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

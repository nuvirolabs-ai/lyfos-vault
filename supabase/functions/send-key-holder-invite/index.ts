// Lyfos — send-key-holder-invite Edge Function.
//
// Called immediately by the owner client and periodically by the service-role
// outbox dispatcher. The raw one-time token is read from the RLS-sealed outbox,
// so a browser crash between invite creation and delivery cannot lose it.
//
// Deploy:
//   supabase functions deploy send-key-holder-invite
// Secrets required (already set if Phase 2's monthly-reminder is
// deployed):
//   RESEND_API_KEY, FROM_EMAIL, APP_URL

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { buildExternalAppUrl } from "../_shared/public-app-url.ts";
import { corsPreflight, CORS_HEADERS } from "../_shared/cors.ts";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const CRON_SHARED_SECRET = Deno.env.get("CRON_SHARED_SECRET") ?? "";
// @ts-ignore
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
// @ts-ignore
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
// @ts-ignore
const APP_URL      = Deno.env.get("APP_URL") ?? "https://app.lyfos.in";

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "missing bearer" }, 401);

  const jwt = authHeader.slice("Bearer ".length);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const isServiceDispatcher = Boolean(CRON_SHARED_SECRET) && jwt === CRON_SHARED_SECRET;
  let callerId: string | null = null;
  if (!isServiceDispatcher) {
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user?.id) return json({ ok: false, error: "invalid token" }, 401);
    callerId = who.user.id;
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const requestedDeliveryId = typeof body?.delivery_id === "string" ? body.delivery_id : null;
  if (!requestedDeliveryId && !isServiceDispatcher) return json({ ok: false, error: "delivery_id required" }, 400);

  let deliveryIds: string[];
  if (requestedDeliveryId) {
    deliveryIds = [requestedDeliveryId];
  } else {
    const { data, error } = await admin
      .from("invite_email_outbox")
      .select("delivery_id")
      .limit(250);
    if (error) return json({ ok: false, error: error.message }, 500);
    deliveryIds = (data ?? []).map((row) => row.delivery_id);
  }

  const results = [];
  for (const deliveryId of deliveryIds) {
    results.push(await sendDelivery(admin, deliveryId, callerId));
  }
  if (requestedDeliveryId) {
    const result = results[0];
    return json(result, result.ok ? 200 : result.status ?? 500);
  }
  return json({
    ok: results.every((result) => result.ok),
    processed: results.length,
    sent: results.filter((result) => result.state === "sent").length,
    failed: results.filter((result) => !result.ok).length
  });
});

async function sendDelivery(admin: ReturnType<typeof createClient>, deliveryId: string, callerId: string | null) {
  const { data: delivery, error: deliveryErr } = await admin
    .from("email_deliveries")
    .select("id, related_holder_id, state, idempotency_key")
    .eq("id", deliveryId)
    .eq("purpose", "holder_invite")
    .maybeSingle();
  if (deliveryErr) return { ok: false, status: 500, error: deliveryErr.message };
  if (!delivery?.related_holder_id) return { ok: false, status: 404, error: "delivery not found" };

  const { data: invite, error: invErr } = await admin
    .from("key_holders")
    .select("id, owner_id, holder_email, label, role, invite_token_hash, invite_expires_at, status")
    .eq("id", delivery.related_holder_id)
    .maybeSingle();
  if (invErr) return { ok: false, status: 500, error: invErr.message };
  if (!invite) return { ok: false, status: 404, error: "invite not found" };
  if (callerId && invite.owner_id !== callerId) return { ok: false, status: 403, error: "not your invite" };
  if (invite.status !== "pending") {
    await abandonDelivery(admin, delivery.id, "invite is no longer pending");
    return { ok: true, state: "closed" };
  }
  if (invite.invite_expires_at && new Date(invite.invite_expires_at).getTime() <= Date.now()) {
    await abandonDelivery(admin, delivery.id, "invite expired before delivery");
    return { ok: false, status: 410, state: "failed", error: "invite expired" };
  }
  if (!["queued", "delayed", "failed"].includes(delivery.state)) {
    await admin.from("invite_email_outbox").delete().eq("delivery_id", delivery.id);
    return { ok: true, state: delivery.state };
  }

  const { data: outbox, error: outboxError } = await admin
    .from("invite_email_outbox")
    .select("invite_token")
    .eq("delivery_id", delivery.id)
    .maybeSingle();
  if (outboxError) return { ok: false, status: 500, error: outboxError.message };
  if (!outbox?.invite_token) return { ok: false, status: 409, error: "invite outbox payload not found" };
  const inviteToken = outbox.invite_token;
  if (await sha256(inviteToken) !== invite.invite_token_hash) {
    await abandonDelivery(admin, delivery.id, "invite token was superseded");
    return { ok: true, state: "closed" };
  }

  const { data: ownerRow } = await admin.auth.admin.getUserById(invite.owner_id);
  const ownerEmail = ownerRow?.user?.email ?? "your-friend@lyfos";
  const ownerName  = ownerEmail.split("@")[0];

  if (!RESEND_KEY) {
    await admin.from("email_deliveries").update({ state: "failed", failure_reason: "RESEND_API_KEY not configured" }).eq("id", delivery.id);
    return { ok: false, status: 503, state: "failed", reason: "Email delivery is not configured" };
  }

  let inviteUrl: string;
  try {
    inviteUrl = buildExternalAppUrl(APP_URL, `/invite/${inviteToken}`);
  } catch (error) {
    await admin.from("email_deliveries").update({ state: "failed", failure_reason: String(error) }).eq("id", delivery.id);
    return { ok: false, status: 500, state: "failed", error: "APP_URL must be a public HTTPS URL" };
  }
  const subject = `${ownerName} nominated you on Lyfos`;
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": delivery.idempotency_key
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: invite.holder_email,
      subject,
      html: buildHtml({ ownerName, label: invite.label, role: invite.role, inviteUrl }),
      text: buildText({ ownerName, label: invite.label, role: invite.role, inviteUrl }),
      tags: [{ name: "delivery_id", value: delivery.id }]
    })
  });

  if (!result.ok) {
    const msg = await result.text();
    await admin.from("email_deliveries").update({
      state: "failed",
      failure_reason: msg.slice(0, 500),
      updated_at: new Date().toISOString()
    }).eq("id", delivery.id);
    return { ok: false, status: 502, state: "failed", error: `Resend rejected: ${msg.slice(0, 200)}` };
  }

  const provider = await result.json().catch(() => ({}));
  const providerMessageId = provider?.id ?? null;
  const { error: sentUpdateError } = await admin.from("email_deliveries").update({
      state: "sent",
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      failure_reason: null
    }).eq("id", delivery.id);
  if (sentUpdateError) {
    return { ok: false, status: 500, error: `provider accepted email but state was not recorded: ${sentUpdateError.message}` };
  }
  if (providerMessageId) {
    const { error: reconcileError } = await admin.rpc("apply_email_delivery_events", {
      p_provider_message_id: providerMessageId
    });
    if (reconcileError) return { ok: false, status: 500, error: `delivery event reconciliation failed: ${reconcileError.message}` };
  }
  await admin.from("invite_email_outbox").delete().eq("delivery_id", delivery.id);

  await admin.from("audit_log").insert({
    user_id: invite.owner_id,
    event_type: "key_holder_invite_sent",
    event_meta: { invite_id: invite.id, holder_email: invite.holder_email }
  });

  return { ok: true, state: "sent", provider_message_id: providerMessageId };
}

async function abandonDelivery(admin: ReturnType<typeof createClient>, deliveryId: string, reason: string) {
  await admin.from("email_deliveries").update({
    state: "failed",
    failure_reason: reason,
    updated_at: new Date().toISOString()
  }).eq("id", deliveryId);
  await admin.from("invite_email_outbox").delete().eq("delivery_id", deliveryId);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS }
  });
}

function buildText({ ownerName, label, role, inviteUrl }: { ownerName: string; label: string; role: string; inviteUrl: string }) {
  return [
    `${ownerName} has invited you to be a trusted nominee/key holder on Lyfos.`,
    "",
    `Your role is ${role}. If a recovery is approved, the primary (or approved backup) still needs two other nominees plus a 14-day owner-protection hold. No one can open the vault alone.`,
    "",
    `Lyfos never emails or shows you a plain unlock key. When you accept, your account creates a cryptographic release key. Later, ${ownerName}'s vault share is sealed to that key.`,
    "",
    `Label: ${label}`,
    `Accept: ${inviteUrl}`,
    "",
    "If you weren't expecting this, ignore the email. The invite expires the moment they revoke it.",
    "",
    "— Lyfos"
  ].join("\n");
}

function buildHtml({ ownerName, label, role, inviteUrl }: { ownerName: string; label: string; role: string; inviteUrl: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:48px 24px;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:11px;font-weight:600;letter-spacing:0.18em;color:#86868b;text-transform:uppercase;margin:0 0 16px">Trusted nominee invite</p>
    <h1 style="font-size:36px;font-weight:600;letter-spacing:-0.01em;line-height:1.15;margin:0 0 20px">${escape(ownerName)} nominated you.</h1>
    <p style="font-size:15px;line-height:1.65;margin:0 0 20px">
      ${escape(ownerName)} uses Lyfos to keep sensitive records safe. Your role is <strong>${escape(role)}</strong>. The primary (or approved backup) still needs two other nominees and a 14-day owner-protection hold. No one can open the vault alone.
    </p>
    <p style="font-size:15px;line-height:1.65;margin:0 0 32px">
      Your label: <strong>${escape(label)}</strong>. Lyfos never emails or shows a plain unlock key. Your account creates a release keypair, and later one encrypted share can be sealed to it.
    </p>
    <p style="margin:0 0 36px"><a href="${escape(inviteUrl)}" style="display:inline-block;padding:12px 22px;border-radius:9999px;background:#1d1d1f;color:#fff;text-decoration:none;font-size:14px;font-weight:600">Accept invite</a></p>
    <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:36px 0" />
    <p style="font-size:11px;color:#a1a1a6;line-height:1.55;margin:0">If you weren't expecting this, ignore the email. The invite expires the moment ${escape(ownerName)} revokes it. <a href="${escape(APP_URL)}" style="color:#6e6e73">Learn more about Lyfos</a>.</p>
  </div>
</body></html>`;
}

function escape(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}

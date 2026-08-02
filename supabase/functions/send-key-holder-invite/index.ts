// Lyfos — send-key-holder-invite Edge Function.
//
// Called by the owner-side client after a key_holders row is inserted.
// Verifies the caller is the row's owner (via their JWT, then matching
// against owner_id), fetches the row, and sends the invite email via
// Resend.
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

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
// @ts-ignore
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
// @ts-ignore
const APP_URL      = Deno.env.get("APP_URL") ?? "https://app.lyfos.in";

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "missing bearer" }, 401);

  const jwt = authHeader.slice("Bearer ".length);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Resolve the calling user from the JWT
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user?.id) return json({ ok: false, error: "invalid token" }, 401);
  const callerId = who.user.id;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const inviteId = body?.invite_id;
  const inviteToken = body?.invite_token;
  const deliveryId = body?.delivery_id;
  if (!inviteId || typeof inviteId !== "string") return json({ ok: false, error: "invite_id required" }, 400);
  if (!inviteToken || typeof inviteToken !== "string") return json({ ok: false, error: "invite_token required" }, 400);
  if (!deliveryId || typeof deliveryId !== "string") return json({ ok: false, error: "delivery_id required" }, 400);

  // Fetch the invite row + the owner's email
  const { data: invite, error: invErr } = await admin
    .from("key_holders")
    .select("id, owner_id, holder_email, label, role, invite_token_hash, invite_expires_at, status")
    .eq("id", inviteId)
    .maybeSingle();
  if (invErr) return json({ ok: false, error: invErr.message }, 500);
  if (!invite)          return json({ ok: false, error: "invite not found" }, 404);
  if (invite.owner_id !== callerId) return json({ ok: false, error: "not your invite" }, 403);
  if (invite.status !== "pending")  return json({ ok: false, error: "invite is not pending" }, 410);
  if (invite.invite_expires_at && new Date(invite.invite_expires_at).getTime() <= Date.now()) {
    return json({ ok: false, error: "invite expired" }, 410);
  }
  if (await sha256(inviteToken) !== invite.invite_token_hash) {
    return json({ ok: false, error: "invite token mismatch" }, 403);
  }

  const { data: delivery, error: deliveryErr } = await admin
    .from("email_deliveries")
    .select("id, related_holder_id, state, idempotency_key")
    .eq("id", deliveryId)
    .maybeSingle();
  if (deliveryErr) return json({ ok: false, error: deliveryErr.message }, 500);
  if (!delivery || delivery.related_holder_id !== invite.id) return json({ ok: false, error: "delivery not found" }, 404);
  if (!['queued', 'delayed', 'failed'].includes(delivery.state)) {
    return json({ ok: true, state: delivery.state });
  }

  const { data: ownerRow } = await admin.auth.admin.getUserById(invite.owner_id);
  const ownerEmail = ownerRow?.user?.email ?? "your-friend@lyfos";
  const ownerName  = ownerEmail.split("@")[0];

  if (!RESEND_KEY) {
    await admin.from("email_deliveries").update({ state: "failed", failure_reason: "RESEND_API_KEY not configured" }).eq("id", delivery.id);
    return json({ ok: false, state: "failed", reason: "Email delivery is not configured" }, 503);
  }

  let inviteUrl: string;
  try {
    inviteUrl = externalUrl(`/invite/${inviteToken}`);
  } catch (error) {
    await admin.from("email_deliveries").update({ state: "failed", failure_reason: String(error) }).eq("id", delivery.id);
    return json({ ok: false, state: "failed", error: "APP_URL must be a public HTTPS URL" }, 500);
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
    return json({ ok: false, error: `Resend rejected: ${msg.slice(0, 200)}` }, 502);
  }

  const provider = await result.json().catch(() => ({}));
  await admin.from("email_deliveries").update({
    state: "sent",
    provider_message_id: provider?.id ?? null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    failure_reason: null
  }).eq("id", delivery.id);

  await admin.from("audit_log").insert({
    user_id: invite.owner_id,
    event_type: "key_holder_invite_sent",
    event_meta: { invite_id: invite.id, holder_email: invite.holder_email }
  });

  return json({ ok: true, state: "sent", provider_message_id: provider?.id ?? null });
});

function externalUrl(path: string): string {
  const base = new URL(APP_URL);
  if (base.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(base.hostname.toLowerCase())) {
    throw new Error("APP_URL must be a public HTTPS URL");
  }
  return new URL(path, `${base.origin}/`).toString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
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

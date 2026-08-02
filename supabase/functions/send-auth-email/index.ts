// Supabase Auth Send Email Hook routed through the same Resend account as
// Circle invitations. Deploy with --no-verify-jwt; the Standard Webhooks
// signature is the authentication boundary.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { Webhook } from "npm:standardwebhooks@1";
import { requireExternalAppUrl } from "../_shared/public-app-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
const APP_URL = requireExternalAppUrl(Deno.env.get("APP_URL") ?? "https://app.lyfos.in");

serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  if (!HOOK_SECRET || !RESEND_KEY) return Response.json({ error: "email hook is not configured" }, { status: 503 });

  const raw = await req.text();
  let hook: AuthEmailHook;
  try {
    hook = new Webhook(HOOK_SECRET).verify(raw, Object.fromEntries(req.headers)) as AuthEmailHook;
  } catch {
    return Response.json({ error: { http_code: 401, message: "invalid hook signature" } }, { status: 401 });
  }

  const { user, email_data: emailData } = hook;
  const actionUrl = buildActionUrl(emailData);
  const purpose = purposeFor(emailData.email_action_type);
  const idempotencyKey = `auth:${emailData.email_action_type}:${emailData.token_hash}`;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: existing, error: lookupError } = await admin
    .from("email_deliveries")
    .select("id, state")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (lookupError) return Response.json({ error: { http_code: 500, message: lookupError.message } }, { status: 500 });
  if (existing && ["sent", "delivered"].includes(existing.state)) return Response.json({});

  let delivery = existing;
  if (!delivery) {
    const { data: inserted, error: insertError } = await admin
      .from("email_deliveries")
      .insert({
        purpose,
        recipient_email: user.email,
        state: "queued",
        idempotency_key: idempotencyKey
      })
      .select("id, state")
      .single();
    if (insertError) return Response.json({ error: { http_code: 500, message: insertError.message } }, { status: 500 });
    delivery = inserted;
  }
  if (!delivery) return Response.json({ error: { http_code: 500, message: "delivery ledger unavailable" } }, { status: 500 });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: user.email,
      subject: subjectFor(emailData.email_action_type),
      html: authEmailHtml({ actionUrl, token: emailData.token, actionType: emailData.email_action_type }),
      text: authEmailText({ actionUrl, token: emailData.token, actionType: emailData.email_action_type }),
      tags: [{ name: "delivery_id", value: delivery.id }]
    })
  });

  if (!response.ok) {
    const reason = (await response.text()).slice(0, 500);
    await admin.from("email_deliveries").update({ state: "failed", failure_reason: reason, updated_at: new Date().toISOString() }).eq("id", delivery.id);
    return Response.json({ error: { http_code: 502, message: "email provider rejected the auth email" } }, { status: 502 });
  }

  const provider = await response.json().catch(() => ({}));
  const providerMessageId = provider?.id ?? null;
  const { error: sentUpdateError } = await admin.from("email_deliveries").update({
    state: "sent",
    provider_message_id: providerMessageId,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    failure_reason: null
  }).eq("id", delivery.id);
  if (sentUpdateError) {
    return Response.json({ error: { http_code: 500, message: "provider accepted the auth email but delivery state was not recorded" } }, { status: 500 });
  }
  if (providerMessageId) {
    const { error: reconcileError } = await admin.rpc("apply_email_delivery_events", {
      p_provider_message_id: providerMessageId
    });
    if (reconcileError) {
      return Response.json({ error: { http_code: 500, message: "auth email delivery event reconciliation failed" } }, { status: 500 });
    }
  }

  return Response.json({});
});

type AuthEmailHook = {
  user: { email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
  };
};

function buildActionUrl(data: AuthEmailHook["email_data"]): string {
  const url = new URL("/auth/v1/verify", SUPABASE_URL);
  url.searchParams.set("token", data.token_hash);
  url.searchParams.set("type", data.email_action_type);
  url.searchParams.set("redirect_to", canonicalRedirect(data.redirect_to));
  return url.toString();
}

function canonicalRedirect(value: string): string {
  try {
    const redirect = new URL(value);
    if (redirect.protocol === "https:" && redirect.origin === APP_URL) return redirect.toString();
  } catch {
    // Fall through to the configured public app origin.
  }
  return `${APP_URL}/`;
}

function purposeFor(actionType: string): "auth_confirmation" | "magic_link" | "password_reset" {
  if (actionType === "recovery") return "password_reset";
  if (actionType === "magiclink") return "magic_link";
  return "auth_confirmation";
}

function subjectFor(actionType: string): string {
  if (actionType === "recovery") return "Reset your Lyfos account password";
  if (actionType === "magiclink") return "Your Lyfos sign-in link";
  return "Confirm your Lyfos account";
}

function authEmailText({ actionUrl, token, actionType }: { actionUrl: string; token: string; actionType: string }): string {
  return [
    subjectFor(actionType),
    "",
    `Continue securely: ${actionUrl}`,
    "",
    `Temporary code: ${token}`,
    "",
    "If you did not request this, ignore this email.",
    "",
    "— Lyfos"
  ].join("\n");
}

function authEmailHtml({ actionUrl, token, actionType }: { actionUrl: string; token: string; actionType: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:48px 24px;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f"><div style="max-width:520px;margin:0 auto"><p style="font-size:11px;font-weight:600;letter-spacing:.18em;color:#86868b;text-transform:uppercase">Lyfos security</p><h1 style="font-size:32px;line-height:1.15">${escapeHtml(subjectFor(actionType))}</h1><p style="font-size:15px;line-height:1.6;color:#6e6e73">This link returns you to the exact Lyfos step you started.</p><p style="margin:30px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1d1d1f;color:white;text-decoration:none;font-weight:600">Continue securely</a></p><p style="font-size:12px;color:#86868b">Temporary code: <strong>${escapeHtml(token)}</strong></p><p style="margin-top:34px;font-size:11px;color:#a1a1a6">If you did not request this, ignore this email.</p></div></body></html>`;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

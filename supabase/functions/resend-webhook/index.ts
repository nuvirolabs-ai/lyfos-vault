// Signed Resend delivery events. Deploy with --no-verify-jwt; webhook
// signature verification and idempotent event ids are the trust boundary.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { Webhook } from "npm:svix@1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  if (!WEBHOOK_SECRET) return Response.json({ error: "webhook is not configured" }, { status: 503 });

  const raw = await req.text();
  let event: ResendEvent;
  try {
    event = new Webhook(WEBHOOK_SECRET).verify(raw, Object.fromEntries(req.headers)) as ResendEvent;
  } catch {
    return Response.json({ error: "invalid webhook signature" }, { status: 401 });
  }

  const eventId = req.headers.get("svix-id") ?? req.headers.get("webhook-id");
  if (!eventId) return Response.json({ error: "event id missing" }, { status: 400 });
  const providerMessageId = event.data?.email_id ?? event.data?.id ?? null;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { error: eventError } = await admin.from("email_delivery_events").insert({
    event_id: eventId,
    provider_message_id: providerMessageId,
    event_type: event.type,
    payload: event,
    occurred_at: event.created_at ?? null
  });
  const duplicate = eventError?.code === "23505";
  if (eventError && !duplicate) return Response.json({ error: eventError.message }, { status: 500 });

  let matched = false;
  if (providerMessageId) {
    const { data, error: reconcileError } = await admin.rpc("apply_email_delivery_events", {
      p_provider_message_id: providerMessageId
    });
    if (reconcileError) return Response.json({ error: reconcileError.message }, { status: 500 });
    matched = data === true;
  }

  return Response.json({ ok: true, duplicate, pending_reconciliation: Boolean(providerMessageId) && !matched });
});

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    id?: string;
    reason?: string;
    bounce?: { message?: string };
  };
};

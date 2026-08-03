// Shared CORS handling for Edge Functions invoked directly from the
// browser (via supabase-js `functions.invoke`). Without this, the
// browser's preflight OPTIONS request gets the function's normal
// "method not allowed" response with no Access-Control-Allow-Origin
// header, so the browser blocks the real request before it's sent.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// Call at the top of the handler. Returns a response to send back
// immediately for a preflight request, or null to keep handling the
// request normally.
export function corsPreflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: CORS_HEADERS }) : null;
}

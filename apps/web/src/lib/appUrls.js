const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeReturnPath(value = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://app.invalid");
    if (parsed.origin !== "https://app.invalid") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function requireExternalAppUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("External email requires an HTTPS public app URL");
  }
  if (parsed.protocol !== "https:" || LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("External email requires an HTTPS public app URL");
  }
  return parsed.origin;
}

export function buildExternalAppUrl(appUrl, returnPath = "/") {
  const origin = requireExternalAppUrl(appUrl);
  return new URL(normalizeReturnPath(returnPath), `${origin}/`).toString();
}

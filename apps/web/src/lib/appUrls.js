function isNonPublicHost(value) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1" || host.startsWith("::ffff:")) return true;
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

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
  if (parsed.protocol !== "https:" || isNonPublicHost(parsed.hostname)) {
    throw new Error("External email requires an HTTPS public app URL");
  }
  return parsed.origin;
}

export function buildExternalAppUrl(appUrl, returnPath = "/") {
  const origin = requireExternalAppUrl(appUrl);
  return new URL(normalizeReturnPath(returnPath), `${origin}/`).toString();
}

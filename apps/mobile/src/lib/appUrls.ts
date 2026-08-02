function isNonPublicHost(value: string): boolean {
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

export function publicAppOrigin(configured?: string): string {
  try {
    const url = new URL(configured || "https://app.lyfos.in");
    if (url.protocol !== "https:" || isNonPublicHost(url.hostname)) throw new Error();
    return url.origin;
  } catch {
    return "https://app.lyfos.in";
  }
}

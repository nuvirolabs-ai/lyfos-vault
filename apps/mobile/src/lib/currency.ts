// Currency formatters — mirror of apps/web/src/lib/currency.js.

export const CURRENCIES = {
  INR: { code: "INR", symbol: "₹", locale: "en-IN", compact: "in" as const },
  USD: { code: "USD", symbol: "$", locale: "en-US", compact: "en" as const },
  EUR: { code: "EUR", symbol: "€", locale: "en-IE", compact: "en" as const },
  GBP: { code: "GBP", symbol: "£", locale: "en-GB", compact: "en" as const }
};

export const DEFAULT_CURRENCY = "INR";

const COMPACT: Record<string, { from: number; divisor: number; suffix: string; round: number }[]> = {
  in: [
    { from: 10000000, divisor: 10000000, suffix: " Cr", round: 2 },
    { from: 100000,   divisor: 100000,   suffix: " L",  round: 1 },
    { from: 1000,     divisor: 1000,     suffix: "k",   round: 0 }
  ],
  en: [
    { from: 1000000000, divisor: 1000000000, suffix: "B", round: 2 },
    { from: 1000000,    divisor: 1000000,    suffix: "M", round: 1 },
    { from: 1000,       divisor: 1000,       suffix: "k", round: 0 }
  ]
};

export function getCurrency(code: string) {
  return (CURRENCIES as any)[code] ?? CURRENCIES[DEFAULT_CURRENCY];
}

export function formatCurrency(value: number, code: string = DEFAULT_CURRENCY): string {
  const c = getCurrency(code);
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat(c.locale, { maximumFractionDigits: 0 }).format(abs);
  return `${n < 0 ? "−" : ""}${c.symbol}${formatted}`;
}

export function formatCompact(value: number, code: string = DEFAULT_CURRENCY): string {
  const c = getCurrency(code);
  const table = COMPACT[c.compact] ?? COMPACT.in;
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  for (const tier of table) {
    if (abs >= tier.from) {
      const v = abs / tier.divisor;
      return `${sign}${c.symbol}${v.toFixed(tier.round)}${tier.suffix}`;
    }
  }
  return `${sign}${c.symbol}${abs}`;
}

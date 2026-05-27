// Currency formatting abstraction. India launches in INR; other currencies
// are plumbed through but not yet user-selectable. Adding a new currency
// requires:
//   - a CURRENCIES entry below
//   - a compact unit table (the localised version of "L" / "Cr" / "k")
//   - no changes anywhere else in the codebase
//
// All money rendering MUST go through formatCurrency() / formatCompact().
// Direct `₹` characters in JSX are a code smell.

export const CURRENCIES = {
  INR: { code: "INR", symbol: "₹", locale: "en-IN", compact: "in" },
  USD: { code: "USD", symbol: "$", locale: "en-US", compact: "en" },
  EUR: { code: "EUR", symbol: "€", locale: "en-IE", compact: "en" },
  GBP: { code: "GBP", symbol: "£", locale: "en-GB", compact: "en" }
};

export const DEFAULT_CURRENCY = "INR";

// Compact units per system. The "in" system uses lakh (L) and crore (Cr);
// the "en" system uses k, M, B.
const COMPACT_TABLES = {
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

export function getCurrency(code) {
  return CURRENCIES[code] ?? CURRENCIES[DEFAULT_CURRENCY];
}

/** Full-precision currency string: `₹84,32,150` or `$84,321.50`. */
export function formatCurrency(value, code = DEFAULT_CURRENCY) {
  const c = getCurrency(code);
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat(c.locale, { maximumFractionDigits: 0 }).format(abs);
  return `${n < 0 ? "−" : ""}${c.symbol}${formatted}`;
}

/** Compact form: `₹84 L`, `$847k`. Falls back to formatCurrency under the compact threshold. */
export function formatCompact(value, code = DEFAULT_CURRENCY) {
  const c = getCurrency(code);
  const table = COMPACT_TABLES[c.compact] ?? COMPACT_TABLES.in;
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";

  for (const tier of table) {
    if (abs >= tier.from) {
      const value = abs / tier.divisor;
      return `${sign}${c.symbol}${value.toFixed(tier.round)}${tier.suffix}`;
    }
  }
  return `${sign}${c.symbol}${abs}`;
}

export function currencySymbol(code = DEFAULT_CURRENCY) {
  return getCurrency(code).symbol;
}

// Balance sheet model — mirror of the bits embedded in apps/web/src/main.jsx.

export const BALANCE_SHEET_CATEGORIES = [
  { id: "cash",          kind: "asset",     label: "Cash & bank",      hint: "Savings, current, FDs" },
  { id: "investments",   kind: "asset",     label: "Investments",      hint: "Stocks, MFs, NPS, PPF, EPF, bonds" },
  { id: "real_estate",   kind: "asset",     label: "Real estate",      hint: "Property at your own valuation" },
  { id: "gold",          kind: "asset",     label: "Gold & jewellery", hint: "Physical and digital gold" },
  { id: "vehicles",      kind: "asset",     label: "Vehicles",         hint: "Cars, bikes (current resale value)" },
  { id: "crypto",        kind: "asset",     label: "Crypto",           hint: "Holdings in INR" },
  { id: "other_asset",   kind: "asset",     label: "Other assets",     hint: "Anything else of value" },
  { id: "home_loan",     kind: "liability", label: "Home loan",        hint: "Outstanding principal" },
  { id: "personal_loan", kind: "liability", label: "Personal loan",    hint: "Outstanding principal" },
  { id: "car_loan",      kind: "liability", label: "Car / vehicle loan", hint: "Outstanding principal" },
  { id: "credit_card",   kind: "liability", label: "Credit card",      hint: "Unpaid balance" },
  { id: "other_debt",    kind: "liability", label: "Other debt",       hint: "Any other liability" }
] as const;

export type CategoryId = typeof BALANCE_SHEET_CATEGORIES[number]["id"];

export function categoryById(id: string) {
  return BALANCE_SHEET_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

export function shortMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" });
}

export function snapshotForMonth(snapshots: any[], key: string) {
  return (snapshots ?? []).find((s) => s.month === key) ?? null;
}

export function netWorthFromValues(accounts: any[], values: Record<string, number>) {
  let assets = 0, liabilities = 0;
  for (const acc of accounts) {
    const v = Number(values?.[acc.id] ?? 0) || 0;
    if (acc.kind === "liability") liabilities += v;
    else assets += v;
  }
  return { assets, liabilities, net: assets - liabilities };
}

export function buildMonthlySeries(bs: any, monthsBack = 12) {
  const accounts = bs?.accounts ?? [];
  const snapshots = [...(bs?.snapshots ?? [])].sort((a: any, b: any) => a.month.localeCompare(b.month));
  const today = new Date();
  const keys: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(today.getFullYear(), today.getMonth() - i, 1)));
  }
  const series: any[] = [];
  let lastValues: any = null;
  for (const key of keys) {
    const snap = snapshotForMonth(snapshots, key);
    if (snap) {
      lastValues = snap.values;
      const t = netWorthFromValues(accounts, snap.values);
      series.push({ month: key, ...t, carried: false, empty: false });
    } else if (lastValues) {
      const t = netWorthFromValues(accounts, lastValues);
      series.push({ month: key, ...t, carried: true, empty: false });
    } else {
      series.push({ month: key, assets: 0, liabilities: 0, net: 0, carried: false, empty: true });
    }
  }
  return series;
}

export function createEmptyVault() {
  return {
    version: 1,
    items: [],
    releaseSettings: { mainNominee: "", keyHolders: ["","","","",""], emergencyOnly: true },
    balanceSheet: { accounts: [], snapshots: [], goal: null },
    audit: [{ id: makeId(), event: "Vault created", at: new Date().toISOString() }]
  };
}

export function appendAuditEvent(vault: any, event: string) {
  const audit = vault?.audit ?? [];
  return { ...vault, audit: [{ id: makeId(), event, at: new Date().toISOString() }, ...audit] };
}

function makeId() {
  return (globalThis as any).crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

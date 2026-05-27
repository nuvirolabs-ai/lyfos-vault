// Demo vault data. Only loaded on demand (?demo=1 URL flag or explicit
// "Load demo" action from the Settings drawer). This file MUST NOT be
// imported statically by main.jsx — that would put fictional Indian
// banking data back in the production bundle.
//
// Build verification: after `npm run check`, grep dist/assets/index-*.js
// for "HDFC primary account" — it should NOT appear in the main chunk.
// It will appear in a separate demoData chunk that's only fetched on demand.

/**
 * Build a fully-populated demo vault.
 * @param {object} ctx
 * @param {object} ctx.EMPTY_ITEM   - the empty item template from main.jsx
 * @param {(d: Date) => string} ctx.monthKey - YYYY-MM key formatter
 */
export function buildDemoVault({ EMPTY_ITEM, monthKey }) {
  const now = new Date().toISOString();
  const item = (type, title, fields) => ({
    ...EMPTY_ITEM,
    id: crypto.randomUUID(),
    type,
    title,
    createdAt: now,
    updatedAt: now,
    ...fields
  });

  return {
    version: 1,
    items: [
      item("bank_account", "HDFC primary account", {
        username: "Customer ID 44556677",
        secret: "NetBanking demo password: HdfcDemo@2026",
        bankDetails: "Account ending 5678. IFSC HDFC0001234. Mumbai Main Branch.",
        notes: "Primary salary account. Nominee should call branch manager before moving funds.",
        financial: { kind: "asset", value: "845000", liability: "", income: "220000", expense: "" },
        attachments: [demoAttachment("hdfc-claim-note.txt", "Nominee: Priya Sharma\nBranch: Mumbai Main")]
      }),
      item("email_account", "Primary Gmail", {
        username: "rahul.sharma@example.com",
        secret: "DemoGmail#2026!",
        email: "Recovery email: priya.sharma@example.com. Recovery phone: +91 90000 11111.",
        notes: "Financial alerts arrive here. Check labels: Banking, Insurance, Property."
      }),
      item("password", "Apple ID", {
        username: "rahul.sharma@example.com",
        secret: "DemoApple#2026!",
        notes: "Used for iCloud, device recovery, and purchases. Recovery phone is primary mobile.",
        attachments: [demoAttachment("apple-recovery.txt", "Trusted device: Rahul's MacBook Pro")]
      }),
      item("identity_document", "Passport and Aadhaar", {
        username: "Passport Z1234567 / Aadhaar ending 2211",
        secret: "DigiLocker PIN demo: 7788",
        notes: "Original passport is in the bedroom locker. Aadhaar PDF password follows family format."
      }),
      item("insurance_policy", "LIC term policy", {
        username: "Policy LIC-28473-DEMO",
        secret: "Policy portal password: LicDemo@2026",
        notes: "Sum assured demo: Rs 2 crore. Nominee: Priya Sharma. Agent: Manish Mehta.",
        financial: { kind: "asset", value: "20000000", liability: "", income: "", expense: "2600" }
      }),
      item("important_document", "Pune flat papers", {
        username: "Flat B-1204, Baner",
        secret: "Locker code demo: 7913",
        notes: "Sale deed and loan closure letter are in the bank locker.",
        financial: { kind: "asset", value: "18500000", liability: "4200000", income: "", expense: "12000" }
      }),
      item("emergency_instruction", "First 72 hours plan", {
        username: "For Main Nominee",
        secret: "Emergency contact code: FAMILY-FIRST",
        notes: "Call CA first, then branch manager, then insurance agent. Do not sell investments in week one."
      })
    ],
    releaseSettings: {
      mainNominee: "Priya Sharma - priya.sharma@example.com",
      keyHolders: [
        "Vikram Sharma - vikram@example.com",
        "Anita Roy - anita@example.com",
        "Rohan Mehta - rohan@example.com",
        "CA Nikhil Shah - nikhil@example.com",
        "Meera Iyer - meera@example.com"
      ],
      emergencyOnly: true
    },
    balanceSheet: buildDemoBalanceSheet(monthKey),
    audit: [
      { id: crypto.randomUUID(), event: "Demo vault loaded", at: now },
      { id: crypto.randomUUID(), event: "Release circle configured", at: now },
      { id: crypto.randomUUID(), event: "Vault created", at: now }
    ]
  };
}

function buildDemoBalanceSheet(monthKey) {
  const accounts = [
    { id: "acc_hdfc",      category: "cash",         kind: "asset",     name: "HDFC savings",        createdAt: new Date().toISOString() },
    { id: "acc_icici",     category: "cash",         kind: "asset",     name: "ICICI savings",       createdAt: new Date().toISOString() },
    { id: "acc_fd",        category: "cash",         kind: "asset",     name: "SBI FD",              createdAt: new Date().toISOString() },
    { id: "acc_mf",        category: "investments",  kind: "asset",     name: "Equity mutual funds", createdAt: new Date().toISOString() },
    { id: "acc_stocks",    category: "investments",  kind: "asset",     name: "Direct stocks",       createdAt: new Date().toISOString() },
    { id: "acc_epf",       category: "investments",  kind: "asset",     name: "EPF",                 createdAt: new Date().toISOString() },
    { id: "acc_ppf",       category: "investments",  kind: "asset",     name: "PPF",                 createdAt: new Date().toISOString() },
    { id: "acc_flat",      category: "real_estate",  kind: "asset",     name: "Pune flat",           createdAt: new Date().toISOString() },
    { id: "acc_gold",      category: "gold",         kind: "asset",     name: "Gold (physical)",     createdAt: new Date().toISOString() },
    { id: "acc_car",       category: "vehicles",     kind: "asset",     name: "Car",                 createdAt: new Date().toISOString() },
    { id: "acc_home_loan", category: "home_loan",    kind: "liability", name: "HDFC home loan",      createdAt: new Date().toISOString() },
    { id: "acc_cc",        category: "credit_card",  kind: "liability", name: "HDFC credit card",    createdAt: new Date().toISOString() }
  ];

  const today = new Date();
  const months = [];
  for (let i = 3; i >= 1; i--) {
    months.push(monthKey(new Date(today.getFullYear(), today.getMonth() - i, 1)));
  }

  const snapshots = months.map((m, i) => ({
    id: crypto.randomUUID(),
    month: m,
    takenAt: new Date(today.getFullYear(), today.getMonth() - (3 - i), 3).toISOString(),
    values: {
      acc_hdfc: 240000 + i * 18000,
      acc_icici: 85000 + i * 6000,
      acc_fd: 500000,
      acc_mf: 1820000 + i * 42000,
      acc_stocks: 380000 + i * 11000,
      acc_epf: 940000 + i * 12000,
      acc_ppf: 620000 + i * 4500,
      acc_flat: 18500000,
      acc_gold: 410000 + i * 3000,
      acc_car: 720000 - i * 8000,
      acc_home_loan: 4200000 - i * 26000,
      acc_cc: 42000 - i * 9000
    }
  }));

  return { accounts, snapshots };
}

function demoAttachment(name, text) {
  return {
    id: crypto.randomUUID(),
    name,
    type: "text/plain",
    size: text.length,
    dataUrl: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`
  };
}

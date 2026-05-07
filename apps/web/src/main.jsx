import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RELEASE_POLICY } from "@os-one/vault-model";
import {
  createStage1VaultRecord,
  decryptVaultWithPassphrase,
  decryptVaultWithRecoveryKey,
  generateRecoveryKey,
  normalizeRecoveryKey,
  updateEncryptedVault,
} from "./lib/stage1Crypto.js";
import { appendAuditEvent, appendAuditEvents, getAuditGroups } from "./lib/stage1Audit.js";
import {
  clearStage1Record,
  loadBackupHealth,
  loadStage1Record,
  saveBackupHealth,
  saveStage1Record
} from "./lib/stage1Store.js";
import {
  createPendingAuditEvent,
  drainPendingAuditEvents,
  formatLockReason,
  getAutoLockLabel,
  loadAutoLockPolicy,
  LOCK_TIMEOUT_OPTIONS,
  saveAutoLockPolicy,
  shouldAutoLockForActivity,
  shouldLockForVisibility
} from "./lib/stage1Session.js";
import {
  deleteAttachmentFromRecord,
  makeAttachment,
  replaceAttachmentOnRecord,
  revokeAttachmentPreviews,
  validateAttachmentFile
} from "./lib/stage1Attachments.js";
import {
  deriveBackupHealth,
  getBackupHealthCopy,
  markBackupExported,
  markBackupUnknownAfterRestore,
  markBackupVerificationFailed,
  markBackupVerified
} from "./lib/stage2BackupHealth.js";
import { verifyBackup } from "./lib/stage2BackupVerification.js";
import { getBackupReminderCopy } from "./lib/stage2BackupReminders.js";
import { prepareStage2BackupExport } from "./lib/stage2BackupManifest.js";
import {
  canConfirmDestructiveRestore,
  createRestoreDryRun,
  DESTRUCTIVE_RESTORE_CONFIRMATION
} from "./lib/stage2RestorePreview.js";
import {
  cancelRecoveryKeyReplacement,
  confirmRecoveryKeyReplacement,
  createRecoveryKeyMetadata,
  startRecoveryKeyReplacement
} from "./lib/stage2RecoveryKey.js";
import { getBackupSizeWarning } from "./lib/stage2BackupSize.js";
import "./styles.css";

const AREAS = [
  {
    id: "identity",
    label: "Identity",
    types: ["identity_document"],
    promise: "IDs, certificates, legal proof",
    description: "The proof of who you are and where official identity documents can be found.",
    suggested: ["Passport", "Aadhaar / national ID", "Birth or marriage certificate"]
  },
  {
    id: "money",
    label: "Money",
    types: ["bank_account", "card"],
    promise: "Accounts, cards, balances, obligations",
    description: "The accounts, cards, balances, and obligations your nominee must understand first.",
    suggested: ["Primary bank account", "Credit cards", "Loan or EMI account"]
  },
  {
    id: "access",
    label: "Access",
    types: ["password", "pin", "email_account"],
    promise: "Passwords, PINs, recovery routes",
    description: "The digital access routes that make recovery possible without panic.",
    suggested: ["Primary email", "Apple / Google account", "Phone and device PINs"]
  },
  {
    id: "insurance",
    label: "Insurance",
    types: ["insurance_policy"],
    promise: "Policies, claims, nominee evidence",
    description: "The claimable protection your family should be able to activate cleanly.",
    suggested: ["Term insurance", "Health policy", "Vehicle or property cover"]
  },
  {
    id: "property",
    label: "Property",
    types: ["important_document"],
    promise: "Assets, papers, locations",
    description: "The documents and instructions behind physical assets, lockers, and ownership.",
    suggested: ["Home papers", "Locker inventory", "Investment folio documents"]
  },
  {
    id: "instructions",
    label: "Instructions",
    types: ["emergency_instruction"],
    promise: "What your family must do first",
    description: "The human sequence: who to call, what not to touch, and the first decisions to avoid.",
    suggested: ["First 72 hours", "People to call", "Do-not-sell instructions"]
  }
];

const TYPE_OPTIONS = [
  ["bank_account", "Bank / money"],
  ["password", "Password"],
  ["pin", "PIN / device code"],
  ["email_account", "Email account"],
  ["card", "Card"],
  ["identity_document", "ID document"],
  ["insurance_policy", "Insurance"],
  ["important_document", "Important document"],
  ["emergency_instruction", "Emergency instruction"]
];

const EMPTY_ITEM = {
  type: "important_document",
  title: "",
  username: "",
  secret: "",
  bankDetails: "",
  cardDetails: "",
  email: "",
  notes: "",
  financial: { kind: "none", value: "", liability: "", income: "", expense: "" },
  emergencyEligible: true,
  attachments: []
};

const EMPTY_AI_DRAFT = {
  type: "important_document",
  title: "",
  username: "",
  secret: "",
  bankDetails: "",
  notes: "",
  financial: { kind: "none", value: "", liability: "", income: "", expense: "" },
  extractedFields: [],
  warnings: [],
  needsConfirmation: true,
  confidence: 0
};

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function createEmptyVault() {
  return {
    version: 1,
    items: [],
    releaseSettings: {
      mainNominee: "",
      keyHolders: ["", "", "", "", ""],
      emergencyOnly: true
    },
    audit: [{ id: crypto.randomUUID(), event: "Vault created", at: new Date().toISOString() }]
  };
}

function createDemoAttachment(name, text) {
  return {
    id: crypto.randomUUID(),
    name,
    type: "text/plain",
    size: text.length,
    dataUrl: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`
  };
}

function createDemoVault() {
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
        attachments: [createDemoAttachment("hdfc-claim-note.txt", "Nominee: Priya Sharma\nBranch: Mumbai Main")]
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
        attachments: [createDemoAttachment("apple-recovery.txt", "Trusted device: Rahul's MacBook Pro")]
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
    audit: [
      { id: crypto.randomUUID(), event: "Demo vault loaded", at: now },
      { id: crypto.randomUUID(), event: "Release circle configured", at: now },
      { id: crypto.randomUUID(), event: "Vault created", at: now }
    ]
  };
}

async function persistVault(key, vault, recordMeta) {
  const nextRecord = await updateEncryptedVault(recordMeta, key, vault);
  saveStage1Record(localStorage, nextRecord);
  return nextRecord;
}

function downloadTextFile(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readFileAsAttachment(file, existingNames = []) {
  return new Promise((resolve, reject) => {
    const validation = validateAttachmentFile(file);
    if (!validation.ok) {
      reject(new Error(validation.reason));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(makeAttachment({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: reader.result
    }, existingNames));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function readFilesAsAttachments(files, existingAttachments = []) {
  const attachments = [];
  const names = existingAttachments.map((attachment) => attachment.name);
  for (const file of [...files]) {
    const attachment = await readFileAsAttachment(file, names);
    attachments.push(attachment);
    names.push(attachment.name);
  }
  return attachments;
}

function parseMoney(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function getFinancialSnapshot(items) {
  return items.reduce((acc, item) => {
    const financial = item.financial ?? {};
    acc.assets += parseMoney(financial.value);
    acc.liabilities += parseMoney(financial.liability);
    acc.income += parseMoney(financial.income);
    acc.expenses += parseMoney(financial.expense);
    return acc;
  }, { assets: 0, liabilities: 0, income: 0, expenses: 0 });
}

function areaState(area, items) {
  const records = items.filter((item) => area.types.includes(item.type));
  if (records.length === 0) return "exposed";
  const emergencyReady = records.filter((item) => item.emergencyEligible);
  const stale = records.some((item) => {
    if (!item.updatedAt) return true;
    return (Date.now() - new Date(item.updatedAt).getTime()) / 86400000 > 90;
  });
  if (stale || emergencyReady.length !== records.length) return "review";
  return "protected";
}

function getLifeModel(vault) {
  const areas = AREAS.map((area) => {
    const records = vault.items.filter((item) => area.types.includes(item.type));
    return { ...area, count: records.length, state: areaState(area, vault.items) };
  });
  const protectedCount = areas.filter((area) => area.state === "protected").length;
  const exposedCount = areas.filter((area) => area.state === "exposed").length;
  const reviewCount = areas.filter((area) => area.state === "review").length;
  const keyCount = vault.releaseSettings.keyHolders.filter((holder) => holder.trim()).length;
  const releaseReady = vault.releaseSettings.mainNominee.trim() && keyCount >= RELEASE_POLICY.requiredKeys;
  const completion = Math.round(((protectedCount * 1 + reviewCount * 0.45 + (releaseReady ? 1 : 0)) / (areas.length + 1)) * 100);
  return {
    areas,
    protectedCount,
    exposedCount,
    reviewCount,
    keyCount,
    releaseReady,
    completion,
    nextGap: areas.find((area) => area.state === "exposed") ?? areas.find((area) => area.state === "review") ?? null,
    financial: getFinancialSnapshot(vault.items)
  };
}

function getAreaForType(type) {
  return AREAS.find((area) => area.types.includes(type)) ?? AREAS[4];
}

function typeLabel(type) {
  return TYPE_OPTIONS.find(([id]) => id === type)?.[1] ?? "Record";
}

function releaseLabel(item) {
  if (!item.emergencyEligible) return "Private";
  if (!item.updatedAt) return "Needs review";
  const days = (Date.now() - new Date(item.updatedAt).getTime()) / 86400000;
  return days > 90 ? "Needs review" : "Emergency-enabled";
}

function releaseTone(status) {
  if (status === "Emergency-enabled") return "bg-[#34c759]/10 text-[#0b6b3a] border-[#34c759]/20";
  if (status === "Needs review") return "bg-[#c88719]/10 text-[#8a6400] border-[#c88719]/20";
  return "bg-[#1d1d1f]/6 text-[#6e6e73] border-black/10";
}

function releaseToneDark(status) {
  if (status === "Emergency-enabled") return "border-[#72d98a]/25 bg-[#72d98a]/12 text-[#b7f3c4]";
  if (status === "Needs review") return "border-[#ffd166]/25 bg-[#ffd166]/12 text-[#ffe0a3]";
  return "border-white/10 bg-white/8 text-white/58";
}

function confidenceLabel(score = 0) {
  if (score >= 86) return "High";
  if (score >= 65) return "Medium";
  return "Low";
}

function TrustNote({ label, children, dark = false, tone = "neutral" }) {
  const darkTone = tone === "warning"
    ? "border-[#ffd166]/20 bg-[#ffd166]/10 text-[#ffe0a3]"
    : "border-white/[0.09] bg-white/[0.06] text-white/62";
  const lightTone = tone === "warning"
    ? "border-[#c88719]/20 bg-[#c88719]/8 text-[#6a4a00]"
    : "border-black/10 bg-[#f5f5f7] text-[#6e6e73]";
  return (
    <div className={cx("rounded-[1.35rem] border p-4", dark ? darkTone : lightTone)}>
      <p className={cx("text-xs font-semibold uppercase tracking-[0.12em]", dark ? "text-white/44" : "text-[#86868b]")}>{label}</p>
      <p className={cx("mt-2 text-sm leading-6", dark ? "text-white/64" : "text-[#6e6e73]")}>{children}</p>
    </div>
  );
}

function createBlankRecord(area) {
  return {
    ...EMPTY_ITEM,
    type: area.types[0],
    title: "",
    emergencyEligible: true,
    attachments: [],
    financial: { kind: "none", value: "", liability: "", income: "", expense: "" }
  };
}

function attachmentKind(file) {
  const type = file.type || "";
  if (type.startsWith("image/")) return "Image";
  if (type.includes("pdf")) return "PDF";
  if (type.includes("word") || file.name.match(/\.(doc|docx)$/i)) return "Document";
  if (type.includes("text") || file.name.match(/\.(txt|md|csv)$/i)) return "Text";
  return "File";
}

function attachmentIcon(kind) {
  if (kind === "Image") return "IMG";
  if (kind === "PDF") return "PDF";
  if (kind === "Document") return "DOC";
  if (kind === "Text") return "TXT";
  return "FILE";
}

function analyzeMessyInput(text) {
  const lower = text.toLowerCase();
  const bankMatch = text.match(/\b(hdfc|icici|sbi|axis|kotak|yes bank|indusind|idfc|bank of baroda|canara)\b/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const ifscMatch = text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/i);
  const policyMatch = text.match(/\b(?:policy|pol)\D*([A-Z0-9-]{5,})/i);
  const cardMatch = text.match(/\b(?:card|cc|credit|debit)\D*(?:ending|no|number)?\D*([0-9]{4}(?:[ -]?[0-9]{4}){0,3})/i);
  const accountMatch = text.match(/\b(?:account|a\/c|acct|customer id|cust id)\D*([A-Z0-9@._-]{4,})/i);
  const passwordMatch = text.match(/\b(?:netbanking\s+password|password|pwd|pass)\s*(?:is|:|=|-)?\s*([A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|.<>/?]{6,64})/i);
  const pinMatch = text.match(/\b(?:pin|passcode|locker code|device code|code)\s*(?:is|:|=|-)?\s*([0-9]{4,8})\b/i);
  const phoneMatch = text.match(/(?:\+91[- ]?)?[6-9][0-9]{9}/);
  const nomineeMatch = text.match(/\bnominee\D*([A-Za-z ]{3,40})/i);
  const amountMatch = text.match(/(?:balance|value|amount|sum assured|limit|worth|rs|inr)\D*([0-9][0-9,]*)/i);
  const expiryMatch = text.match(/\b(?:exp|expiry)\D*([0-9]{2}\/[0-9]{2,4})/i);
  const secretValue = passwordMatch?.[1] ?? pinMatch?.[1] ?? "";
  const warnings = [];
  const confidenceSignals = [bankMatch, emailMatch, ifscMatch, policyMatch, cardMatch, accountMatch, secretValue, phoneMatch, nomineeMatch, amountMatch].filter(Boolean).length;

  let type = "important_document";
  let title = "Structured life record";
  let kind = "none";

  if (lower.includes("gmail") || lower.includes("email")) {
    type = "email_account";
    title = "Recovered email access";
  } else if (lower.includes("bank") || lower.includes("ifsc") || lower.includes("account")) {
    type = "bank_account";
    title = `${bankMatch?.[1]?.toUpperCase() ?? "Bank"} account`;
    kind = "asset";
  } else if (lower.includes("policy") || lower.includes("insurance") || lower.includes("lic")) {
    type = "insurance_policy";
    title = "Insurance policy";
    kind = "asset";
  } else if (lower.includes("card") || lower.includes("credit")) {
    type = "card";
    title = "Card record";
    kind = "liability";
  } else if (lower.includes("pin")) {
    type = "pin";
    title = "PIN record";
  }

  if (passwordMatch && /^\d{4,6}$/.test(passwordMatch[1])) {
    warnings.push("Password looks like a short PIN. Confirm this before saving.");
  }
  if (type === "bank_account" && cardMatch) {
    warnings.push("This capture also contains card details. Consider saving a separate card dossier.");
  }
  if (!secretValue) {
    warnings.push("No password, PIN, or code was confidently detected.");
  }

  const field = (label, value, source, confidence = "Medium") => value ? { label, value, source, confidence } : null;
  const extractedFields = [
    field("Bank", bankMatch?.[1]?.toUpperCase(), "Matched known bank name", "High"),
    field("Email", emailMatch?.[0], "Matched email pattern", "High"),
    field("IFSC", ifscMatch?.[0]?.toUpperCase(), "Matched IFSC format", "High"),
    field("Policy", policyMatch?.[1], "Found policy label", "Medium"),
    field("Card", cardMatch?.[1], "Found card/ending label", "Medium"),
    field("Account / ID", accountMatch?.[1], "Found account/customer label", "Medium"),
    field("Password", passwordMatch?.[1], "Found password label", "High"),
    field("PIN / code", pinMatch?.[1], "Found PIN/code label", "High"),
    field("Phone", phoneMatch?.[0], "Matched phone pattern", "Medium"),
    field("Nominee", nomineeMatch?.[1]?.trim(), "Found nominee label", "Medium"),
    field("Amount", amountMatch?.[1], "Found balance/value label", "Medium"),
    field("Expiry", expiryMatch?.[1], "Found expiry label", "Medium")
  ].filter(Boolean);

  const details = [
    bankMatch && `Bank: ${bankMatch[1].toUpperCase()}`,
    ifscMatch && `IFSC: ${ifscMatch[0].toUpperCase()}`,
    accountMatch && `Account / Customer ID: ${accountMatch[1]}`,
    emailMatch && `Email: ${emailMatch[0]}`,
    cardMatch && `Card: ${cardMatch[1]}`,
    expiryMatch && `Expiry: ${expiryMatch[1]}`,
    policyMatch && `Policy: ${policyMatch[1]}`,
    phoneMatch && `Phone: ${phoneMatch[0]}`,
    nomineeMatch && `Nominee: ${nomineeMatch[1].trim()}`
  ].filter(Boolean).join("\n");

  return {
    ...EMPTY_AI_DRAFT,
    type,
    title,
    username: emailMatch?.[0] ?? accountMatch?.[1] ?? policyMatch?.[1] ?? cardMatch?.[1] ?? "",
    secret: secretValue,
    bankDetails: details || text.slice(0, 500),
    notes: `Structured from messy capture. Review every field before saving.\n\nOriginal:\n${text.slice(0, 500)}`,
    extractedFields,
    warnings,
    confidence: Math.min(96, 42 + confidenceSignals * 9),
    financial: {
      kind,
      value: kind === "asset" ? (amountMatch?.[1] ?? "") : "",
      liability: kind === "liability" ? (amountMatch?.[1] ?? "") : "",
      income: "",
      expense: ""
    }
  };
}

function analyzeMessyInputRecords(text) {
  const primary = analyzeMessyInput(text);
  const lower = text.toLowerCase();
  const records = [primary];
  const hasBank = lower.includes("bank") || lower.includes("ifsc") || lower.includes("account");
  const cardMatch = text.match(/\b(?:card|cc|credit|debit)\D*(?:ending|no|number)?\D*([0-9]{4}(?:[ -]?[0-9]{4}){0,3})/i);
  const cardLimit = text.match(/\b(?:limit|credit limit|outstanding)\D*([0-9][0-9,]*)/i);
  const policyMatch = text.match(/\b(?:policy|pol|lic)\D*([A-Z0-9-]{5,})/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const identityMatch = text.match(/\b(passport|aadhaar|aadhar|pan)\b/i);

  if (cardMatch && primary.type !== "card") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "card",
      title: "Card record",
      username: `Card ending ${cardMatch[1].slice(-4)}`,
      secret: "",
      cardDetails: `Card reference: ${cardMatch[1]}${cardLimit ? `\nLimit / amount: ${cardLimit[1]}` : ""}`,
      notes: `Split from the same messy capture. Confirm whether this should stay separate from the bank record.\n\nOriginal:\n${text.slice(0, 500)}`,
      emergencyEligible: false,
      extractedFields: [
        { label: "Card", value: cardMatch[1], source: "Found card/ending label", confidence: "Medium" },
        cardLimit && { label: "Limit", value: cardLimit[1], source: "Found limit label", confidence: "Medium" }
      ].filter(Boolean),
      warnings: ["Card details were found inside another capture. Save separately only after confirming."],
      needsConfirmation: true,
      confidence: hasBank ? 68 : 78,
      financial: { kind: "liability", value: "", liability: cardLimit?.[1] ?? "", income: "", expense: "" }
    });
  }

  if (policyMatch && primary.type !== "insurance_policy") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "insurance_policy",
      title: "Insurance policy",
      username: policyMatch[1],
      notes: `Policy-like details were detected. Confirm insurer, nominee, and claim contact before saving.\n\nOriginal:\n${text.slice(0, 500)}`,
      extractedFields: [{ label: "Policy", value: policyMatch[1], source: "Found policy/LIC label", confidence: "Medium" }],
      warnings: ["Policy record needs insurer, nominee, and claim contact before it is recovery-ready."],
      needsConfirmation: true,
      confidence: 70,
      financial: { kind: "asset", value: "", liability: "", income: "", expense: "" }
    });
  }

  if ((lower.includes("gmail") || lower.includes("email") || lower.includes("apple id") || lower.includes("google account")) && emailMatch && primary.type !== "email_account") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "email_account",
      title: lower.includes("apple") ? "Apple ID access" : "Email access",
      username: emailMatch[0],
      notes: `Access account detected. Confirm recovery phone, trusted device, and emergency visibility.\n\nOriginal:\n${text.slice(0, 500)}`,
      extractedFields: [{ label: "Email", value: emailMatch[0], source: "Matched email pattern", confidence: "High" }],
      warnings: ["No recovery route was detected. Add recovery phone/device notes before relying on this."],
      needsConfirmation: true,
      confidence: 74
    });
  }

  if (identityMatch && primary.type !== "identity_document") {
    records.push({
      ...EMPTY_AI_DRAFT,
      type: "identity_document",
      title: `${identityMatch[1][0].toUpperCase()}${identityMatch[1].slice(1)} document`,
      username: identityMatch[1],
      notes: `Identity document mention detected. Add document number, storage location, and proof file.\n\nOriginal:\n${text.slice(0, 500)}`,
      extractedFields: [{ label: "Document", value: identityMatch[1], source: "Matched identity document keyword", confidence: "Low" }],
      warnings: ["Only the document type was detected. This is not enough for recovery."],
      needsConfirmation: true,
      confidence: 48
    });
  }

  return records.map((record, index) => ({
    ...record,
    candidateId: crypto.randomUUID(),
    reviewState: record.warnings?.length ? "Needs confirmation" : "Ready to review",
    title: record.title || `Captured record ${index + 1}`
  }));
}

function App() {
  const [storedRecord, setStoredRecord] = useState(null);
  const [vaultKey, setVaultKey] = useState(null);
  const [vault, setVault] = useState(null);
  const [notice, setNotice] = useState("");
  const [lockNotice, setLockNotice] = useState("");
  const [autoLockMs, setAutoLockMs] = useState(() => loadAutoLockPolicy(localStorage));
  const [backupHealth, setBackupHealth] = useState(() => loadBackupHealth(localStorage));
  const backupSizeWarning = useMemo(() => getBackupSizeWarning({
    encryptedPayloadBytes: storedRecord ? new TextEncoder().encode(JSON.stringify(storedRecord, null, 2)).byteLength : 0,
    encryptedAttachmentBytes: 0
  }), [storedRecord]);
  const vaultRef = useRef(null);
  const vaultKeyRef = useRef(null);
  const storedRecordRef = useRef(null);
  const autoLockMsRef = useRef(autoLockMs);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    document.body.dataset.theme = "light";
    setStoredRecord(loadStage1Record(localStorage));
  }, []);

  useEffect(() => {
    if (!storedRecord?.updatedAt) return;
    const derived = deriveBackupHealth({
      storedHealth: backupHealth,
      currentVault: { updatedAt: storedRecord.updatedAt }
    });
    if (derived.status !== backupHealth.status) updateBackupHealth(derived);
  }, [storedRecord?.updatedAt]);

  useEffect(() => {
    vaultRef.current = vault;
    vaultKeyRef.current = vaultKey;
    storedRecordRef.current = storedRecord;
    autoLockMsRef.current = autoLockMs;
  }, [vault, vaultKey, storedRecord, autoLockMs]);

  useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const checkAutoLock = () => {
      if (vaultRef.current && vaultKeyRef.current && shouldAutoLockForActivity(lastActivityRef.current, Date.now(), autoLockMsRef.current)) {
        lockVault("Auto-lock after inactivity");
      }
    };
    const handleVisibility = () => {
      if (vaultRef.current && vaultKeyRef.current && shouldLockForVisibility(document.visibilityState)) {
        lockVault("Auto-lock after app moved to background");
      }
    };
    const activityEvents = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(checkAutoLock, 10000);
    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, []);

  async function saveVault(nextVault, changeReason = "vault_changed") {
    const nextRecord = await persistVault(vaultKey, nextVault, storedRecord);
    setVault(nextVault);
    setStoredRecord(nextRecord);
    if (changeReason) {
      updateBackupHealth(deriveBackupHealth({
        storedHealth: backupHealth,
        currentVault: { updatedAt: nextRecord.updatedAt },
        changeReason
      }));
    }
  }

  function updateBackupHealth(nextHealth) {
    const saved = saveBackupHealth(localStorage, nextHealth);
    setBackupHealth(saved);
    return saved;
  }

  async function lockVault(reason = "Manual lock") {
    const lockReason = typeof reason === "string" ? reason : "Manual lock";
    const currentVault = vaultRef.current;
    const currentKey = vaultKeyRef.current;
    const currentRecord = storedRecordRef.current;
    setVaultKey(null);
    setVault(null);
    setLockNotice(formatLockReason(lockReason));
    setNotice(formatLockReason(lockReason));
    if (currentVault && currentKey && currentRecord) {
      try {
        const auditedVault = appendAuditEvent(currentVault, lockReason);
        const nextRecord = await persistVault(currentKey, auditedVault, currentRecord);
        setStoredRecord(nextRecord);
      } catch {
        createPendingAuditEvent(localStorage, lockReason);
      }
    }
  }

  function resetVaultForTesting() {
    const ok = window.confirm("This deletes the encrypted local vault stored in this browser. Continue?");
    if (!ok) return;
    clearStage1Record(localStorage);
    setStoredRecord(null);
    setVaultKey(null);
    setVault(null);
    setBackupHealth(loadBackupHealth(localStorage));
    setNotice("Local vault removed from this browser.");
  }

  if (!vault || !vaultKey) {
    return (
      <EntryScreen
        record={storedRecord}
        notice={notice}
        lockNotice={lockNotice}
        onCreated={(record, key, nextVault) => {
          setStoredRecord(record);
          setVaultKey(key);
          setVault(nextVault);
          setLockNotice("");
          setNotice("Vault created and encrypted locally.");
        }}
        onUnlocked={async (key, nextVault, usedEnvelope) => {
          const pendingEvents = drainPendingAuditEvents(localStorage);
          const auditedVault = appendAuditEvent(
            appendAuditEvents(nextVault, pendingEvents),
            usedEnvelope === "recovery" ? "Vault unlocked with recovery key" : "Vault unlocked with phrase"
          );
          const nextRecord = await persistVault(key, auditedVault, storedRecord);
          setStoredRecord(nextRecord);
          setVaultKey(key);
          setVault(auditedVault);
          setLockNotice("");
          setNotice("");
        }}
        onUnlockFailed={(event) => createPendingAuditEvent(localStorage, event)}
        onImported={(record) => {
          setStoredRecord(record);
          setNotice("Encrypted backup imported. Unlock it with its vault phrase or recovery key.");
        }}
        onRestoreConfirmed={(record, key, nextVault) => {
          setStoredRecord(record);
          setVaultKey(key);
          setVault(nextVault);
          updateBackupHealth(markBackupUnknownAfterRestore({ health: backupHealth }));
          setNotice("Encrypted backup restored after decrypt preview.");
        }}
        backupHealth={backupHealth}
        onBackupHealthChange={updateBackupHealth}
        onReset={resetVaultForTesting}
      />
    );
  }

  return (
    <VaultExperience
      vault={vault}
      notice={notice}
      autoLockMs={autoLockMs}
      onAutoLockChange={(timeoutMs) => {
        const next = saveAutoLockPolicy(localStorage, timeoutMs);
        setAutoLockMs(next);
      }}
      onSave={saveVault}
      onLock={lockVault}
      backupSizeWarning={backupSizeWarning}
      onExport={async () => {
        const exportedAt = new Date().toISOString();
        const exportPackage = prepareStage2BackupExport({
          encryptedVaultContainer: storedRecord,
          vaultSnapshot: vault,
          exportedAt
        });
        downloadTextFile(exportPackage.filename, exportPackage.text);
        updateBackupHealth(markBackupExported({
          health: backupHealth,
          manifest: exportPackage.manifest
        }));
        const auditedVault = appendAuditEvent(vault, "Encrypted backup exported");
        const nextRecord = await persistVault(vaultKey, auditedVault, storedRecord);
        setStoredRecord(nextRecord);
        setVault(auditedVault);
        setNotice("Encrypted backup downloaded. It can only be restored with the vault phrase or recovery key.");
      }}
      onReplaceRecoveryKey={async ({ newRecoveryKey, confirmation }) => {
        const replacement = await confirmRecoveryKeyReplacement({
          encryptedRecord: storedRecord,
          vaultKey,
          newRecoveryKey,
          confirmation
        });
        if (!replacement.ok) return replacement;

        const auditedVault = appendAuditEvent(vault, replacement.auditEvent);
        const nextRecord = await updateEncryptedVault(replacement.record, vaultKey, auditedVault);
        saveStage1Record(localStorage, nextRecord);
        setStoredRecord(nextRecord);
        setVault(auditedVault);
        updateBackupHealth(deriveBackupHealth({
          storedHealth: backupHealth,
          currentVault: { updatedAt: nextRecord.updatedAt },
          changeReason: "recovery_key_replaced"
        }));
        setNotice("Recovery key replaced. Export and verify a fresh backup so this change is recoverable.");
        return { ...replacement, record: nextRecord };
      }}
      onReset={resetVaultForTesting}
    />
  );
}

function EntryScreen({ record, notice, lockNotice, onCreated, onUnlocked, onUnlockFailed, onImported, onRestoreConfirmed, backupHealth, onBackupHealthChange, onReset }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unlockMode, setUnlockMode] = useState("passphrase");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasVault = Boolean(record);
  const hasRecoveryEnvelope = Boolean(record?.keyEnvelopes?.recovery);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (hasVault) {
        const unlocked = unlockMode === "recovery"
          ? await decryptVaultWithRecoveryKey(record, passphrase)
          : await decryptVaultWithPassphrase(record, passphrase);
        await onUnlocked(unlocked.vaultKey, unlocked.vault, unlocked.usedEnvelope);
        return;
      }

      if (passphrase.length < 12) throw new Error("Use at least 12 characters. A memorable phrase is better than a short password.");
      if (passphrase !== confirm) throw new Error("Passphrases do not match.");
      if (!recoveryKey) throw new Error("Generate a recovery key before creating the vault.");
      if (normalizeRecoveryKey(recoveryConfirm) !== recoveryKey) throw new Error("Recovery key confirmation does not match.");
      const nextVault = createEmptyVault();
      const nextRecord = await createStage1VaultRecord({ vault: nextVault, passphrase, recoveryKey });
      saveStage1Record(localStorage, nextRecord);
      const unlocked = await decryptVaultWithPassphrase(nextRecord, passphrase);
      onCreated(nextRecord, unlocked.vaultKey, nextVault);
    } catch (err) {
      if (hasVault) onUnlockFailed?.(unlockMode === "recovery" ? "Failed unlock attempt with recovery key" : "Failed unlock attempt with phrase");
      setError(hasVault ? err.message : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createSampleVault() {
    setError("");
    setBusy(true);
    try {
      if (hasVault) return;
      if (passphrase.length < 12) throw new Error("Use at least 12 characters before creating a sample vault.");
      if (passphrase !== confirm) throw new Error("Passphrases do not match.");
      if (!recoveryKey) throw new Error("Generate and confirm a recovery key before creating a sample vault.");
      if (normalizeRecoveryKey(recoveryConfirm) !== recoveryKey) throw new Error("Recovery key confirmation does not match.");
      const nextVault = createDemoVault();
      const nextRecord = await createStage1VaultRecord({ vault: nextVault, passphrase, recoveryKey });
      saveStage1Record(localStorage, nextRecord);
      const unlocked = await decryptVaultWithPassphrase(nextRecord, passphrase);
      onCreated(nextRecord, unlocked.vaultKey, nextVault);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const entryTrustCopy = hasVault
    ? "The vault phrase unwraps the local vault key. Account login alone cannot decrypt records."
    : "Your vault phrase wraps the key that encrypts this local vault. OS-One does not store the phrase or a server recovery copy. Stage 1 creates a user-held recovery key; if both are lost, the encrypted vault cannot be opened.";

  return (
    <main className="min-h-screen bg-[#d6d0c6] text-[#221d16] lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-[96rem] items-stretch px-4 py-4 sm:px-6 sm:py-6 lg:h-screen lg:px-8 lg:py-8">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-black/8 bg-[#f3eee5] shadow-[0_24px_80px_rgba(30,24,18,0.12)] lg:grid-cols-[0.95fr_1.05fr]">
          <section className="entry-stage relative min-h-[16rem] overflow-hidden border-b border-black/6 bg-[#e4ddd1] lg:min-h-0 lg:border-b-0 lg:border-r lg:border-black/5" aria-hidden="true">
            <div className="entry-stage__wash" />
            <div className="entry-stage__grain" />
            <div className="entry-stage__panel" />
            <div className="entry-stage__stone" />
            <div className="entry-stage__paper" />
            <div className="entry-stage__disc" />
            <div className="entry-stage__line" />
            <div className="entry-stage__shadow" />
            <div className="entry-stage__caption">Private by design</div>
          </section>

          <section className="relative flex min-h-[calc(100vh-2rem)] items-center justify-center bg-[#f7f3eb] px-5 py-8 sm:px-8 lg:min-h-0 lg:px-12 lg:py-10">
            <form id="vault-entry" onSubmit={submit} className="w-full max-w-[28rem]">
              <div className="mb-8">
                <div className="entry-mark">
                  <span className="entry-mark__ring" />
                  <span className="entry-mark__core">O</span>
                </div>
                <p className="mt-5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#6f7c69]">OS-One Vault</p>
                <p className="mt-2 text-sm text-[#6a635b]">Private life infrastructure</p>
                <h1 className="entry-headline mt-7 text-[2.9rem] leading-[0.95] text-[#1f1a15] sm:text-[3.65rem]">
                  {hasVault ? "Enter your vault" : "Create your vault"}
                </h1>
                <p className="mt-4 max-w-md text-[1rem] leading-7 text-[#655e56]">
                  {hasVault ? "Your records stay local. Unlock with the vault phrase or the recovery key." : "Create a local encrypted vault in this browser with a phrase you control."}
                </p>
              </div>

              {hasVault && hasRecoveryEnvelope && (
                <div className="mb-6 grid grid-cols-2 rounded-full border border-black/8 bg-[#e8e2d8] p-1">
                  {[
                    ["passphrase", "Vault phrase"],
                    ["recovery", "Recovery key"]
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setUnlockMode(id)}
                      aria-pressed={unlockMode === id}
                      className={cx(
                        "rounded-full px-4 py-2.5 text-sm font-semibold transition",
                        unlockMode === id
                          ? "bg-[#f8f4ec] text-[#1f1a15] shadow-[0_1px_0_rgba(255,255,255,0.6),0_8px_20px_rgba(22,18,14,0.06)]"
                          : "text-[#6f685f] hover:text-[#1f1a15]"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <label className="block">
                <span className="sr-only">{hasVault && unlockMode === "recovery" ? "Recovery key" : "Vault phrase"}</span>
                <input
                  className="w-full rounded-[1.15rem] border border-black/10 bg-white/78 px-5 py-4 text-base text-[#221d16] outline-none transition placeholder:text-[#91887d] focus:border-[#708267]/40 focus:bg-white focus:ring-4 focus:ring-[#708267]/10"
                  type={hasVault && unlockMode === "recovery" ? "text" : "password"}
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete={hasVault ? "current-password" : "new-password"}
                  placeholder={hasVault ? "Enter your vault phrase" : "Use at least 12 characters"}
                />
              </label>

              {!hasVault && (
                <label className="mt-3 block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#7c746a]">Confirm phrase</span>
                  <input
                    className="w-full rounded-[1.15rem] border border-black/10 bg-white/78 px-5 py-4 text-base text-[#221d16] outline-none transition focus:border-[#708267]/40 focus:bg-white focus:ring-4 focus:ring-[#708267]/10"
                    type="password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              )}

              {!hasVault && (
                <div className="mt-4 rounded-[1.35rem] border border-black/8 bg-[#ece6dc] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7c746a]">Recovery key</p>
                      <p className="mt-1 text-sm text-[#645d54]">Generate and confirm the key before sealing this vault.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const key = generateRecoveryKey();
                        setRecoveryKey(key);
                        setRecoveryConfirm("");
                      }}
                      className="rounded-full border border-black/10 bg-[#f7f3eb] px-4 py-2 text-sm font-semibold text-[#221d16] transition hover:bg-white"
                    >
                      {recoveryKey ? "Regenerate" : "Generate key"}
                    </button>
                  </div>
                  {recoveryKey && (
                    <div className="mt-4">
                      <div className="select-all break-words rounded-[1rem] border border-black/8 bg-[#f8f4ec] px-4 py-3 font-mono text-xs font-semibold text-[#322c24]">
                        {recoveryKey}
                      </div>
                      <label className="mt-3 block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#7c746a]">Confirm recovery key</span>
                        <input
                          className="w-full rounded-[1rem] border border-black/10 bg-white/82 px-4 py-3 text-sm text-[#221d16] outline-none transition placeholder:text-[#91887d] focus:border-[#708267]/40 focus:bg-white focus:ring-4 focus:ring-[#708267]/10"
                          value={recoveryConfirm}
                          onChange={(event) => setRecoveryConfirm(event.target.value)}
                          placeholder="OS1A-..."
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {(lockNotice || notice || error) && (
                <div
                  aria-live="polite"
                  className={cx(
                    "mt-4 rounded-[1rem] border px-4 py-3 text-sm leading-6",
                    error
                      ? "border-[#c98979]/45 bg-[#f5d9d2] text-[#7d4033]"
                      : lockNotice
                        ? "border-[#a5ad92]/55 bg-[#ebefe4] text-[#4f5a43]"
                        : "border-[#b8c0a9]/55 bg-[#eff2ea] text-[#516046]"
                  )}
                >
                  {error || lockNotice || notice}
                </div>
              )}

              <button
                className="mt-6 w-full rounded-[1.15rem] bg-[#242119] px-5 py-4 text-base font-semibold text-[#f7f3eb] shadow-[0_16px_32px_rgba(23,19,15,0.12)] transition hover:bg-[#191612] disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
              >
                {busy ? hasVault ? "Unlocking..." : "Sealing..." : hasVault ? "Unlock vault" : "Create encrypted vault"}
              </button>

              {!hasVault && (
                <button
                  type="button"
                  onClick={createSampleVault}
                  disabled={busy}
                  className="mt-3 w-full rounded-[1.15rem] border border-black/10 bg-transparent px-5 py-3 text-sm font-semibold text-[#5d564f] transition hover:bg-white/50 disabled:cursor-wait disabled:opacity-60"
                >
                  Create vault with sample records
                </button>
              )}

              <div className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#8f867a]">
                <div className="h-px bg-black/8" />
                <span>or</span>
                <div className="h-px bg-black/8" />
              </div>

              <div className="entry-restore">
                <ImportBackup currentRecord={record} onImported={onImported} onRestoreConfirmed={onRestoreConfirmed} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="entry-verify">
                  <BackupVerificationPanel currentRecord={record} backupHealth={backupHealth} onBackupHealthChange={onBackupHealthChange} />
                </div>
                {hasVault && (
                  <button type="button" onClick={onReset} className="shrink-0 rounded-full px-1 py-2 text-xs font-semibold text-[#8d5f56] transition hover:text-[#5f3b34]">
                    Delete local vault
                  </button>
                )}
              </div>

              <div className="mt-6 border-t border-black/8 pt-5">
                <p className="max-w-md text-xs leading-6 text-[#6f685f]">{entryTrustCopy}</p>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function VaultExperience({ vault, notice, autoLockMs, onAutoLockChange, onSave, onLock, backupSizeWarning, onExport, onReplaceRecoveryKey, onReset }) {
  const [screen, setScreen] = useState("life");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [screen]);

  async function loadDemoData() {
    const ok = vault.items.length === 0 || window.confirm("Replace current vault contents with full demo data?");
    if (!ok) return;
    await onSave(createDemoVault());
    setScreen("life");
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <div className="mx-auto max-w-7xl px-5 py-5 lg:px-8">
        <header className="sticky top-4 z-20 mb-6 flex flex-wrap items-center gap-3 rounded-[1.75rem] border border-black/10 bg-white/76 px-4 py-3 shadow-[0_12px_50px_rgba(0,0,0,0.07)] backdrop-blur-2xl md:flex-nowrap md:rounded-full">
          <BrandMini />
          <nav className="order-3 flex w-full items-center justify-between gap-1 rounded-full bg-[#f5f5f7] p-1 md:order-none md:ml-auto md:w-auto md:justify-start">
            {[
              ["life", "Life Map"],
              ["capture", "Capture"],
              ["release", "Release"]
            ].map(([id, label]) => (
              <button key={id} onClick={() => setScreen(id)} className={cx("rounded-full px-4 py-2 text-sm font-semibold transition", screen === id ? "bg-[#1d1d1f] text-white shadow-sm" : "text-[#6e6e73] hover:bg-white hover:text-[#1d1d1f]")}>{label}</button>
            ))}
          </nav>
          <button onClick={loadDemoData} className="order-4 flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:scale-[1.01] md:order-none md:flex-none">Demo</button>
          <button onClick={onExport} className="order-4 flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:scale-[1.01] md:order-none md:flex-none">Backup</button>
          <button onClick={() => onLock("Manual lock")} className="ml-auto rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.01] md:ml-0">Seal</button>
        </header>

        {notice && <div className="mb-5 rounded-3xl border border-[#34c759]/20 bg-[#34c759]/10 px-5 py-4 text-sm font-semibold text-[#0b6b3a]">{notice}</div>}
        {backupSizeWarning?.level !== "none" && <BackupSizeNotice warning={backupSizeWarning} />}

        {screen === "life" && <LifeMapScreen vault={vault} autoLockMs={autoLockMs} onAutoLockChange={onAutoLockChange} onReplaceRecoveryKey={onReplaceRecoveryKey} onSave={onSave} onNavigate={setScreen} />}
        {screen === "capture" && <CaptureScreen vault={vault} onSave={onSave} onNavigate={setScreen} />}
        {screen === "release" && <ReleaseScreen vault={vault} onSave={onSave} />}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-black/10 py-6 text-xs font-medium text-[#86868b]">
          <span>Local encrypted prototype. No cloud sync, nominee release service, or phrase recovery is active yet.</span>
          <button onClick={onReset} className="text-[#b42318]">Delete local vault</button>
        </footer>
      </div>
    </main>
  );
}

function BackupSizeNotice({ warning }) {
  const strong = warning.level === "strong";
  return (
    <div className={cx(
      "mb-5 rounded-3xl border px-5 py-4 text-sm font-semibold",
      strong
        ? "border-[#c68a19]/25 bg-[#fff7e5] text-[#7a4b00]"
        : "border-black/10 bg-white text-[#6e6e73]"
    )}>
      {warning.copy}
    </div>
  );
}

function LifeMapScreen({ vault, autoLockMs, onAutoLockChange, onReplaceRecoveryKey, onSave, onNavigate }) {
  const model = useMemo(() => getLifeModel(vault), [vault]);
  const [selectedAreaId, setSelectedAreaId] = useState("identity");
  const workspaceRef = useRef(null);
  const selectedArea = model.areas.find((area) => area.id === selectedAreaId) ?? model.areas[0];

  function selectArea(id) {
    setSelectedAreaId(id);
    if (window.innerWidth < 1280) {
      window.setTimeout(() => workspaceRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
      <div className="rounded-[2.25rem] border border-black/10 bg-white p-6 shadow-[0_24px_90px_rgba(0,0,0,0.06)] lg:p-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase text-[#0071e3]">Life Map</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.04] md:text-6xl">Select an area. Work inside the dossier.</h1>
          <p className="mt-5 text-base leading-7 text-[#6e6e73]">
            The map stays visible. The workspace shows the records, proof, release state, and actions behind each part of your life.
          </p>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {model.areas.map((area, index) => (
            <LifeMapCategoryCard
              key={area.id}
              area={area}
              index={index}
              selected={area.id === selectedAreaId}
              onClick={() => selectArea(area.id)}
            />
          ))}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Signal label="Protected" value={model.protectedCount} tone="green" />
          <Signal label="Needs review" value={model.reviewCount} tone="amber" />
          <Signal label="Exposed" value={model.exposedCount} tone="red" />
        </div>

        <SecurityPanel autoLockMs={autoLockMs} onAutoLockChange={onAutoLockChange} onReplaceRecoveryKey={onReplaceRecoveryKey} />
        <AuditTrail vault={vault} />
      </div>

      <div ref={workspaceRef} className="scroll-mt-32">
        <CategoryWorkspace
          vault={vault}
          area={selectedArea}
          onSave={onSave}
          onCapture={() => onNavigate("capture")}
        />
      </div>
    </section>
  );
}

function LifeMapCategoryCard({ area, index, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "group min-h-40 rounded-[1.75rem] border p-5 text-left transition duration-300",
        selected
          ? "border-[#0071e3]/30 bg-[#0071e3]/6 shadow-[0_18px_60px_rgba(0,113,227,0.10)]"
          : "border-black/10 bg-[#fbfbfd] hover:-translate-y-1 hover:bg-white hover:shadow-[0_18px_60px_rgba(0,0,0,0.08)]"
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cx("h-3 w-3 rounded-full", area.state === "protected" && "bg-[#34c759]", area.state === "review" && "bg-[#c88719]", area.state === "exposed" && "bg-[#d70015]")} />
        <span className="text-xs font-semibold text-[#86868b]">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <h3 className="mt-8 text-2xl font-semibold">{area.label}</h3>
      <p className="mt-2 text-sm leading-5 text-[#6e6e73]">{area.promise}</p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#1d1d1f]">{area.state === "protected" ? "Protected" : area.state === "review" ? "Needs review" : "Not yet protected"}</p>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#6e6e73] shadow-sm">{area.count} record{area.count === 1 ? "" : "s"}</span>
      </div>
    </button>
  );
}

function CategoryWorkspace({ vault, area, onSave, onCapture }) {
  const [mode, setMode] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");

  const records = vault.items.filter((item) => area.types.includes(item.type));
  const filteredRecords = records.filter((item) => {
    const status = releaseLabel(item);
    const searchable = `${item.title} ${item.username} ${item.notes} ${item.bankDetails} ${item.email} ${item.cardDetails}`.toLowerCase();
    const matchesQuery = searchable.includes(query.toLowerCase());
    const matchesFilter = filter === "all" || status === filter;
    return matchesQuery && matchesFilter;
  });
  const selectedRecord = selectedId ? (records.find((item) => item.id === selectedId) ?? null) : null;

  useEffect(() => {
    setMode("overview");
    setSelectedId(null);
    setEditingRecord(null);
    setQuery("");
    setFilter("all");
    setMessage("");
  }, [area.id]);

  function startCreate() {
    setEditingRecord(createBlankRecord(area));
    setMode("edit");
  }

  function startEdit(record) {
    setEditingRecord(record);
    setMode("edit");
  }

  async function saveRecord(record, auditEvent, changeReason = "record_change") {
    const now = new Date().toISOString();
    const exists = vault.items.some((item) => item.id === record.id);
    const nextRecord = {
      ...record,
      id: record.id || crypto.randomUUID(),
      updatedAt: now,
      createdAt: record.createdAt || now
    };
    const eventName = auditEvent ?? `${exists ? "Record updated" : "Record created"}`;
    await onSave(appendAuditEvent({
      ...vault,
      items: exists
        ? vault.items.map((item) => item.id === nextRecord.id ? nextRecord : item)
        : [nextRecord, ...vault.items]
    }, eventName), changeReason);
    setSelectedId(nextRecord.id);
    setMode("detail");
    setMessage(exists ? "Dossier updated." : "Dossier created.");
  }

  async function deleteRecord(record) {
    const ok = window.confirm(`Delete "${record.title}" from this local encrypted vault?`);
    if (!ok) return;
    const now = new Date().toISOString();
    await onSave(appendAuditEvent({
      ...vault,
      items: vault.items.filter((item) => item.id !== record.id)
    }, "Record deleted"), "record_change");
    setSelectedId(null);
    setMode("overview");
    setMessage("Dossier deleted.");
  }

  async function attachToRecord(record, files) {
    const attachments = await readFilesAsAttachments(files, record.attachments ?? []);
    await saveRecord({ ...record, attachments: [...attachments, ...(record.attachments ?? [])] }, "Attachment added", "attachment_change");
  }

  async function deleteRecordAttachment(record, attachment) {
    await saveRecord(deleteAttachmentFromRecord(record, attachment.id), "Attachment deleted", "attachment_change");
  }

  async function replaceRecordAttachment(record, attachment, files) {
    const file = files?.[0];
    if (!file) return;
    const replacement = await readFileAsAttachment(file, (record.attachments ?? []).filter((item) => item.id !== attachment.id).map((item) => item.name));
    await saveRecord(replaceAttachmentOnRecord(record, attachment.id, replacement), "Attachment replaced", "attachment_change");
  }

  async function auditOnly(event) {
    await onSave(appendAuditEvent(vault, event), null);
  }

  return (
    <aside className="min-h-[760px] rounded-[2.25rem] bg-[#111113] p-5 text-white shadow-[0_24px_90px_rgba(0,0,0,0.16)] lg:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <p className="text-sm font-semibold uppercase text-[#8fd5a6]">Secure workspace</p>
          <h2 className="mt-2 text-4xl font-semibold">{area.label}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-white/42">Records are decrypted only after unlock. Release visibility here is a rule label, not a live nominee service.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={startCreate} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#111113] transition hover:scale-[1.02]">Add record</button>
          <label className="cursor-pointer rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/12">
            Upload file
            <input className="hidden" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,application/pdf" onChange={async (event) => {
              const files = event.target.files;
              if (!files?.length) return;
              const target = selectedRecord ?? createBlankRecord(area);
              await attachToRecord({ ...target, title: target.title || `${area.label} upload` }, files);
              event.target.value = "";
            }} />
          </label>
        </div>
      </div>

      {message && <div className="mt-4 rounded-2xl border border-[#34c759]/20 bg-[#34c759]/10 px-4 py-3 text-sm font-semibold text-[#a8f0bd]">{message}</div>}

      {mode === "edit" ? (
        <RecordEditorDrawer
          area={area}
          record={editingRecord}
          onCancel={() => setMode(selectedRecord ? "detail" : "overview")}
          onSave={saveRecord}
        />
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[0.74fr_1.26fr]">
          <div>
            <CategoryOverviewHeader area={area} records={records} />
            <div className="mt-4 grid gap-2 rounded-[1.35rem] border border-white/[0.08] bg-black/20 p-2">
              <input className="min-w-0 rounded-[1rem] border border-transparent bg-transparent px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/34 focus:border-white/10 focus:bg-white/[0.06]" placeholder={`Search ${area.label.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className="rounded-[1rem] border border-transparent bg-white/[0.08] px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-white/12" value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="Emergency-enabled">Emergency</option>
                <option value="Private">Private</option>
                <option value="Needs review">Needs review</option>
              </select>
            </div>
            <CategoryRecordList
              records={filteredRecords}
              selectedId={selectedRecord?.id}
              onSelect={(record) => {
                setSelectedId(record.id);
                setMode("detail");
              }}
            />
          </div>

          {mode === "detail" && selectedRecord ? (
            <RecordDetailPanel
              record={selectedRecord}
              onEdit={() => startEdit(selectedRecord)}
              onDelete={() => deleteRecord(selectedRecord)}
              onAttach={(files) => attachToRecord(selectedRecord, files)}
              onAttachmentDelete={(attachment) => deleteRecordAttachment(selectedRecord, attachment)}
              onAttachmentReplace={(attachment, files) => replaceRecordAttachment(selectedRecord, attachment, files)}
              onReveal={() => auditOnly("Sensitive value revealed")}
              onHide={() => auditOnly("Sensitive value hidden")}
              onExtract={async (text) => {
                const draft = analyzeMessyInput(text);
                await saveRecord({
                  ...selectedRecord,
                  username: selectedRecord.username || draft.username,
                  secret: selectedRecord.secret || draft.secret,
                  bankDetails: selectedRecord.bankDetails || draft.bankDetails,
                  notes: `${selectedRecord.notes || ""}\n\nExtracted from attachment:\n${draft.bankDetails}`.trim()
                }, "Attachment extraction reviewed");
              }}
            />
          ) : (
            <EmptyWorkspaceState area={area} records={filteredRecords} totalRecords={records.length} query={query} onClearSearch={() => {
              setQuery("");
              setFilter("all");
            }} onCreate={startCreate} onCapture={onCapture} onSelect={(record) => {
              setSelectedId(record.id);
              setMode("detail");
            }} />
          )}
        </div>
      )}
    </aside>
  );
}

function CategoryOverviewHeader({ area, records }) {
  const emergency = records.filter((record) => record.emergencyEligible).length;
  const review = records.filter((record) => releaseLabel(record) === "Needs review").length;
  return (
    <div className="rounded-[1.5rem] border border-white/[0.08] bg-white/[0.055] p-4">
      <p className="text-sm leading-6 text-white/58">{area.description}</p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <WorkspaceStat label="Records" value={records.length} />
        <WorkspaceStat label="Emergency" value={emergency} />
        <WorkspaceStat label="Review" value={review} />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {area.suggested.map((item) => (
          <span key={item} className="rounded-full border border-white/[0.08] bg-black/15 px-2.5 py-1 text-[11px] font-semibold text-white/50">{item}</span>
        ))}
      </div>
    </div>
  );
}

function WorkspaceStat({ label, value }) {
  return (
    <div>
      <strong className="block text-xl font-semibold">{value}</strong>
      <span className="text-[11px] font-semibold text-white/38">{label}</span>
    </div>
  );
}

function CategoryRecordList({ records, selectedId, onSelect }) {
  if (records.length === 0) {
    return <div className="mt-4 rounded-[1.5rem] border border-dashed border-white/14 p-5 text-sm leading-6 text-white/45">No matching records. Add a dossier or clear the search.</div>;
  }

  return (
    <div className="mt-4 grid gap-3">
      {records.map((record) => {
        const status = releaseLabel(record);
        return (
          <button key={record.id} onClick={() => onSelect(record)} className={cx("group rounded-[1.4rem] border p-4 text-left transition duration-300 hover:-translate-y-0.5", selectedId === record.id ? "border-[#8fd5a6]/40 bg-[#8fd5a6]/[0.13] shadow-[inset_0_0_0_1px_rgba(143,213,166,0.08),0_18px_50px_rgba(0,0,0,0.18)]" : "border-white/[0.08] bg-white/[0.055] hover:border-white/12 hover:bg-white/[0.085]")}>
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 text-base font-semibold leading-5 text-white">{record.title}</h3>
                {selectedId === record.id && <span className="h-2 w-2 shrink-0 rounded-full bg-[#8fd5a6]" />}
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-white/45">{record.username || typeLabel(record.type)}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-white/38">
              <span className={cx("rounded-full border px-2.5 py-1 text-[11px] font-semibold", releaseToneDark(status))}>{status}</span>
              <span>{record.attachments?.length ?? 0} attachment{record.attachments?.length === 1 ? "" : "s"}</span>
              <span>•</span>
              <span>{new Date(record.updatedAt || record.createdAt || Date.now()).toLocaleDateString()}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EmptyWorkspaceState({ area, records, totalRecords = records.length, query = "", onClearSearch, onCreate, onCapture, onSelect }) {
  if (records.length > 0) {
    return (
      <div className="grid min-h-[500px] place-items-center rounded-[1.75rem] border border-white/10 bg-white/7 p-6 text-center">
        <div>
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white/10 text-sm font-semibold text-white/60">OPEN</div>
          <h3 className="text-3xl font-semibold">Choose a dossier.</h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/45">Select a record on the left to view sensitive details, attachments, and release visibility.</p>
          <button onClick={() => onSelect(records[0])} className="mt-6 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#111113]">Open first record</button>
        </div>
      </div>
    );
  }

  if (totalRecords > 0) {
    return (
      <div className="grid min-h-[500px] place-items-center rounded-[1.75rem] border border-dashed border-white/14 bg-white/7 p-6 text-center">
        <div>
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white/10 text-sm font-semibold text-white/60">NONE</div>
          <h3 className="text-3xl font-semibold">No matching dossiers.</h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/45">
            {query ? `Nothing in ${area.label} matches "${query}". Your records are still here.` : "The current filter hides every dossier in this area."}
          </p>
          <button onClick={onClearSearch} className="mt-6 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#111113]">Clear search and filters</button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[500px] place-items-center rounded-[1.75rem] border border-dashed border-white/14 bg-white/7 p-6 text-center">
      <div>
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white/10 text-sm font-semibold text-white/60">NEW</div>
        <h3 className="text-3xl font-semibold">No {area.label.toLowerCase()} dossier yet.</h3>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/45">Start with one record. Attach proof now or add it later when it is available.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={onCreate} className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#111113]">Create first record</button>
          <button onClick={onCapture} className="rounded-full border border-white/10 bg-white/8 px-5 py-3 text-sm font-semibold text-white">Capture messy note</button>
        </div>
      </div>
    </div>
  );
}

function RecordDetailPanel({ record, onEdit, onDelete, onAttach, onAttachmentDelete, onAttachmentReplace, onReveal, onHide, onExtract }) {
  const [revealed, setRevealed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const status = releaseLabel(record);
  const note = record.notes || record.bankDetails || record.email || record.cardDetails || "No family note added yet.";

  return (
    <section className="min-h-[640px] overflow-hidden rounded-[1.9rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.085),rgba(255,255,255,0.045))] p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_70px_rgba(0,0,0,0.20)] lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8fd5a6]">Secure dossier</p>
          <h3 className="mt-3 text-3xl font-semibold leading-[1.05] md:text-5xl">{record.title}</h3>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/58">{typeLabel(record.type)}</span>
            <span className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold", releaseToneDark(status))}>{status}</span>
          </div>
        </div>
        <div className="relative flex flex-wrap justify-end gap-2">
          <button onClick={onEdit} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#111113] transition hover:scale-[1.02]">Edit record</button>
          <AttachmentUploader onFiles={onAttach} />
          <button onClick={() => setMoreOpen((current) => !current)} className="rounded-full border border-white/[0.1] bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.11]">More actions</button>
          {moreOpen && (
            <div className="absolute right-0 top-12 z-10 w-48 rounded-[1.25rem] border border-white/[0.1] bg-[#202124] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
              <button onClick={onDelete} className="w-full rounded-[0.9rem] px-3 py-2 text-left text-sm font-semibold text-[#ffb4ae] transition hover:bg-[#ff3b30]/10">Delete record</button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-7 grid gap-4">
        <DossierSection eyebrow="Overview" title="What this proves">
          <div className="grid gap-2 sm:grid-cols-2">
            <DetailLine label="Identifier" value={record.username || "Not added"} />
            <DetailLine label="Verification" value={status === "Needs review" ? "Needs owner review" : "Current"} />
          </div>
        </DossierSection>

        <DossierSection eyebrow="Sensitive fields" title="Hidden until intentionally revealed">
          <div className="rounded-[1.2rem] border border-white/[0.08] bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/35">Protected value</p>
                <p className="mt-2 break-all text-lg font-semibold text-white">{revealed ? (record.secret || "Not added") : maskSecret(record.secret)}</p>
              </div>
              <button onClick={() => {
                setRevealed((current) => {
                  const next = !current;
                  if (next) onReveal?.();
                  else onHide?.();
                  return next;
                });
              }} className="rounded-full border border-white/[0.12] bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.13]">
                {revealed ? "Hide value" : "Reveal value"}
              </button>
            </div>
          </div>
          <div className="mt-3">
            <TrustNote label="Reveal scope" dark>
              Reveal/hide is a screen privacy control inside an unlocked vault. It is not a second encryption layer once the vault is open.
            </TrustNote>
          </div>
        </DossierSection>

        <DossierSection eyebrow="Release settings" title={record.emergencyEligible ? "Available only inside emergency release" : "Private to owner"}>
          <div className="grid gap-2 sm:grid-cols-2">
            <DetailLine label="Visibility" value={record.emergencyEligible ? "Emergency-enabled" : "Private"} />
            <DetailLine label="Owner review" value={status === "Needs review" ? "Required" : "Current"} />
          </div>
        </DossierSection>

        <DossierSection eyebrow="Attachments" title="Proof files">
          <AttachmentGrid attachments={record.attachments ?? []} onDelete={onAttachmentDelete} onReplace={onAttachmentReplace} onExtract={onExtract} tone="dark" />
        </DossierSection>

        <DossierSection eyebrow="Notes for family" title="Plain-language instruction">
          <p className="whitespace-pre-line text-sm leading-6 text-white/68">{note}</p>
        </DossierSection>
      </div>
    </section>
  );
}

function DossierSection({ eyebrow, title, children }) {
  return (
    <section className="border-t border-white/[0.08] pt-4 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8fd5a6]/80">{eyebrow}</p>
      <h4 className="mt-1 mb-3 text-base font-semibold text-white">{title}</h4>
      {children}
    </section>
  );
}

function DetailLine({ label, value }) {
  return (
    <div className="rounded-[1.1rem] border border-white/[0.07] bg-white/[0.045] p-4">
      <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-white/35">{label}</span>
      <strong className="mt-2 block break-words text-sm font-semibold leading-5 text-white/82">{value}</strong>
    </div>
  );
}

function maskSecret(value) {
  if (!value) return "Not added";
  return "•••• •••• ••••";
}

function RecordEditorDrawer({ area, record, onCancel, onSave }) {
  const [draft, setDraft] = useState(record ?? createBlankRecord(area));
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("green");

  function handleSave() {
    const title = draft.title.trim();
    const hasSubstance = [
      draft.username,
      draft.secret,
      draft.notes,
      draft.bankDetails,
      draft.cardDetails,
      draft.email,
      draft.financial?.value,
      draft.financial?.liability
    ].some((value) => String(value ?? "").trim()) || (draft.attachments?.length ?? 0) > 0;

    if (!title) {
      setMessageTone("red");
      setMessage("Name the record before saving. A blank dossier damages trust during recovery.");
      return;
    }

    if (!hasSubstance) {
      setMessageTone("red");
      setMessage("Add at least one identifier, secret, note, financial value, or proof file before saving.");
      return;
    }

    onSave({ ...draft, title }, undefined, draft.attachments?.length ? "attachment_change" : "record_change");
  }

  async function uploadFiles(files) {
    const attachments = await readFilesAsAttachments(files, draft.attachments ?? []);
    setDraft((current) => ({ ...current, attachments: [...attachments, ...(current.attachments ?? [])] }));
  }

  function deleteDraftAttachment(attachment) {
    setDraft((current) => deleteAttachmentFromRecord(current, attachment.id));
  }

  async function replaceDraftAttachment(attachment, files) {
    const file = files?.[0];
    if (!file) return;
    const replacement = await readFileAsAttachment(file, (draft.attachments ?? []).filter((item) => item.id !== attachment.id).map((item) => item.name));
    setDraft((current) => replaceAttachmentOnRecord(current, attachment.id, replacement));
  }

  async function extractFromScreenshot(file) {
    if (!file?.type?.startsWith("image/")) {
      setMessage("Choose a screenshot or image for extraction.");
      return;
    }
    setMessageTone("green");
    setMessage("Reading screenshot locally...");
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const result = await worker.recognize(file);
    await worker.terminate();
    const extracted = analyzeMessyInput(result.data.text || "");
    setDraft((current) => ({
      ...current,
      type: extracted.type || current.type,
      title: current.title || extracted.title,
      username: current.username || extracted.username,
      secret: current.secret || extracted.secret,
      bankDetails: current.bankDetails || extracted.bankDetails,
      notes: `${current.notes || ""}\n\nExtracted from screenshot:\n${extracted.bankDetails}`.trim(),
      financial: { ...current.financial, ...extracted.financial }
    }));
    setMessageTone("green");
    setMessage("Screenshot details added to the draft. Review before saving.");
  }

  return (
    <div className="mt-5 rounded-[1.9rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.085),rgba(255,255,255,0.045))] p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_70px_rgba(0,0,0,0.20)] lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8fd5a6]">{draft.id ? "Edit dossier" : "Create dossier"}</p>
          <h3 className="mt-2 text-3xl font-semibold md:text-4xl">{area.label} record</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/48">Keep it short, verifiable, and useful to the person who may need this under stress.</p>
        </div>
        <button onClick={onCancel} className="rounded-full border border-white/[0.1] bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.11]">Close</button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <EditorField label="Title" dark>
          <input className="editor-input-dark" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={`${area.label} record name`} />
        </EditorField>
        <EditorField label="Record type" dark>
          <select className="editor-input-dark" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
            {TYPE_OPTIONS.filter(([id]) => area.types.includes(id) || area.types.length === 1).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </EditorField>
        <EditorField label="Identifier / account" dark>
          <input className="editor-input-dark" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="Account, email, policy, ID" />
        </EditorField>
        <EditorField label="Sensitive value" dark>
          <input className="editor-input-dark" value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} placeholder="Password, PIN, locker code" />
        </EditorField>
        <EditorField label="Emergency release" dark>
          <select className="editor-input-dark" value={draft.emergencyEligible ? "yes" : "no"} onChange={(event) => setDraft({ ...draft, emergencyEligible: event.target.value === "yes" })}>
            <option value="yes">Emergency-enabled</option>
            <option value="no">Private</option>
          </select>
        </EditorField>
        <EditorField label="Financial value" dark>
          <input className="editor-input-dark" value={draft.financial?.value ?? ""} onChange={(event) => setDraft({ ...draft, financial: { ...draft.financial, value: event.target.value } })} placeholder="Optional asset value" />
        </EditorField>
      </div>

      <EditorField label="Family notes" className="mt-4" dark>
        <textarea className="editor-input-dark min-h-32" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="What should your family know before acting?" />
      </EditorField>

      <div className="mt-6 rounded-[1.5rem] border border-white/[0.08] bg-black/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Attachments and extraction</p>
            <p className="mt-1 text-sm text-white/45">Upload PDF, image, screenshot, or document proof.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AttachmentUploader onFiles={uploadFiles} />
            <label className="cursor-pointer rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#111113] transition hover:scale-[1.02]">
              Extract screenshot
              <input className="hidden" type="file" accept="image/*" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) await extractFromScreenshot(file);
                event.target.value = "";
              }} />
            </label>
          </div>
        </div>
        <AttachmentGrid attachments={draft.attachments ?? []} onDelete={deleteDraftAttachment} onReplace={replaceDraftAttachment} tone="dark" />
      </div>

      {message && <div className={cx("mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold", messageTone === "red" ? "border-[#ff453a]/25 bg-[#ff453a]/10 text-[#ffb4ae]" : "border-[#34c759]/20 bg-[#34c759]/10 text-[#a8f0bd]")}>{message}</div>}

      <button onClick={handleSave} className="mt-6 w-full rounded-full bg-white px-5 py-4 text-sm font-semibold text-[#111113] transition hover:scale-[1.01]">Save dossier</button>
    </div>
  );
}

function EditorField({ label, children, className = "", dark = false }) {
  return (
    <label className={cx("block text-sm font-semibold", dark ? "text-white/72" : "text-[#424245]", className)}>
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function AttachmentUploader({ onFiles, dark = true }) {
  return (
    <label className={cx("cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition", dark ? "border border-white/10 bg-white/8 text-white hover:bg-white/12" : "border border-black/10 bg-white text-[#1d1d1f] hover:bg-[#fbfbfd]")}>
      Upload file
      <input className="hidden" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,application/pdf" onChange={(event) => {
        if (event.target.files?.length) onFiles(event.target.files);
        event.target.value = "";
      }} />
    </label>
  );
}

function AttachmentGrid({ attachments, onDelete, onReplace, onExtract, tone = "light" }) {
  const dark = tone === "dark";
  useEffect(() => {
    return () => revokeAttachmentPreviews(attachments);
  }, [attachments]);

  if (!attachments?.length) {
    return <div className={cx("mt-4 rounded-[1.25rem] border border-dashed p-5 text-sm", dark ? "border-white/[0.12] bg-black/15 text-white/42" : "border-black/10 bg-white/60 text-[#6e6e73]")}>No proof files attached yet.</div>;
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {attachments.map((attachment) => {
        const kind = attachmentKind(attachment);
        return (
          <div key={attachment.id} className={cx("overflow-hidden rounded-[1.25rem] border", dark ? "border-white/[0.08] bg-black/20" : "border-black/10 bg-white shadow-sm")}>
            {kind === "Image" ? (
              <img src={attachment.dataUrl} alt={attachment.name} className="h-32 w-full object-cover" />
            ) : kind === "PDF" ? (
              <iframe src={attachment.dataUrl} title={attachment.name} className={cx("h-32 w-full", dark ? "bg-white/8" : "bg-[#f5f5f7]")} />
            ) : (
              <div className={cx("grid h-32 place-items-center text-sm font-semibold", dark ? "bg-white/[0.055] text-white/45" : "bg-[#f5f5f7] text-[#86868b]")}>{attachmentIcon(kind)}</div>
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className={cx("block break-all text-sm", dark ? "text-white/86" : "text-[#1d1d1f]")}>{attachment.name}</strong>
                  <span className={cx("mt-1 block text-xs font-semibold", dark ? "text-white/38" : "text-[#86868b]")}>{kind} • {Math.max(1, Math.round((attachment.size ?? 0) / 1024))} KB</span>
                </div>
                <a href={attachment.dataUrl} download={attachment.name} className={cx("rounded-full border px-3 py-1 text-xs font-semibold", dark ? "border-white/[0.1] bg-white/[0.06] text-white" : "border-black/10 text-[#1d1d1f]")}>Open</a>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {kind === "Image" && onExtract && (
                  <button onClick={async () => {
                    const response = await fetch(attachment.dataUrl);
                    const blob = await response.blob();
                    const file = new File([blob], attachment.name, { type: attachment.type });
                    const { createWorker } = await import("tesseract.js");
                    const worker = await createWorker("eng");
                    const result = await worker.recognize(file);
                    await worker.terminate();
                    await onExtract(result.data.text || "");
                  }} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold", dark ? "border border-[#8fd5a6]/20 bg-[#8fd5a6]/12 text-[#b7f3c4]" : "bg-[#1d1d1f] text-white")}>Extract</button>
                )}
                {onReplace && (
                  <label className={cx("cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold", dark ? "border border-white/[0.1] bg-white/[0.06] text-white" : "border border-black/10 text-[#1d1d1f]")}>
                    Replace
                    <input className="hidden" type="file" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,application/pdf" onChange={async (event) => {
                      if (event.target.files?.length) await onReplace(attachment, event.target.files);
                      event.target.value = "";
                    }} />
                  </label>
                )}
                {onDelete && (
                  <button onClick={() => onDelete(attachment)} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold", dark ? "border border-[#ff453a]/20 bg-[#ff453a]/10 text-[#ffb4ae]" : "border border-[#ff3b30]/20 text-[#b42318]")}>Delete</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CaptureScreen({ vault, onSave, onNavigate }) {
  const [messyText, setMessyText] = useState("HDFC bank account ending 5678, IFSC HDFC0001234, balance Rs 845000, netbanking password Demo@2026, nominee Priya.");
  const [drafts, setDrafts] = useState([]);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [manual, setManual] = useState({ ...EMPTY_ITEM, title: "", type: "important_document" });
  const [attachments, setAttachments] = useState([]);
  const [message, setMessage] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const activeDraft = drafts[selectedDraftIndex] ?? manual;
  const hasStructuredDrafts = drafts.length > 0;

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    setMessage("");
    try {
      if (file.type.startsWith("image/")) {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng");
        const result = await worker.recognize(file);
        await worker.terminate();
        setMessyText(result.data.text || `${file.name} uploaded. OCR did not find readable text.`);
        setMessage("Screenshot read locally. Review the text before saving.");
      } else {
        const attachment = await readFileAsAttachment(file);
        setAttachments((current) => [attachment, ...current]);
        if (file.type.startsWith("text/") || file.name.match(/\.(txt|csv|md)$/i)) {
          setMessyText(await file.text());
        }
        setMessage("Proof file attached to the draft.");
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      event.target.value = "";
      setOcrBusy(false);
    }
  }

  function structure() {
    const nextDrafts = analyzeMessyInputRecords(messyText);
    setDrafts(nextDrafts);
    setSelectedDraftIndex(0);
    setManual((current) => ({ ...current, ...nextDrafts[0] }));
    setMessage(nextDrafts.length > 1 ? `${nextDrafts.length} possible records found. Review each before saving.` : "Structured draft ready. Nothing is saved until you confirm.");
  }

  async function saveRecord() {
    const title = activeDraft.title?.trim();
    if (!title) {
      setMessage("Add a clear title before saving.");
      return;
    }
    const now = new Date().toISOString();
    const nextItem = {
      ...EMPTY_ITEM,
      ...activeDraft,
      id: crypto.randomUUID(),
      title,
      attachments: [
        ...attachments,
        ...(hasStructuredDrafts ? [createDemoAttachment("capture-source.txt", messyText)] : [])
      ],
      createdAt: now,
      updatedAt: now
    };
    await onSave({
      ...vault,
      items: [nextItem, ...vault.items],
      audit: [{ id: crypto.randomUUID(), event: `Captured record: ${nextItem.title}`, at: now }, ...vault.audit]
    }, attachments.length || hasStructuredDrafts ? "attachment_change" : "record_change");
    const remainingDrafts = drafts.filter((_, index) => index !== selectedDraftIndex);
    setMessage(remainingDrafts.length ? "Saved. Continue reviewing the remaining extracted records." : "Saved as a protected record.");
    setDrafts(remainingDrafts);
    setSelectedDraftIndex(0);
    setAttachments([]);
    setManual({ ...EMPTY_ITEM, title: "", type: "important_document" });
    if (!remainingDrafts.length) onNavigate("life");
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[2.25rem] border border-black/10 bg-white p-7 shadow-[0_24px_90px_rgba(0,0,0,0.06)] lg:p-9">
        <p className="text-sm font-semibold uppercase text-[#0071e3]">Capture</p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.04] md:text-5xl">Drop in the mess. OS-One turns it into a dossier.</h1>
        <p className="mt-5 text-base leading-7 text-[#6e6e73]">Paste a note, upload a screenshot, or attach proof. OS-One proposes drafts; you decide what becomes recovery data.</p>
        <div className="mt-5">
          <TrustNote label="What capture does now">
            This prototype uses local OCR and heuristic extraction. It can organize obvious fields, but it does not truly understand documents yet.
          </TrustNote>
        </div>

        <label className="mt-8 block text-sm font-semibold text-[#424245]">
          Messy capture
          <textarea className="mt-3 min-h-44 w-full rounded-[1.5rem] border border-black/10 bg-[#f5f5f7] p-5 text-base leading-7 outline-none transition focus:border-[#0071e3] focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10" value={messyText} onChange={(event) => setMessyText(event.target.value)} />
        </label>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="rounded-[1.5rem] border border-dashed border-black/15 bg-[#fbfbfd] p-5 text-sm font-semibold text-[#424245] transition hover:border-[#0071e3]/40">
            Upload screenshot or proof
            <input className="hidden" type="file" accept="image/*,.txt,.csv,.md,application/pdf" onChange={handleUpload} />
            <span className="mt-2 block text-sm font-medium text-[#86868b]">{ocrBusy ? "Reading locally..." : "Images use local OCR. Files stay attached."}</span>
          </label>
          <button onClick={structure} disabled={ocrBusy || !messyText.trim()} className="rounded-full bg-[#1d1d1f] px-6 py-4 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50">Structure this</button>
        </div>

        <div className="mt-7 border-t border-black/10 pt-6">
          <p className="text-sm font-semibold text-[#6e6e73]">Prefer guided entry?</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input className="rounded-2xl border border-black/10 bg-[#f5f5f7] px-4 py-3 outline-none focus:border-[#0071e3] focus:bg-white" placeholder="Title" value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} />
            <select className="rounded-2xl border border-black/10 bg-[#f5f5f7] px-4 py-3 outline-none focus:border-[#0071e3] focus:bg-white" value={manual.type} onChange={(event) => setManual({ ...manual, type: event.target.value })}>
              {TYPE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <input className="rounded-2xl border border-black/10 bg-[#f5f5f7] px-4 py-3 outline-none focus:border-[#0071e3] focus:bg-white" placeholder="Login / account / policy" value={manual.username} onChange={(event) => setManual({ ...manual, username: event.target.value })} />
            <input className="rounded-2xl border border-black/10 bg-[#f5f5f7] px-4 py-3 outline-none focus:border-[#0071e3] focus:bg-white" placeholder="Secret / PIN / key detail" value={manual.secret} onChange={(event) => setManual({ ...manual, secret: event.target.value })} />
          </div>
        </div>

        {hasStructuredDrafts && (
          <div className="mt-6 rounded-[1.5rem] border border-black/10 bg-[#f5f5f7] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">Review queue</p>
            <div className="mt-3 grid gap-2">
              {drafts.map((item, index) => (
                <button key={item.candidateId} onClick={() => setSelectedDraftIndex(index)} className={cx("rounded-[1.1rem] border p-3 text-left transition", selectedDraftIndex === index ? "border-[#0071e3]/30 bg-white shadow-sm" : "border-black/10 bg-white/60 hover:bg-white")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="block text-sm">{item.title}</strong>
                      <span className="mt-1 block text-xs font-semibold text-[#6e6e73]">{typeLabel(item.type)} · {item.reviewState}</span>
                    </div>
                    <span className="rounded-full bg-[#1d1d1f]/6 px-2.5 py-1 text-xs font-semibold text-[#6e6e73]">{confidenceLabel(item.confidence)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {message && <div className="mt-5 rounded-2xl border border-[#34c759]/20 bg-[#34c759]/10 px-4 py-3 text-sm font-semibold text-[#0b6b3a]">{message}</div>}
      </div>

      <div className="rounded-[2.25rem] bg-[#111113] p-7 text-white shadow-[0_24px_90px_rgba(0,0,0,0.16)] lg:p-9">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold uppercase text-[#8fd5a6]">Structured draft</p>
            <h2 className="mt-3 text-4xl font-semibold">{activeDraft.title || "Waiting for signal"}</h2>
          </div>
          <div className="structure-orb grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/10 text-sm font-semibold">
            {hasStructuredDrafts ? confidenceLabel(activeDraft.confidence) : "AI"}
          </div>
        </div>

        <div className="relative mt-8 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/8 p-5">
          <div className={cx("scan-line absolute inset-y-0 w-20 bg-white/20", hasStructuredDrafts && "animate-scan")} />
          <p className="relative text-sm leading-6 text-white/54">{messyText.slice(0, 230) || "Paste something unstructured on the left."}</p>
        </div>

        <div className="mt-6 grid gap-3">
          <DraftRow label="Type" value={TYPE_OPTIONS.find(([id]) => id === activeDraft.type)?.[1] ?? "Not selected"} />
          <DraftRow label="Identifier" value={activeDraft.username || "Not detected"} />
          <DraftRow label="Sensitive key" value={activeDraft.secret || "Not detected"} />
          <DraftRow label="Emergency release" value={activeDraft.emergencyEligible ? "Eligible after confirmation" : "Owner only"} />
        </div>

        {hasStructuredDrafts && (
          <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-white/8 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Extraction status</p>
            <p className="mt-2 text-sm leading-6 text-white/68">This is a local heuristic draft. Confirm every field before treating it as recovery data.</p>
          </div>
        )}

        {activeDraft?.extractedFields?.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {activeDraft.extractedFields.slice(0, 8).map((field) => (
              <div key={`${field.label}-${field.value}`} className="rounded-2xl border border-white/10 bg-white/8 p-4">
                <span className="block text-xs font-semibold uppercase text-white/38">{field.label}</span>
                <strong className="mt-2 block break-words text-sm font-semibold text-white/86">{field.value}</strong>
                <span className="mt-2 block text-[11px] font-semibold text-white/34">{field.confidence} · {field.source}</span>
              </div>
            ))}
          </div>
        )}

        {activeDraft?.warnings?.length > 0 && (
          <div className="mt-6 rounded-[1.5rem] border border-[#ffd166]/20 bg-[#ffd166]/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#ffe0a3]">Review before saving</p>
            <div className="mt-3 grid gap-2">
              {activeDraft.warnings.map((warning) => (
                <p key={warning} className="text-sm leading-6 text-white/72">{warning}</p>
              ))}
            </div>
          </div>
        )}

        <button onClick={saveRecord} className="mt-8 w-full rounded-full bg-white px-5 py-4 text-sm font-semibold text-[#111113] transition hover:scale-[1.01]">Save as protected record</button>
        <p className="mt-4 text-center text-xs font-medium text-white/38">OS-One never saves AI output without confirmation.</p>
      </div>
    </section>
  );
}

function ReleaseScreen({ vault, onSave }) {
  const [settings, setSettings] = useState(vault.releaseSettings);
  const [activeKeys, setActiveKeys] = useState(() => settings.keyHolders.map((holder, index) => holder.trim() ? index : null).filter((index) => index !== null).slice(0, RELEASE_POLICY.requiredKeys));
  const [releaseStep, setReleaseStep] = useState(1);
  const [message, setMessage] = useState("");
  const filledKeys = settings.keyHolders.filter((holder) => holder.trim()).length;
  const normalizedHolders = settings.keyHolders.map((holder) => holder.trim().toLowerCase());
  const duplicateIndexes = normalizedHolders
    .map((holder, index) => holder && normalizedHolders.indexOf(holder) !== index ? index : null)
    .filter((index) => index !== null);
  const hasDuplicates = duplicateIndexes.length > 0;
  const nomineeReady = Boolean(settings.mainNominee.trim());
  const confirmed = nomineeReady && !hasDuplicates && activeKeys.length >= RELEASE_POLICY.requiredKeys;
  const remainingKeys = Math.max(0, RELEASE_POLICY.requiredKeys - activeKeys.length);
  const releaseStatus = !nomineeReady
    ? "Add a Main Nominee before any recovery request can begin."
    : hasDuplicates
      ? "Each trusted key must be a different person."
    : filledKeys < RELEASE_POLICY.requiredKeys
      ? `Add ${RELEASE_POLICY.requiredKeys - filledKeys} more trusted key holder${RELEASE_POLICY.requiredKeys - filledKeys === 1 ? "" : "s"}.`
      : confirmed
        ? "Vault does not open yet. The 14-day owner-protection hold begins."
        : `Select ${remainingKeys} more trusted key${remainingKeys === 1 ? "" : "s"} to simulate the threshold.`;

  useEffect(() => {
    setActiveKeys((current) => current.filter((index) => settings.keyHolders[index]?.trim()));
  }, [settings.keyHolders]);

  async function saveSettings() {
    if (hasDuplicates) {
      setMessage("Duplicate key holders are not allowed. Recovery depends on independent people.");
      return;
    }
    const now = new Date().toISOString();
    await onSave({
      ...vault,
      releaseSettings: settings,
      audit: [{ id: crypto.randomUUID(), event: "Release circle updated", at: now }, ...vault.audit]
    }, null);
    setMessage(confirmed ? "Release circle saved. Emergency access still requires the 14-day owner alert hold." : "Release circle saved as a draft. It is not recovery-ready yet.");
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1.06fr_0.94fr]">
      <div className="rounded-[2.25rem] bg-[#111113] p-7 text-white shadow-[0_24px_90px_rgba(0,0,0,0.16)] lg:p-10">
        <p className="text-sm font-semibold uppercase text-[#8fd5a6]">Emergency Release</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.03] md:text-6xl">No one person can open your life.</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-white/58">
          Configure the rules your real release service must enforce: nominee request, three trusted keys, 14-day hold, and owner alerts.
        </p>
        <div className="mt-6">
          <TrustNote label="Prototype boundary" dark>
            This screen stores release rules locally and simulates readiness. It does not yet send emails, verify nominees, run a 14-day timer, or open records for another person.
          </TrustNote>
        </div>

        <div className={cx("mt-7 rounded-[1.75rem] border p-5 transition", confirmed ? "border-[#34c759]/25 bg-[#34c759]/12" : hasDuplicates ? "border-[#ff453a]/25 bg-[#ff453a]/10" : "border-white/10 bg-white/8")}>
          <p className="text-sm font-semibold text-white/54">{confirmed ? "Circle threshold reached" : `${activeKeys.length}/${RELEASE_POLICY.requiredKeys} trusted keys selected`}</p>
          <h2 className="mt-2 text-2xl font-semibold">{releaseStatus}</h2>
          <p className="mt-3 text-sm leading-6 text-white/45">Real release still requires backend identity checks, key-holder participation, alert delivery, and server-enforced waiting periods.</p>
        </div>

        <ReleaseCircle settings={settings} activeKeys={activeKeys} onToggleKey={(index) => {
          if (!settings.keyHolders[index]?.trim()) return;
          setActiveKeys((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index].slice(-5));
        }} />
      </div>

      <div className="rounded-[2.25rem] border border-black/10 bg-white p-7 shadow-[0_24px_90px_rgba(0,0,0,0.06)] lg:p-9">
        <p className="text-sm font-semibold uppercase text-[#0071e3]">Release circle</p>
        <h2 className="mt-3 text-4xl font-semibold">Choose the humans who make recovery safe.</h2>

        <ReleaseStepNav step={releaseStep} onStep={setReleaseStep} />

        <div className={cx("mt-6 rounded-[1.5rem] border p-4", confirmed ? "border-[#34c759]/25 bg-[#34c759]/10" : hasDuplicates ? "border-[#ff453a]/25 bg-[#ff453a]/10" : "border-black/10 bg-[#f5f5f7]")}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">Readiness</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <strong className="block text-xl">{nomineeReady ? "Yes" : "No"}</strong>
              <span className="text-xs font-semibold text-[#6e6e73]">Nominee</span>
            </div>
            <div>
              <strong className="block text-xl">{filledKeys}/5</strong>
              <span className="text-xs font-semibold text-[#6e6e73]">People</span>
            </div>
            <div>
              <strong className="block text-xl">{activeKeys.length}/3</strong>
              <span className="text-xs font-semibold text-[#6e6e73]">Keys</span>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#6e6e73]">{releaseStatus}</p>
        </div>

        {releaseStep === 1 && (
          <ReleasePanel title="Step 1" subtitle="Choose the Main Nominee" body="This is the person who starts a recovery request. They still cannot open the vault alone.">
            <label className="block text-sm font-semibold text-[#424245]">
              Main Nominee
              <input className="mt-2 w-full rounded-2xl border border-black/10 bg-[#f5f5f7] px-4 py-3 outline-none focus:border-[#0071e3] focus:bg-white" value={settings.mainNominee} onChange={(event) => {
                setMessage("");
                setSettings({ ...settings, mainNominee: event.target.value });
              }} placeholder="Name or email" />
            </label>
          </ReleasePanel>
        )}

        {releaseStep === 2 && (
          <ReleasePanel title="Step 2" subtitle="Add five independent key holders" body="Key holders should not all be from the same household. Recovery depends on independent humans.">
            <div className="grid gap-3">
              {settings.keyHolders.map((holder, index) => (
                <label key={index} className="block text-sm font-semibold text-[#424245]">
                  Trusted key {index + 1}
                  <input className={cx("mt-2 w-full rounded-2xl border bg-[#f5f5f7] px-4 py-3 outline-none focus:bg-white", duplicateIndexes.includes(index) ? "border-[#ff453a]/45 focus:border-[#ff453a]" : "border-black/10 focus:border-[#0071e3]")} value={holder} onChange={(event) => {
                    setMessage("");
                    const keyHolders = [...settings.keyHolders];
                    keyHolders[index] = event.target.value;
                    setSettings({ ...settings, keyHolders });
                    if (!event.target.value.trim()) setActiveKeys((current) => current.filter((item) => item !== index));
                  }} placeholder="Name or email" />
                </label>
              ))}
            </div>
          </ReleasePanel>
        )}

        {releaseStep === 3 && (
          <ReleasePanel title="Step 3" subtitle="Owner alert and threshold rules" body="These rules are shown as product logic in this frontend. A production release requires a backend alert service.">
            <div className="grid gap-3 sm:grid-cols-3">
              <RuleTile label="Threshold" value="3 of 5 keys" />
              <RuleTile label="Owner hold" value="14 days" />
              <RuleTile label="Alerts" value="2 per day" />
            </div>
          </ReleasePanel>
        )}

        {releaseStep === 4 && (
          <ReleasePanel title="Step 4" subtitle="Preview emergency access" body="This is the exact sequence a nominee should expect. It is a simulation in this prototype, not a live release service.">
            <div className="rounded-[1.5rem] border border-black/10 bg-[#f5f5f7] p-5">
              {["Main Nominee signs in", "3 of 5 trusted keys join", "14-day owner alert hold", "Emergency-enabled records open"].map((step, index) => (
                <div key={step} className="flex items-center gap-4 border-b border-black/10 py-4 last:border-0">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-sm font-semibold shadow-sm">{index + 1}</span>
                  <strong className="text-sm">{step}</strong>
                </div>
              ))}
            </div>
          </ReleasePanel>
        )}

        {releaseStep === 5 && (
          <ReleasePanel title="Step 5" subtitle="Readiness state" body={confirmed ? "This release circle is coherent for demo. Production still needs identity, alert delivery, and server-side enforcement." : "This release circle is not ready. Fix the readiness gaps before relying on it."}>
            <div className="grid gap-3 sm:grid-cols-3">
              <RuleTile label="Nominee" value={nomineeReady ? "Ready" : "Missing"} />
              <RuleTile label="Key holders" value={`${filledKeys}/5 added`} />
              <RuleTile label="Threshold" value={`${activeKeys.length}/3 selected`} />
            </div>
          </ReleasePanel>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => setReleaseStep(Math.max(1, releaseStep - 1))} className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={releaseStep === 1}>Back</button>
          <button onClick={() => setReleaseStep(Math.min(5, releaseStep + 1))} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={releaseStep === 5}>Next step</button>
        </div>

        {message && <div className={cx("mt-5 rounded-2xl border px-4 py-3 text-sm font-semibold", message.includes("Duplicate") ? "border-[#ff453a]/25 bg-[#ff453a]/10 text-[#b42318]" : "border-[#34c759]/20 bg-[#34c759]/10 text-[#0b6b3a]")}>{message}</div>}
        <button onClick={saveSettings} className="mt-6 w-full rounded-full bg-[#1d1d1f] px-5 py-4 text-sm font-semibold text-white transition hover:scale-[1.01]">Save release circle</button>
      </div>
    </section>
  );
}

function ReleaseStepNav({ step, onStep }) {
  const steps = ["Nominee", "Keys", "Rules", "Preview", "Ready"];
  return (
    <div className="mt-6 grid grid-cols-5 gap-1 rounded-full bg-[#f5f5f7] p-1">
      {steps.map((label, index) => {
        const id = index + 1;
        return (
          <button key={label} onClick={() => onStep(id)} className={cx("rounded-full px-2 py-2 text-xs font-semibold transition", step === id ? "bg-[#1d1d1f] text-white shadow-sm" : "text-[#6e6e73] hover:bg-white")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ReleasePanel({ title, subtitle, body, children }) {
  return (
    <section className="mt-6 rounded-[1.75rem] border border-black/10 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0071e3]">{title}</p>
      <h3 className="mt-2 text-2xl font-semibold">{subtitle}</h3>
      <p className="mt-2 text-sm leading-6 text-[#6e6e73]">{body}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function RuleTile({ label, value }) {
  return (
    <div className="rounded-[1.25rem] border border-black/10 bg-[#f5f5f7] p-4">
      <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#86868b]">{label}</span>
      <strong className="mt-2 block text-lg">{value}</strong>
    </div>
  );
}

function keyHolderLabel(holder, index) {
  const name = holder.split("-")[0].trim();
  if (!name) return `K${index + 1}`;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || `K${index + 1}`;
}

function ReleaseCircle({ settings, activeKeys, onToggleKey }) {
  const holders = settings.keyHolders;
  return (
    <div className="relative mx-auto mt-8 h-[360px] max-w-[520px]">
      <div className="release-ring absolute left-1/2 top-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/8" />
      <div className="absolute left-1/2 top-1/2 grid h-44 w-44 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#8fd5a6]/30 bg-[#8fd5a6]/10 text-center">
        <div>
          <span className="text-xs font-semibold text-white/45">Main Nominee</span>
          <strong className="mt-2 block text-xl font-semibold">{settings.mainNominee ? "Ready" : "Missing"}</strong>
        </div>
      </div>
      {holders.map((holder, index) => {
        const angle = (Math.PI * 2 * index) / holders.length - Math.PI / 2;
        const x = 210 + Math.cos(angle) * 160;
        const y = 180 + Math.sin(angle) * 150;
        const configured = Boolean(holder.trim());
        const active = activeKeys.includes(index);
        return (
          <button key={index} onClick={() => onToggleKey(index)} disabled={!configured} title={configured ? holder : "Add this key holder before it can participate"} style={{ left: x, top: y }} className={cx("absolute grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-sm font-semibold transition", configured && "hover:scale-105", active ? "border-[#34c759]/50 bg-[#34c759] text-[#111113] shadow-[0_0_45px_rgba(52,199,89,0.28)]" : configured ? "border-white/14 bg-white/10 text-white/68" : "border-white/[0.06] bg-white/[0.035] text-white/24")}>
            {keyHolderLabel(holder, index)}
          </button>
        );
      })}
    </div>
  );
}

function DraftRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/10 py-4 last:border-0">
      <span className="text-sm font-medium text-white/45">{label}</span>
      <strong className="max-w-[65%] break-words text-right text-sm font-semibold text-white/90">{value}</strong>
    </div>
  );
}

function Signal({ label, value, tone }) {
  const colors = {
    green: "bg-[#34c759]",
    amber: "bg-[#c88719]",
    red: "bg-[#d70015]"
  };
  return (
    <div className="rounded-[1.5rem] border border-black/10 bg-[#f5f5f7] p-5">
      <span className={cx("mb-5 block h-2 w-10 rounded-full", colors[tone])} />
      <strong className="block text-4xl font-semibold">{value}</strong>
      <p className="mt-2 text-sm font-semibold text-[#6e6e73]">{label}</p>
    </div>
  );
}

function SecurityPanel({ autoLockMs, onAutoLockChange, onReplaceRecoveryKey }) {
  return (
    <section className="mt-6 rounded-[1.75rem] border border-black/10 bg-[#fbfbfd] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase text-[#0071e3]">Session security</p>
          <h3 className="mt-2 text-2xl font-semibold">Relock policy</h3>
          <p className="mt-2 text-sm leading-6 text-[#6e6e73]">
            Decrypted records stay only in this open session. OS-One relocks after {getAutoLockLabel(autoLockMs)} of inactivity, when you seal manually, or when the app moves to the background.
          </p>
        </div>
        <select
          className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[#1d1d1f] shadow-sm outline-none"
          value={autoLockMs}
          onChange={(event) => onAutoLockChange(Number(event.target.value))}
          aria-label="Auto-lock timeout"
        >
          {LOCK_TIMEOUT_OPTIONS.map((option) => (
            <option key={option.ms} value={option.ms}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <RuleTile label="Manual" value="Seal now" />
        <RuleTile label="Inactivity" value={getAutoLockLabel(autoLockMs)} />
        <RuleTile label="Background" value="Lock immediately" />
      </div>
      <RecoveryKeyStatusPanel onReplaceRecoveryKey={onReplaceRecoveryKey} />
    </section>
  );
}

function RecoveryKeyStatusPanel({ onReplaceRecoveryKey }) {
  const [replacement, setReplacement] = useState(cancelRecoveryKeyReplacement());
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const metadata = createRecoveryKeyMetadata();
  const active = replacement.state === "replacement_confirmation_required";

  function beginReplacement() {
    const started = startRecoveryKeyReplacement({ vaultKey: onReplaceRecoveryKey ? {} : null });
    setMessage(started.ok ? "" : started.reason);
    if (started.ok) {
      setReplacement(started);
      setConfirmation("");
    }
  }

  async function confirmReplacement() {
    const result = await onReplaceRecoveryKey?.({
      newRecoveryKey: replacement.generatedRecoveryKey,
      confirmation
    });
    if (!result?.ok) {
      setMessage(result?.reason ?? "Recovery key was not replaced.");
      return;
    }
    setReplacement(cancelRecoveryKeyReplacement({ reason: "confirmed" }));
    setConfirmation("");
    setMessage("Recovery key replaced. Export and verify a fresh backup before relying on recovery.");
  }

  function cancelReplacement() {
    setReplacement(cancelRecoveryKeyReplacement());
    setConfirmation("");
    setMessage("Replacement cancelled. The existing recovery key remains active.");
  }

  return (
    <div className="mt-4 rounded-[1.25rem] border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#86868b]">Recovery key</p>
          <h4 className="mt-2 text-lg font-semibold text-[#1d1d1f]">Configured, not viewable</h4>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#6e6e73]">
            OS-One cannot show your existing recovery key again. You can replace it while this vault is unlocked. Replacement does not rescue a vault if both the phrase and recovery key are already lost.
          </p>
        </div>
        <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-semibold text-[#6e6e73]">{metadata.canViewExistingKey ? "Viewable" : "Cannot view existing key"}</span>
      </div>

      {!active && (
        <button type="button" onClick={beginReplacement} className="mt-4 rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white">
          Replace recovery key
        </button>
      )}

      {active && (
        <div className="mt-4 rounded-2xl border border-[#ff9500]/20 bg-[#ff9500]/8 p-4">
          <p className="text-sm font-semibold text-[#7a4a00]">New recovery key</p>
          <p className="mt-1 text-xs leading-5 text-[#7a4a00]/80">Save this key before confirming. After confirmation, the old recovery key stops working.</p>
          <div className="mt-3 select-all break-words rounded-2xl bg-white p-4 font-mono text-sm font-semibold tracking-[0.04em] text-[#1d1d1f]">{replacement.generatedRecoveryKey}</div>
          <label className="mt-3 block text-xs font-semibold text-[#7a4a00]">
            Type the new recovery key to confirm
            <input className="mt-2 w-full rounded-2xl border border-[#ff9500]/20 bg-white px-4 py-3 text-sm text-[#1d1d1f] outline-none" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="OS1A-..." />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={confirmReplacement} className="rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white">Confirm replacement</button>
            <button type="button" onClick={cancelReplacement} className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#1d1d1f]">Cancel</button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-xs font-semibold text-[#6e6e73]">{message}</p>}
    </div>
  );
}

function AuditTrail({ vault }) {
  const groups = getAuditGroups(vault, 18);
  return (
    <section className="mt-6 rounded-[1.75rem] border border-black/10 bg-[#fbfbfd] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase text-[#0071e3]">Local audit</p>
          <h3 className="mt-2 text-2xl font-semibold">Recent sealed activity</h3>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#6e6e73] shadow-sm">Encrypted</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#6e6e73]">This history is stored inside the encrypted local vault. It records actor, action, time, and reason without storing secret values.</p>
      <div className="mt-4 grid gap-4">
        {groups.length ? groups.map((group) => (
          <div key={group.label} className="rounded-[1.25rem] border border-black/8 bg-white p-3">
            <p className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#86868b]">{group.label}</p>
            <div className="mt-2 grid gap-2">
              {group.events.map((event) => (
                <div key={event.id} className="rounded-2xl bg-[#f5f5f7] px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <strong className="text-sm font-semibold text-[#1d1d1f]">{event.action}</strong>
                    <span className="shrink-0 text-xs font-semibold text-[#86868b]">{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#6e6e73]">{event.actor} · {event.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-4 text-sm text-[#6e6e73]">No local audit events yet.</div>
        )}
      </div>
    </section>
  );
}

function TrustPoint({ title, body }) {
  return (
    <div className="rounded-3xl border border-black/10 bg-[#f5f5f7] p-4">
      <strong className="block text-[#1d1d1f]">{title}</strong>
      <span className="mt-1 block">{body}</span>
    </div>
  );
}

function BrandBar() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1d1d1f] text-lg font-semibold text-white">O</div>
      <div>
        <div className="text-lg font-semibold">OS-One Vault</div>
        <div className="text-sm font-medium text-[#86868b]">Private life infrastructure</div>
      </div>
    </div>
  );
}

function BrandMini() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#1d1d1f] text-sm font-semibold text-white">O</div>
      <div className="hidden sm:block">
        <div className="text-sm font-semibold">OS-One Vault</div>
        <div className="text-xs font-medium text-[#86868b]">Sealed locally</div>
      </div>
    </div>
  );
}

function ImportBackup({ currentRecord, onImported, onRestoreConfirmed }) {
  const [error, setError] = useState("");
  const [backupText, setBackupText] = useState("");
  const [backupName, setBackupName] = useState("");
  const [secret, setSecret] = useState("");
  const [mode, setMode] = useState("passphrase");
  const [preview, setPreview] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setPreview(null);
    try {
      const text = await file.text();
      setBackupText(text);
      setBackupName(file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      event.target.value = "";
    }
  }

  async function decryptPreview() {
    setError("");
    setBusy(true);
    try {
      const result = await createRestoreDryRun({ backupText, secret, mode, currentRecord });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      createPendingAuditEvent(localStorage, "Restore preview created");
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!preview?.ok) return;
    if (!canConfirmDestructiveRestore(confirmText)) return;
    const auditedVault = appendAuditEvent(appendAuditEvents(preview.vault, drainPendingAuditEvents(localStorage)), "Restore confirmed");
    const nextRecord = await updateEncryptedVault(preview.record, preview.vaultKey, auditedVault);
    saveStage1Record(localStorage, nextRecord);
    onImported(nextRecord);
    onRestoreConfirmed?.(nextRecord, preview.vaultKey, auditedVault);
    setBackupText("");
    setBackupName("");
    setSecret("");
    setConfirmText("");
    setPreview(null);
  }

  function refusePreview() {
    createPendingAuditEvent(localStorage, "Restore preview refused");
    setBackupText("");
    setBackupName("");
    setSecret("");
    setConfirmText("");
    setPreview(null);
    setError("");
  }

  return (
    <div>
      <label className="cursor-pointer rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[#1d1d1f] shadow-sm transition hover:bg-[#fbfbfd]">
        Practice restore preview
        <input className="hidden" type="file" accept="application/json,.json" onChange={importBackup} />
      </label>
      <p className="mt-2 max-w-xs text-xs leading-5 text-[#86868b]">Preview decrypts a backup in memory so you can inspect its impact. Nothing is replaced until you complete the destructive confirmation.</p>
      {backupText && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-black/10 bg-[#f5f5f7] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">Practice preview only</p>
          <p className="mt-2 text-sm font-semibold text-[#1d1d1f]">{backupName}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-full bg-white p-1">
            {[
              ["passphrase", "Phrase"],
              ["recovery", "Recovery"]
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold transition", mode === id ? "bg-[#1d1d1f] text-white" : "text-[#6e6e73]")}>{label}</button>
            ))}
          </div>
          <input className="mt-3 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#0071e3]" type={mode === "passphrase" ? "password" : "text"} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={mode === "passphrase" ? "Vault phrase for this backup" : "Recovery key for this backup"} />
          <button type="button" onClick={decryptPreview} disabled={busy || !secret.trim()} className="mt-3 w-full rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking..." : "Run practice preview"}</button>
        </div>
      )}
      {preview?.ok && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[#0071e3]/20 bg-[#0071e3]/8 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0f4c81]">{preview.impactCopy.eyebrow}</p>
          <p className="mt-2 text-sm font-semibold text-[#0f4c81]">{preview.impactCopy.summary}</p>
          <p className="mt-2 text-xs leading-5 text-[#0f4c81]/80">{preview.impactCopy.unchanged}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <RestoreMetric label="Format" value={`v${preview.metadata.formatVersion}`} />
            <RestoreMetric label="Records" value={preview.metadata.recordCount} />
            <RestoreMetric label="Attachments" value={preview.metadata.attachmentCount} />
            <RestoreMetric label="Audit events" value={preview.metadata.auditEventCount} />
          </div>
          <div className="mt-3 rounded-2xl bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">Restore impact</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#6e6e73]">
              <span>Current records: {preview.impact.current?.recordCount ?? "locked"}</span>
              <span>Incoming records: {preview.impact.incoming.recordCount}</span>
              <span>Current attachments: {preview.impact.current?.attachmentCount ?? "locked"}</span>
              <span>Incoming attachments: {preview.impact.incoming.attachmentCount}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#6e6e73]">{preview.impactCopy.destructiveWarning}</p>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#0f4c81]">Created {preview.metadata.createdAt ? new Date(preview.metadata.createdAt).toLocaleString() : "unknown"}. Updated {preview.metadata.updatedAt ? new Date(preview.metadata.updatedAt).toLocaleString() : "unknown"}.</p>
          <div className="mt-3 rounded-2xl border border-[#ff3b30]/20 bg-[#ff3b30]/8 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a12b2b]">Destructive replace</p>
            <p className="mt-2 text-xs leading-5 text-[#a12b2b]">This is the only path that changes local vault data. Type the exact phrase below to continue.</p>
          </div>
          <label className="mt-3 block text-xs font-semibold text-[#a12b2b]">
            Type {DESTRUCTIVE_RESTORE_CONFIRMATION} to confirm
            <input className="mt-2 w-full rounded-2xl border border-[#34c759]/20 bg-white px-4 py-3 text-sm text-[#1d1d1f] outline-none" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={refusePreview} className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#1d1d1f]">Close preview without replacing</button>
            <button type="button" onClick={confirmRestore} disabled={!canConfirmDestructiveRestore(confirmText)} className="rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">Replace local vault</button>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-xs font-semibold text-[#b42318]">{error}</div>}
    </div>
  );
}

function BackupVerificationPanel({ currentRecord, backupHealth, onBackupHealthChange }) {
  const [backupText, setBackupText] = useState("");
  const [backupName, setBackupName] = useState("");
  const [mode, setMode] = useState("passphrase");
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const healthCopy = getBackupHealthCopy(backupHealth);

  async function selectBackup(event) {
    const file = event.target.files?.[0];
    setResult(null);
    setSecret("");
    if (!file) return;

    try {
      setBackupText(await file.text());
      setBackupName(file.name);
    } catch {
      setBackupText("");
      setBackupName("");
      setResult({ ok: false, code: "invalid_shape", reason: "OS-One could not read this backup file." });
    } finally {
      event.target.value = "";
    }
  }

  async function runVerification() {
    if (!backupText || !secret.trim()) return;
    setBusy(true);
    const verification = await verifyBackup({ backupText, secret, mode });
    setResult(verification);
    createPendingAuditEvent(localStorage, verification.ok ? "Backup verification succeeded" : "Backup verification failed");
    onBackupHealthChange?.(verification.ok
      ? markBackupVerified({
        health: backupHealth,
        verificationResult: verification,
        currentVault: { updatedAt: currentRecord?.updatedAt }
      })
      : markBackupVerificationFailed({
        health: backupHealth,
        reason: verification.code
      }));
    setBusy(false);
  }

  return (
    <div className="max-w-sm">
      <BackupHealthPanel copy={healthCopy} health={backupHealth} />
      <label className="cursor-pointer rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[#1d1d1f] shadow-sm transition hover:bg-[#fbfbfd]">
        Verify backup
        <input className="hidden" type="file" accept="application/json,.json" onChange={selectBackup} />
      </label>
      <p className="mt-2 max-w-xs text-xs leading-5 text-[#86868b]">Verification decrypts a backup in memory to confirm it can open. It does not replace your local vault or prove the backup is current.</p>
      {backupText && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-black/10 bg-[#f5f5f7] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">Verification only</p>
          <p className="mt-2 text-sm font-semibold text-[#1d1d1f]">{backupName}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-full bg-white p-1">
            {[
              ["passphrase", "Phrase"],
              ["recovery", "Recovery"]
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold transition", mode === id ? "bg-[#1d1d1f] text-white" : "text-[#6e6e73]")}>{label}</button>
            ))}
          </div>
          <input className="mt-3 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#0071e3]" type={mode === "passphrase" ? "password" : "text"} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={mode === "passphrase" ? "Vault phrase for this backup" : "Recovery key for this backup"} />
          <button type="button" onClick={runVerification} disabled={busy || !secret.trim()} className="mt-3 w-full rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Verifying..." : "Verify without restoring"}</button>
        </div>
      )}
      {result?.ok && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[#34c759]/20 bg-[#34c759]/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0b6b3a]">Backup opens</p>
          <p className="mt-2 text-sm font-semibold text-[#0b6b3a]">This file decrypted successfully. It has not replaced your local vault.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <RestoreMetric label="Format" value={result.formatLabel.replace(" encrypted backup manifest", "")} />
            <RestoreMetric label="Records" value={result.metadata.recordCount} />
            <RestoreMetric label="Attachments" value={result.metadata.attachmentCount} />
            <RestoreMetric label="Audit events" value={result.metadata.auditEventCount} />
          </div>
          <p className="mt-3 text-xs leading-5 text-[#0b6b3a]">Verification does not mean this backup is the newest copy. Backup health comes in the next stage.</p>
        </div>
      )}
      {result && !result.ok && (
        <div className="mt-3 max-w-sm rounded-[1.25rem] border border-[#ff3b30]/20 bg-[#ff3b30]/8 p-4 text-sm font-semibold text-[#a12b2b]">
          {verificationErrorCopy(result)}
        </div>
      )}
    </div>
  );
}

function BackupHealthPanel({ copy, health }) {
  const status = health?.status;
  const reminder = getBackupReminderCopy(health);
  const tone = status === "verified_current"
    ? "border-[#34c759]/20 bg-[#34c759]/10 text-[#0b6b3a]"
    : status === "verified_stale" || status === "verification_failed"
      ? "border-[#ff9500]/25 bg-[#ff9500]/10 text-[#7a4a00]"
      : "border-black/10 bg-white text-[#1d1d1f]";

  return (
    <div className={cx("mb-3 rounded-[1.25rem] border p-4", tone)}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">{copy.eyebrow}</p>
      <h3 className="mt-2 text-base font-semibold">{copy.title}</h3>
      <p className="mt-2 text-xs leading-5 opacity-75">{copy.body}</p>
      {reminder.level === "stale" && (
        <div className="mt-3 rounded-2xl bg-white/70 p-3">
          <p className="text-xs font-semibold">{reminder.title}</p>
          <p className="mt-1 text-xs leading-5 opacity-75">{reminder.body}</p>
        </div>
      )}
      <p className="mt-3 text-xs font-semibold">Next: {copy.primaryAction}</p>
    </div>
  );
}

function verificationErrorCopy(result) {
  if (result.code === "wrong_secret") return "This backup did not open with that phrase or recovery key. No local vault data was changed.";
  if (result.code === "corrupted_payload") return "This backup appears damaged or unreadable. OS-One did not change your local vault.";
  if (result.code === "unsupported_version") return "This backup format is not supported by this beta. No local vault data was changed.";
  return "This does not look like a valid OS-One encrypted backup. No local vault data was changed.";
}

function restoreEraCopy(era) {
  if (era === "newer") return "This backup appears newer than the current local vault.";
  if (era === "older") return "This backup appears older than the current local vault.";
  if (era === "same-era") return "This backup appears from the same time window as the current local vault.";
  return "OS-One can verify this backup, but cannot compare its age to the current local vault.";
}

function RestoreMetric({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/70 p-3">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">{label}</span>
      <strong className="mt-1 block text-lg text-[#1d1d1f]">{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

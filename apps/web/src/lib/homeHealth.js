const HOME_AREAS = [
  { id: "identity", label: "Identity", types: ["identity_document"] },
  { id: "money", label: "Money", types: ["bank_account", "card"] },
  { id: "access", label: "Access", types: ["password", "pin", "email_account"] },
  { id: "insurance", label: "Insurance", types: ["insurance_policy"] },
  { id: "property", label: "Documents", types: ["important_document"] },
  { id: "instructions", label: "Emergency", types: ["emergency_instruction"] }
];

const DAY = 86_400_000;

function areaState(area, items, now = Date.now()) {
  const records = items.filter((item) => area.types.includes(item.type));
  if (records.length === 0) return "exposed";
  const stale = records.some((item) => {
    if (!item.updatedAt) return true;
    return (now - new Date(item.updatedAt).getTime()) / DAY > 90;
  });
  if (stale || records.some((item) => !item.emergencyEligible)) return "review";
  return "protected";
}

function hasNomineeEmail(settings = {}) {
  const email = String(settings.nomineeEmail || "").trim();
  if (email) return true;
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(settings.mainNominee || ""));
}

export function deriveHomeHealth(vault = {}) {
  const items = Array.isArray(vault.items) ? vault.items : [];
  const settings = vault.releaseSettings || {};
  const areas = HOME_AREAS.map((area) => ({
    ...area,
    state: areaState(area, items),
    count: items.filter((item) => area.types.includes(item.type)).length
  }));
  const protectedCount = areas.filter((area) => area.state === "protected").length;
  const reviewCount = areas.filter((area) => area.state === "review").length;
  const exposedCount = areas.filter((area) => area.state === "exposed").length;
  const holderCount = Array.isArray(settings.keyHolders)
    ? settings.keyHolders.filter((holder) => String(holder).trim()).length
    : 0;
  const nomineeReady = hasNomineeEmail(settings);
  const releaseReady = nomineeReady && holderCount >= 5;
  const weighted = protectedCount + (reviewCount * 0.45) + (releaseReady ? 1 : 0);
  const completion = Math.round((weighted / (areas.length + 1)) * 100);

  return {
    areas,
    protectedCount,
    reviewCount,
    exposedCount,
    totalAreas: areas.length,
    holderCount,
    nomineeReady,
    releaseReady,
    completion,
    balance: vault.balanceSheet ?? null
  };
}

export function getPrimaryHomeAction(vault = {}, health = deriveHomeHealth(vault)) {
  const items = Array.isArray(vault.items) ? vault.items : [];
  if (items.length === 0) return { id: "capture", label: "Add your first record" };
  if (!health.nomineeReady) return { id: "nominee-email", label: "Add an email for your nominee" };
  if (health.holderCount < 5) return { id: "release", label: "Complete your trust circle" };
  const gap = health.areas.find((area) => area.state === "exposed") ?? health.areas.find((area) => area.state === "review");
  if (gap) return { id: "area", areaId: gap.id, label: `Review ${gap.label.toLowerCase()}` };
  return { id: "healthy", label: "Your vault is up to date" };
}

function hasReleasedShare(holder) {
  return holder?.share_released === true
    || holder?.shareReleased === true
    || Boolean(holder?.released_at || holder?.releasedAt)
    || ["released", "submitted"].includes(holder?.state);
}

export function summarizeReleaseKeys(holders = []) {
  const normalized = Array.from({ length: 5 }, (_, index) => {
    const holder = holders[index] || {};
    return {
      id: holder.id || `holder-${index + 1}`,
      label: holder.label || `Key holder ${index + 1}`,
      state: holder.state || holder.status || "waiting",
      released: hasReleasedShare(holder)
    };
  });
  const received = normalized.filter((holder) => holder.released).length;
  return { required: 3, received, ready: received >= 3, holders: normalized };
}


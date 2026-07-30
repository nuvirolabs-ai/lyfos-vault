export const RELEASE_KEY_STORAGE_PREFIX = "lyfos-release-process-key-";

export function extractClaimToken(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw, "https://app.lyfos.in");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "claim" && parts[1]) return cleanToken(parts[1]);
  } catch {}

  if (raw.startsWith("/claim/")) {
    return cleanToken(raw.slice("/claim/".length).split(/[/?#]/)[0]);
  }

  if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return raw;
  return "";
}

export function nomineeReleaseTimeline(request, sharesCount = 0, now = new Date()) {
  const state = request?.state || "";
  const reviewDone = ["approved", "awaiting_shares", "holding", "ready_to_release", "completed"].includes(state);
  const keysDone = ["holding", "ready_to_release", "completed"].includes(state) || sharesCount >= 3;
  const ready = ["ready_to_release", "completed"].includes(state);

  return [
    {
      id: "filed",
      title: "Claim filed",
      status: state ? "done" : "waiting",
      detail: "Your request is attached to this nominee account."
    },
    {
      id: "review",
      title: "Lyfos review",
      status: state === "pending_review" ? "active" : reviewDone ? "done" : "waiting",
      detail: state === "rejected"
        ? `Rejected: ${request?.rejection_reason ?? "no reason given"}`
        : "A founder reviews the proof before any keys are requested."
    },
    {
      id: "keys",
      title: "Three key holders",
      status: ["approved", "awaiting_shares"].includes(state) ? "active" : keysDone ? "done" : "waiting",
      detail: `${Math.min(sharesCount, 3)} of 3 keys received.`
    },
    {
      id: "hold",
      title: "14-day owner hold",
      status: state === "holding" ? "active" : ready ? "done" : "waiting",
      detail: state === "holding" ? holdDetail(request?.ready_at, now) : "The owner gets time to abort a false claim."
    },
    {
      id: "download",
      title: "Download vault",
      status: state === "ready_to_release" ? "active" : state === "completed" ? "done" : "waiting",
      detail: "Only emergency-marked records become available."
    }
  ];
}

export function stashReleaseProcessKey({ token, requestId, keypair, storage = defaultSessionStorage() }) {
  if (!storage || !keypair) return;
  const serialized = JSON.stringify(keypair);
  if (token) storage.setItem(RELEASE_KEY_STORAGE_PREFIX + token, serialized);
  if (requestId) storage.setItem(RELEASE_KEY_STORAGE_PREFIX + requestId, serialized);
}

export function retrieveReleaseProcessSecret({ requestId, token, storage = defaultSessionStorage() } = {}) {
  if (!storage) return null;
  const directKeys = [requestId, token].filter(Boolean).map((id) => RELEASE_KEY_STORAGE_PREFIX + id);
  for (const key of directKeys) {
    const secret = parseStoredSecret(storage.getItem(key));
    if (secret) return secret;
  }

  const candidates = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(RELEASE_KEY_STORAGE_PREFIX)) {
      const secret = parseStoredSecret(storage.getItem(key));
      if (secret) candidates.push(secret);
    }
  }
  return candidates[0] ?? null;
}

function holdDetail(readyAt, now) {
  if (!readyAt) return "The hold is active.";
  const ms = new Date(readyAt).getTime() - new Date(now).getTime();
  const days = Math.max(0, Math.ceil(ms / 86_400_000));
  if (days === 0) return "The hold can complete now.";
  return `${days} day${days === 1 ? "" : "s"} left in the owner-protection hold.`;
}

function parseStoredSecret(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.secretKey || null;
  } catch {
    return null;
  }
}

function cleanToken(token) {
  return String(token || "").trim().replace(/[^A-Za-z0-9_-].*$/, "");
}

function defaultSessionStorage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

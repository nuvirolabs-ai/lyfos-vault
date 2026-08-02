import React, { useEffect, useMemo, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange, signOut } from "./lib/auth.js";
import {
  fetchMyReleaseRequests,
  getReadyRecoveryMaterial,
  markRecipientRecoveryOpened,
  reportInvalidRecoverySupport
} from "./lib/releaseClaim.js";
import {
  deriveHolderKeypairFromPassphrase,
  openSealedShare,
  recoverRecipientGatedVaultKey,
  sha256HexBytes
} from "./lib/shareCrypto.js";
import { decryptVaultWithRawKey } from "./lib/stage1Crypto.js";
import {
  createRecoveredVaultViewModel,
  filterRecoveredItems,
  isSensitiveRecoveredField
} from "./lib/recoveryCeremony.js";

const FIELD_LABELS = [
  ["username", "Account / reference"],
  ["secret", "Secret / access detail"],
  ["bankDetails", "Bank details"],
  ["cardDetails", "Card details"],
  ["email", "Email / recovery"],
  ["notes", "Notes"]
];

export function NomineeDownloadScreen({ onReturnHome }) {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [opening, setOpening] = useState(false);
  const [recoveredVault, setRecoveredVault] = useState(null);
  const [ownerInstructions, setOwnerInstructions] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSession().then((next) => {
      if (!cancelled) { setSession(next); setSessionLoaded(true); }
    }).catch(() => { if (!cancelled) setSessionLoaded(true); });
    const unsubscribe = onAuthStateChange((next) => {
      if (!cancelled) { setSession(next); setSessionLoaded(true); }
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  async function refresh() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const all = await fetchMyReleaseRequests();
      const recipientRequests = all.filter((item) => item.nominee_user_id === session.user.id && item.recipient_holder_id);
      setRequest(recipientRequests.find((item) => ["ready_to_recover", "opened", "holding"].includes(item.state)) ?? recipientRequests[0] ?? null);
    } catch (err) {
      setError(err?.message || "Couldn't load your recovery request.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [session?.user?.id]);

  const readyNow = useMemo(() => Boolean(request) && (
    ["ready_to_recover", "opened"].includes(request.state)
    || (request.state === "holding" && request.ready_at && new Date(request.ready_at).getTime() <= Date.now())
  ), [request]);

  async function openVault() {
    if (!request || passphrase.length < 12) return;
    setOpening(true);
    setError("");
    let rawVaultKey = null;
    try {
      const recipientKeypair = await deriveHolderKeypairFromPassphrase(passphrase, session.user.id);
      const material = await getReadyRecoveryMaterial(request.id);
      const gateProbe = await openSealedShare(material.gate_envelope, recipientKeypair.secretKey);
      gateProbe.fill(0);
      for (const released of material.released_shares) {
        try {
          const shareProbe = await openSealedShare(released, recipientKeypair.secretKey);
          try {
            const shareText = new TextDecoder().decode(shareProbe);
            const commitment = await sha256HexBytes(shareProbe);
            if (!/^[0-9a-f]{99}$/i.test(shareText) || commitment !== released.commitment) {
              throw new Error("support commitment mismatch");
            }
          } finally {
            shareProbe.fill(0);
          }
        } catch {
          await reportInvalidRecoverySupport(request.id, released.keyHolderId);
          setRequest((current) => current ? { ...current, state: "collecting_support", ready_at: null } : current);
          throw new Error("One nominee's support key did not match. It was excluded safely; Lyfos is asking another nominee.");
        }
      }
      rawVaultKey = await recoverRecipientGatedVaultKey({
        gateEnvelope: material.gate_envelope,
        releasedShares: material.released_shares,
        recipientSecretKey: recipientKeypair.secretKey
      });
      const vault = await decryptVaultWithRawKey(material.encrypted_record, rawVaultKey);

      const instructionsEnvelope = {
        ciphertext: material.gate_envelope?.instructionsCiphertext,
        ephemeralPub: material.gate_envelope?.instructionsEphemeralPub
      };
      if (instructionsEnvelope.ciphertext && instructionsEnvelope.ephemeralPub) {
        const instructionBytes = await openSealedShare(instructionsEnvelope, recipientKeypair.secretKey);
        try {
          setOwnerInstructions(new TextDecoder().decode(instructionBytes));
        } finally {
          instructionBytes.fill(0);
        }
      }

      setRecoveredVault(createRecoveredVaultViewModel(vault));
      setPassphrase("");
      if (request.state !== "opened") {
        await markRecipientRecoveryOpened(request.id);
        setRequest((current) => current ? { ...current, state: "opened" } : current);
      }
    } catch (err) {
      const message = err?.message || "Couldn't open the recovered vault.";
      setError(/did not match\. It was excluded safely/i.test(message)
        ? message
        : /decrypt|auth|cipher|key/i.test(message)
        ? "That recovery passphrase did not match the key created when you accepted the invitation."
        : message);
    } finally {
      rawVaultKey?.fill(0);
      setOpening(false);
    }
  }

  if (!sessionLoaded) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;
  if (!session) {
    return (
      <div>
        <div className="mx-auto max-w-md px-5 pt-12 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Nominee recovery</p>
          <h1 className="mt-3 text-[30px] font-semibold tracking-tight">Sign in to your own account.</h1>
          <p className="mt-3 text-[13px] leading-5 text-[#86868b]">Use the exact email that accepted the Circle of Trust invite.</p>
        </div>
        <div className="mt-6"><AuthScreen returnPath="/download" onSignedIn={setSession} /></div>
      </div>
    );
  }

  if (recoveredVault) {
    return <RecoveredVault
      vault={recoveredVault}
      ownerInstructions={ownerInstructions}
      onLock={() => { setRecoveredVault(null); setOwnerInstructions(""); }}
      onSignOut={() => signOut().then(() => { setSession(null); setRecoveredVault(null); setOwnerInstructions(""); })}
    />;
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-xl px-5 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos · Nominee</p>
            <h1 className="mt-2 text-[32px] font-semibold tracking-tight">Open the recovered vault</h1>
          </div>
          <button onClick={() => signOut().then(() => setSession(null))} className="text-[12px] text-[#86868b]">Sign out</button>
        </div>

        <SafeOpeningGuide />
        {loading && <p className="mt-7 text-[14px] text-[#86868b]">Loading…</p>}
        {error && <div className="mt-5 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

        {!loading && !request && (
          <div className="mt-7 rounded-2xl border border-dashed border-black/12 bg-white p-6 text-center">
            <p className="text-[14px] font-medium">No recovery request is linked to this account.</p>
            <a href="/claim" className="mt-4 inline-block rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white">View entrusted vaults</a>
          </div>
        )}

        {!loading && request && !readyNow && (
          <div className="mt-7 rounded-2xl border border-black/8 bg-white p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Current state</p>
            <p className="mt-1 text-[17px] font-semibold capitalize">{request.state.replaceAll("_", " ")}</p>
            <p className="mt-2 text-[13px] leading-5 text-[#6e6e73]">{waitingCopy(request)}</p>
            <button onClick={refresh} className="mt-4 rounded-full border border-black/10 px-4 py-2 text-[11px] font-semibold">Check again</button>
          </div>
        )}

        {!loading && request && readyNow && (
          <div className="mt-7 rounded-3xl border border-[#34c759]/25 bg-white p-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">Approved and ready</p>
            <h2 className="mt-2 text-[23px] font-semibold tracking-tight">Three independent keys have matched.</h2>
            <p className="mt-3 text-[13px] leading-5 text-[#6e6e73]">Type the recovery passphrase you created when accepting the owner's invitation. It is used only on this device.</p>
            <label className="mt-5 block">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Your recovery passphrase</span>
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" placeholder="Minimum 12 characters" className="mt-2 w-full rounded-xl border border-black/10 bg-[#fbfbfd] px-4 py-3 text-[14px] outline-none focus:border-[#1d1d1f]" />
            </label>
            <button onClick={openVault} disabled={opening || passphrase.length < 12} className="mt-4 w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{opening ? "Matching keys…" : "Open entire vault read-only"}</button>
          </div>
        )}

        <button onClick={onReturnHome} className="mt-10 text-[12px] text-[#86868b]">Return to Lyfos</button>
      </div>
    </main>
  );
}

function SafeOpeningGuide() {
  return (
    <section className="mt-7 rounded-2xl bg-[#fff8eb] p-5 text-[#7a4b00]">
      <p className="text-[12px] font-semibold">When the vault opens</p>
      <ol className="mt-2 space-y-1.5 text-[12px] leading-5">
        <li>1. Read the owner's personal instructions first.</li>
        <li>2. Preserve an offline copy before contacting institutions.</li>
        <li>3. Verify documents and account numbers independently.</li>
        <li>4. Do not move money, close accounts, or share passwords until legal authority is clear.</li>
      </ol>
    </section>
  );
}

function RecoveredVault({ vault, ownerInstructions, onLock, onSignOut }) {
  const [query, setQuery] = useState("");
  const visibleItems = useMemo(() => filterRecoveredItems(vault.items, query), [vault.items, query]);

  useEffect(() => {
    let timer;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onLock, 5 * 60 * 1000);
    };
    const hide = () => { if (document.hidden) onLock(); };
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, arm, { passive: true }));
    document.addEventListener("visibilitychange", hide);
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, arm));
      document.removeEventListener("visibilitychange", hide);
    };
  }, [onLock]);

  function downloadCopy() {
    if (!window.confirm("Save a plaintext offline copy on this device? Anyone who can open the file can read the recovered vault. Store it securely and delete it when it is no longer needed.")) return;
    const payload = JSON.stringify({
      kind: "lyfos-recipient-recovery",
      version: 1,
      recoveredAt: new Date().toISOString(),
      ownerInstructions,
      vault
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `lyfos-recovered-vault-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <div className="mx-auto max-w-4xl px-5 py-10 md:py-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0b6b3a]">Recovered · Read only</p>
            <h1 className="mt-2 text-[36px] font-semibold tracking-tight">The entire vault</h1>
            <p className="mt-2 text-[13px] text-[#6e6e73]">Nothing here can edit, sync, or change the owner's account.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={downloadCopy} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[11px] font-semibold text-white">Save plaintext offline copy</button>
            <button onClick={onLock} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] font-semibold">Lock vault</button>
            <button onClick={onSignOut} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] font-semibold">Sign out</button>
          </div>
        </div>

        <section className="mt-8 rounded-3xl bg-[#1d1d1f] p-6 text-white md:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Read this first · From the owner</p>
          <p className="mt-4 whitespace-pre-wrap text-[17px] leading-7 text-white/90">{ownerInstructions || "No personal instructions were added. Follow the safety steps below and verify legal authority before acting."}</p>
        </section>

        <SafeOpeningGuide />

        <div className="mt-8 flex items-baseline justify-between">
          <h2 className="text-[22px] font-semibold">All records</h2>
          <span className="text-[12px] text-[#86868b]">{vault.items.length} records</span>
        </div>
        <label className="mt-4 block">
          <span className="sr-only">Search recovered records</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and context" className="w-full rounded-2xl border border-black/8 bg-white px-4 py-3 text-[13px] outline-none focus:border-[#1d1d1f]" />
        </label>
        <div className="mt-4 space-y-3">
          {visibleItems.map((item, index) => <RecoveredRecord key={item.id || `${item.title}-${index}`} item={item} />)}
          {vault.items.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-[13px] text-[#86868b]">The vault contains no records.</div>}
          {vault.items.length > 0 && visibleItems.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-[13px] text-[#86868b]">No records match this search.</div>}
        </div>

        <details className="mt-8 rounded-2xl border border-black/8 bg-white p-5">
          <summary className="cursor-pointer text-[13px] font-semibold">Vault context and release record</summary>
          <p className="mt-2 text-[12px] leading-5 text-[#86868b]">Additional read-only vault content, including balances and audit history. Owner account settings and devices are excluded.</p>
          <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#f5f5f7] p-4 text-[11px] leading-5">{JSON.stringify({
            balanceSheet: vault.balanceSheet ?? null,
            audit: vault.audit ?? null
          }, null, 2)}</pre>
        </details>
      </div>
    </main>
  );
}

function RecoveredRecord({ item }) {
  const [open, setOpen] = useState(item.type === "emergency_instruction");
  const [revealed, setRevealed] = useState(() => new Set());
  const [copied, setCopied] = useState("");

  async function copyValue(key, value) {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1500);
    } catch {
      setCopied("");
    }
  }

  function toggleReveal(key) {
    setRevealed((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  return (
    <article className="overflow-hidden rounded-2xl border border-black/8 bg-white">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#86868b]">{typeLabel(item.type)}</p>
          <h3 className="mt-1 text-[16px] font-semibold">{item.title || "Untitled record"}</h3>
        </div>
        <span className="text-[18px] text-[#86868b]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-black/8 px-5 py-5">
          <dl className="grid gap-4 md:grid-cols-2">
            {FIELD_LABELS.filter(([key]) => String(item[key] ?? "").trim()).map(([key, label]) => {
              const sensitive = isSensitiveRecoveredField(key);
              const isRevealed = revealed.has(key);
              return (
                <div key={key} className={key === "notes" ? "md:col-span-2" : ""}>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#86868b]">{label}</dt>
                  <dd className="mt-1 flex items-start gap-2">
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-5">{sensitive && !isRevealed ? "••••••••••••" : item[key]}</span>
                    {sensitive && <button type="button" onClick={() => toggleReveal(key)} className="shrink-0 text-[10px] font-semibold text-[#075985]">{isRevealed ? "Hide" : "Reveal"}</button>}
                    {(!sensitive || isRevealed) && <button type="button" onClick={() => copyValue(key, item[key])} className="shrink-0 text-[10px] font-semibold text-[#6e6e73]">{copied === key ? "Copied" : "Copy"}</button>}
                  </dd>
                </div>
              );
            })}
          </dl>
          {(item.attachments?.length ?? 0) > 0 && (
            <div className="mt-5 border-t border-black/8 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#86868b]">Attachments</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.attachments.map((attachment) => (
                  <a key={attachment.id || attachment.name} href={attachment.dataUrl} download={attachment.name} className="rounded-full border border-black/10 bg-[#fbfbfd] px-3 py-1.5 text-[11px] font-semibold">Download {attachment.name}</a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function waitingCopy(request) {
  if (request.state === "under_review") return "Lyfos is reviewing the evidence.";
  if (request.state === "collecting_support") return "Two other nominees must release their keys.";
  if (request.state === "holding") return `The owner-protection hold ends ${request.ready_at ? new Date(request.ready_at).toLocaleString() : "after 14 days"}.`;
  if (request.state === "aborted") return "The owner stopped this recovery. The vault remains sealed.";
  if (request.state === "rejected") return `The request was rejected${request.rejection_reason ? `: ${request.rejection_reason}` : "."}`;
  return "Return to the entrusted-vault page for details.";
}

function typeLabel(type) {
  return ({
    bank_account: "Bank / money",
    password: "Password",
    pin: "PIN / device code",
    email_account: "Email account",
    card: "Card",
    identity_document: "Identity document",
    insurance_policy: "Insurance",
    important_document: "Important document",
    emergency_instruction: "Emergency instruction"
  })[type] || String(type || "Record").replaceAll("_", " ");
}

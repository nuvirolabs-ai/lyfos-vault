import React, { useEffect, useMemo, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange, signOut } from "./lib/auth.js";
import {
  createRelationshipRecoveryRequest,
  fetchMyReleaseRequests,
  getEntrustedInstructions,
  getRecipientRecoveryProgressDetailed,
  listEntrustedVaults
} from "./lib/releaseClaim.js";
import { deriveHolderKeypairFromPassphrase, openSealedShare } from "./lib/shareCrypto.js";

const ACTIVE_STATES = new Set(["under_review", "collecting_support", "holding", "ready_to_recover"]);

export function NomineeEntryScreen({ onReturnHome }) {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [vaults, setVaults] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      const [nextVaults, nextRequests] = await Promise.all([
        listEntrustedVaults(),
        fetchMyReleaseRequests()
      ]);
      setVaults(nextVaults);
      const mine = nextRequests.filter((request) => request.nominee_user_id === session.user.id);
      const withProgress = await Promise.all(mine.map(async (request) => {
        if (request.state !== "collecting_support") return request;
        const progress = await getRecipientRecoveryProgressDetailed(request.id);
        return { ...request, support_progress: progress };
      }));
      setRequests(withProgress);
    } catch (err) {
      setError(err?.message || "Couldn't load the vaults entrusted to you.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [session?.user?.id]);

  if (!sessionLoaded) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;
  if (!session) {
    return (
      <div>
        <Intro />
        <div className="mt-4"><AuthScreen returnPath="/claim" onSignedIn={setSession} title="Sign in" subtitle="" /></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-2xl px-5 py-10 md:py-14">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos · Nominee</p>
            <h1 className="mt-2 text-[34px] font-semibold tracking-tight">Vaults entrusted to you</h1>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-[#6e6e73]">You always use your own account. You never sign in as the vault owner.</p>
          </div>
          <button onClick={() => signOut().then(() => setSession(null))} className="shrink-0 text-[12px] text-[#86868b] hover:text-[#1d1d1f]">Sign out</button>
        </div>

        <RecoveryGuide />
        {error && <div className="mt-5 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}
        {loading && <p className="mt-8 text-[14px] text-[#86868b]">Loading…</p>}

        {!loading && vaults.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-black/12 bg-white p-7 text-center">
            <p className="text-[15px] font-medium">No active primary or backup vault is linked yet.</p>
            <p className="mt-2 text-[12px] leading-5 text-[#86868b]">Accept the invitation with this email, then wait for the owner to activate all five nominees. The vault will appear here automatically.</p>
          </div>
        )}

        <div className="mt-8 space-y-4">
          {vaults.map((vault) => (
            <EntrustedVaultCard
              key={vault.holder_id}
              vault={vault}
              request={requests.find((item) => item.recipient_holder_id === vault.holder_id && ACTIVE_STATES.has(item.state))
                ?? requests.find((item) => item.recipient_holder_id === vault.holder_id)}
              onChanged={refresh}
              holderUserId={session.user.id}
            />
          ))}
        </div>

        <button onClick={onReturnHome} className="mt-10 text-[12px] text-[#86868b] hover:text-[#1d1d1f]">Return to Lyfos</button>
      </div>
    </main>
  );
}

// A little more gravity than the owner's own sign-in screen, on
// purpose — this is someone else's vault, and the one rule that
// matters most (always your own account, never the owner's) needs to
// land before the form does. Amber, not red: serious, not alarming.
function Intro() {
  return (
    <div className="mx-auto max-w-sm px-5 pt-14 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-[#fdf4e3]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7a4b00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="15" r="4" />
          <path d="M11 12 L20 3 M17 6 l3 3 M14 9 l2 2" />
        </svg>
      </div>
      <h1 className="mt-5 text-[24px] font-semibold leading-[1.2] tracking-tight text-[#1d1d1f]">Recovering someone else's vault.</h1>
      <p className="mt-2 text-[13px] leading-5 text-[#6e6e73]">Sign in with your own account — the one that accepted the invite.</p>
    </div>
  );
}

function RecoveryGuide() {
  return (
    <section className="mt-8 rounded-2xl border border-black/8 bg-white p-5">
      <p className="text-[12px] font-semibold">Before you begin</p>
      <ol className="mt-3 grid gap-2 text-[12px] leading-5 text-[#6e6e73] md:grid-cols-2">
        <li className="rounded-xl bg-[#f5f5f7] px-3 py-2.5"><strong className="text-[#1d1d1f]">1. Start recovery.</strong> Confirm your private recovery passphrase to begin.</li>
        <li className="rounded-xl bg-[#f5f5f7] px-3 py-2.5"><strong className="text-[#1d1d1f]">2. Two people help.</strong> Two other nominees must independently release their keys, each on their own account.</li>
        <li className="rounded-xl bg-[#f5f5f7] px-3 py-2.5"><strong className="text-[#1d1d1f]">3. Owner is notified.</strong> The owner gets an email the moment recovery starts, and again the moment the vault is opened.</li>
        <li className="rounded-xl bg-[#f5f5f7] px-3 py-2.5"><strong className="text-[#1d1d1f]">4. Open read-only.</strong> Once two others have approved, type your recovery passphrase again to open the vault.</li>
      </ol>
      <p className="mt-3 text-[11px] leading-5 text-[#86868b]">Nobody — including you — can open the vault alone. It always takes you plus two other nominees, each using their own private passphrase.</p>
    </section>
  );
}

function EntrustedVaultCard({ vault, request, onChanged, holderUserId }) {
  const [open, setOpen] = useState(false);
  const [fallbackReason, setFallbackReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [instructionPassphrase, setInstructionPassphrase] = useState("");
  const [personalInstructions, setPersonalInstructions] = useState(null);
  const [unlockingInstructions, setUnlockingInstructions] = useState(false);
  const isBackup = vault.holder_role === "backup";
  const canRestart = ["rejected", "aborted", "expired"].includes(request?.state);
  const canSubmit = personalInstructions !== null && (!isBackup || fallbackReason.trim().length >= 10);
  const status = useMemo(() => request ? request.state.replaceAll("_", " ") : "ready", [request]);

  async function reviewInstructions() {
    if (instructionPassphrase.length < 12) return;
    setUnlockingInstructions(true);
    setError("");
    try {
      const [envelope, keypair] = await Promise.all([
        getEntrustedInstructions(vault.holder_id),
        deriveHolderKeypairFromPassphrase(instructionPassphrase, holderUserId)
      ]);
      const opened = await openSealedShare(envelope, keypair.secretKey);
      try {
        setPersonalInstructions(new TextDecoder().decode(opened));
        setInstructionPassphrase("");
      } finally {
        opened.fill(0);
      }
    } catch {
      setError("That passphrase did not match the private recovery key created when you accepted the invitation.");
    } finally {
      setUnlockingInstructions(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await createRelationshipRecoveryRequest({
        holderId: vault.holder_id,
        requestKind: isBackup ? "backup" : "normal",
        fallbackReason
      });
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err?.message || "Couldn't submit this recovery request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-black/8 bg-white p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#86868b]">{isBackup ? "Backup nominee" : "Primary nominee"}</p>
          <h2 className="mt-1 text-[21px] font-semibold">{vault.owner_email?.split("@")[0] || "Vault owner"}'s vault</h2>
          <p className="mt-1 text-[12px] text-[#86868b]">Your label: {vault.holder_label}</p>
        </div>
        <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6e6e73]">{status}</span>
      </div>

      {request && !canRestart ? (
        <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4">
          <p className="text-[13px] font-medium">{requestCopy(request)}</p>
          {request.state === "collecting_support" && request.support_progress && (
            <SupportRoster progress={request.support_progress} />
          )}
          {["ready_to_recover", "opened"].includes(request.state) && <a href="/download" className="mt-3 inline-block rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white">Open recovered vault</a>}
        </div>
      ) : !open ? (
        <div className="mt-5">
          {canRestart && <div className="mb-4 rounded-2xl bg-[#f5f5f7] p-4 text-[13px] font-medium">{requestCopy(request)}</div>}
          <button onClick={() => setOpen(true)} className="rounded-full bg-[#1d1d1f] px-5 py-2.5 text-[12px] font-semibold text-white">{canRestart ? "Start new recovery" : "Start recovery"}</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-4 border-t border-black/8 pt-5">
          {personalInstructions === null ? (
            <div className="rounded-2xl bg-[#fff8eb] p-4 text-[#7a4b00]">
              <p className="text-[12px] font-semibold">First, read the owner's private instructions.</p>
              <p className="mt-1 text-[11px] leading-5">This also confirms that your recovery passphrase matches before you start recovery.</p>
              <input type="password" autoComplete="current-password" value={instructionPassphrase} onChange={(event) => setInstructionPassphrase(event.target.value)} placeholder="Private recovery passphrase" className="mt-3 w-full rounded-xl border border-[#c88719]/25 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#7a4b00]" />
              <button type="button" onClick={reviewInstructions} disabled={unlockingInstructions || instructionPassphrase.length < 12} className="mt-3 rounded-full bg-[#7a4b00] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{unlockingInstructions ? "Opening…" : "Read private instructions"}</button>
            </div>
          ) : (
            <div className="rounded-2xl bg-[#1d1d1f] p-5 text-white">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50">From the owner · Read before filing</p>
              <p className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-white/90">{personalInstructions || "The owner did not add a personal note. Continue with the fixed Lyfos instructions above."}</p>
            </div>
          )}
          {isBackup && (
            <label className="block">
              <span className="text-[11px] font-medium">Why the primary cannot act</span>
              <textarea value={fallbackReason} onChange={(event) => setFallbackReason(event.target.value)} rows={2} placeholder="Explain why backup recovery is necessary." className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#fbfbfd] px-3 py-2 text-[13px] outline-none focus:border-[#1d1d1f]" />
            </label>
          )}
          {error && <div className="rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[12px] font-medium text-[#b42318]">{error}</div>}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-[#86868b]">Cancel</button>
            <button type="submit" disabled={!canSubmit || busy} className="rounded-full bg-[#1d1d1f] px-5 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? "Starting…" : "Start recovery"}</button>
          </div>
        </form>
      )}
    </section>
  );
}

function SupportRoster({ progress }) {
  const { recipient, supporters = [], required = 2 } = progress;
  const approvedCount = supporters.filter((s) => s.status === "approved").length;
  return (
    <div className="mt-3">
      {recipient && (
        <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
          <span className="text-[13px] font-medium">You · {roleLabel(recipient.role)}</span>
          <StatusBadge status="filed" />
        </div>
      )}
      <p className="mt-2 text-[11px] text-[#86868b]">{approvedCount} of {required} needed have approved:</p>
      <div className="mt-1.5 space-y-1.5">
        {supporters.map((s, i) => (
          <div key={`${s.label}-${i}`} className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
            <span className="text-[13px] font-medium">{s.label} · {roleLabel(s.role)}</span>
            <StatusBadge status={s.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function roleLabel(role) {
  if (role === "primary") return "Primary";
  if (role === "backup") return "Backup";
  return "Trusted";
}

function StatusBadge({ status }) {
  const styles = {
    filed: "bg-[#f5f5f7] text-[#6e6e73]",
    approved: "bg-[#34c759]/12 text-[#0b6b3a]",
    refused: "bg-[#ff453a]/10 text-[#b42318]",
    waiting: "bg-[#f5f5f7] text-[#86868b]"
  };
  const text = { filed: "Filed", approved: "Approved", refused: "Refused", waiting: "Waiting" };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${styles[status] || styles.waiting}`}>{text[status] || "Waiting"}</span>;
}

function requestCopy(request) {
  if (request.state === "under_review") return "Lyfos is reviewing the evidence. No nominee key has been requested yet.";
  if (request.state === "collecting_support") return "Approved. Two other nominees are being asked to release their keys.";
  if (request.state === "holding") return "Two supporting keys matched. The 14-day owner-protection hold is running.";
  if (["ready_to_recover", "opened"].includes(request.state)) return "The authorized recovery can be opened again read-only with your private recovery passphrase.";
  if (request.state === "rejected") return `The request was rejected${request.rejection_reason ? `: ${request.rejection_reason}` : "."}`;
  if (request.state === "aborted") return "The vault owner stopped this recovery. The vault remains sealed.";
  return `Recovery state: ${request.state.replaceAll("_", " ")}.`;
}

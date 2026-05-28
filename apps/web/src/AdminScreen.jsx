// Lyfos — founder admin review queue.
//
// Reachable at /admin. Requires the signed-in user's auth.users
// raw_user_meta_data->>'role' = 'admin'. The admin_list_pending_releases
// RPC enforces that at the server; this UI just renders whatever the
// RPC returns (or "not authorized" if it raises).
//
// What the queue shows for each pending release:
//   - Owner email
//   - Nominee email
//   - When the claim was filed
//   - A "view certificate" button that fetches a 60-second signed URL
//     and opens it in a new tab
//   - Approve (with optional note) / Reject (reason required)
//
// Once approved, the holder-side UI (Day 10) takes over.

import React, { useEffect, useState } from "react";
import { getSession, onAuthStateChange } from "./lib/auth.js";
import {
  adminListPendingReleases,
  adminGetCertificateUrl,
  adminApproveRelease,
  adminRejectRelease
} from "./lib/releaseClaim.js";

export function AdminScreen({ onReturnHome }) {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => { if (!cancelled) { setSession(s); setSessionLoaded(true); } })
      .catch(() => { if (!cancelled) setSessionLoaded(true); });
    const unsubscribe = onAuthStateChange((next) => {
      if (!cancelled) { setSession(next); setSessionLoaded(true); }
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setRows(await adminListPendingReleases());
    } catch (err) {
      setError(err?.message || "Couldn't load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sessionLoaded && session) refresh();
  }, [sessionLoaded, session?.user?.id]);

  if (!sessionLoaded) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;
  if (!session) {
    return (
      <Frame>
        <h1 className="text-[28px] font-semibold tracking-tight">Sign in to view the queue.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">This page is only visible to Lyfos founders.</p>
        <a href="/" className="mt-8 inline-block rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white">Go to Lyfos</a>
      </Frame>
    );
  }
  if (error?.toLowerCase().includes("not authorized")) {
    return (
      <Frame>
        <h1 className="text-[28px] font-semibold tracking-tight">Not authorized.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">This page is only visible to Lyfos founders.</p>
        <button onClick={onReturnHome} className="mt-8 rounded-full border border-black/8 bg-white px-5 py-2 text-[12px] font-semibold text-[#1d1d1f]">Go home</button>
      </Frame>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos · Admin</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Release review queue</h1>
          </div>
          <button onClick={refresh} className="rounded-full border border-black/8 bg-white px-4 py-1.5 text-[11px] font-semibold text-[#1d1d1f]" disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && <div className="mt-6 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

        <div className="mt-8 space-y-3">
          {rows.length === 0 && !loading && (
            <p className="rounded-2xl border border-dashed border-black/12 bg-white p-6 text-center text-[14px] text-[#86868b]">No pending releases.</p>
          )}
          {rows.map((r) => <ReviewRow key={r.id} row={r} onChanged={refresh} />)}
        </div>

        <footer className="mt-12 border-t border-black/8 pt-6 text-[11px] text-[#a1a1a6]">
          <p>Signed in as {session.user?.email}. The admin role is granted via Postgres only — there is no UI to grant it.</p>
        </footer>
      </div>
    </main>
  );
}

function ReviewRow({ row, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  async function viewCert() {
    try {
      const url = await adminGetCertificateUrl(row.id);
      if (!url) {
        alert("No certificate uploaded for this claim.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(err?.message || "Couldn't fetch certificate URL.");
    }
  }

  async function approve() {
    setBusy(true);
    try {
      await adminApproveRelease(row.id, note);
      await onChanged();
    } catch (err) {
      alert(err?.message || "Approve failed.");
    } finally { setBusy(false); }
  }

  async function reject() {
    if (!reason.trim()) { alert("Rejection reason is required."); return; }
    setBusy(true);
    try {
      await adminRejectRelease(row.id, reason);
      await onChanged();
    } catch (err) {
      alert(err?.message || "Reject failed.");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#86868b]">
            {row.state} · {new Date(row.created_at).toLocaleString()}
          </p>
          <p className="mt-1 text-[15px] font-medium">Owner: {row.owner_email}</p>
          <p className="text-[13px] text-[#6e6e73]">Nominee: {row.nominee_email_at_request}</p>
        </div>
        <button onClick={viewCert} className="shrink-0 rounded-full border border-black/8 bg-[#fbfbfd] px-3 py-1 text-[11px] font-semibold text-[#1d1d1f]">
          View certificate
        </button>
      </div>

      {row.state === "pending_review" && (
        <div className="mt-4">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Note for the audit log (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. verified against state DC database"
              className="mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#1d1d1f]"
            />
          </label>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button onClick={() => setShowReject((v) => !v)} className="text-[11px] font-medium text-[#b42318] hover:underline" disabled={busy}>
              {showReject ? "Cancel reject" : "Reject"}
            </button>
            <button
              onClick={approve}
              disabled={busy}
              className="rounded-full bg-[#1d1d1f] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Approve"}
            </button>
          </div>
          {showReject && (
            <div className="mt-3 rounded-xl bg-[#ff453a]/6 p-3">
              <label className="block">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#b42318]">Reason (visible to the nominee)</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. certificate is illegible; please re-upload a higher-resolution scan"
                  className="mt-1 w-full rounded-md border border-[#b42318]/30 bg-white px-3 py-1.5 text-[13px] outline-none"
                />
              </label>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={reject}
                  disabled={busy || !reason.trim()}
                  className="rounded-full bg-[#b42318] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  Confirm reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {row.rejection_reason && (
        <p className="mt-3 rounded-md bg-[#ff453a]/6 px-3 py-2 text-[12px] text-[#b42318]">
          Rejected · {row.rejection_reason}
        </p>
      )}
    </div>
  );
}

function Frame({ children }) {
  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-md px-5 py-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos · Admin</p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

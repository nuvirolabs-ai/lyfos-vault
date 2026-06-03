// Central app state. Wraps the whole app inside <AppProvider>.
//
// Holds:
//   - storedRecord: the encrypted vault from SecureStore (if any)
//   - vaultKey:    raw 32-byte key while unlocked
//   - vault:       decrypted vault state
//   - session:     Supabase session (or null)
//   - subscription + entitlements
//
// Provides actions that the screens compose:
//   - createVault, unlockWithPassphrase, unlockWithRecovery, lock
//   - save (re-encrypts, persists locally, fires server push)
//   - signIn / signOut via auth.ts wrappers

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { Session } from "@supabase/supabase-js";

import {
  createVaultRecord,
  decryptWithPassphrase,
  decryptWithRecoveryPhrase,
  reencryptVaultPayload,
  VaultRecord
} from "./lib/vaultRecord";
import {
  loadVaultRecord, saveVaultRecord, clearVaultRecord,
  ensureDeviceToken, loadAutoLockMs, saveAutoLockMs,
  loadPendingAuditEvents, savePendingAuditEvents, drainPendingAuditEvents,
  loadBiometricEnabled, saveBiometricEnabled
} from "./lib/storage";
import {
  pushEncryptedRecord, fetchEncryptedRecord, reconcileLocalAndServer,
  registerOrTouchDevice
} from "./lib/vaultSync";
import { getSession, onAuthStateChange, signOut as authSignOut, appendServerAuditEvent, isSupabaseConfigured } from "./lib/auth";
import { fetchMySubscription } from "./lib/billing";
import { entitlementsFor } from "./lib/plans";
import { createEmptyVault, appendAuditEvent } from "./lib/balanceSheet";
import { unlockWithBiometric, biometricUnlockConfigured } from "./lib/biometric";

interface AppContextValue {
  // Auth
  session: Session | null;
  sessionLoaded: boolean;
  signOut: () => Promise<void>;
  // Vault key accessor (for the release-plan finalize flow)
  getRawVaultKey: () => Uint8Array | null;

  // Vault state
  storedRecord: VaultRecord | null;
  vault: any | null;
  unlocked: boolean;

  // Settings
  autoLockMs: number;
  setAutoLockMs: (ms: number) => Promise<void>;
  biometricEnabled: boolean;
  setBiometricEnabled: (b: boolean) => Promise<void>;

  // Subscription
  subscription: any | null;
  entitlements: ReturnType<typeof entitlementsFor>;
  refreshSubscription: () => Promise<void>;

  // Actions
  createVault: (input: { passphrase: string; recoveryPhrase: string; initialVault?: any }) => Promise<void>;
  unlockWithPassphrase: (passphrase: string) => Promise<void>;
  unlockWithRecovery: (phrase: string) => Promise<void>;
  unlockWithBiometricIfReady: () => Promise<boolean>;
  lock: (reason?: string) => void;
  save: (mutator: (vault: any) => any, eventLabel?: string) => Promise<void>;
  deleteLocalVault: () => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(!isSupabaseConfigured());
  const [storedRecord, setStoredRecord] = useState<VaultRecord | null>(null);
  const [vault, setVault] = useState<any | null>(null);
  const vaultKeyRef = useRef<Uint8Array | null>(null);
  const [autoLockMs, setAutoLockMsState] = useState(300_000);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [subscription, setSubscription] = useState<any | null>(null);
  const lastActivityRef = useRef(Date.now());

  // Boot: load local state
  useEffect(() => {
    (async () => {
      await ensureDeviceToken();
      const [rec, lockMs, bioOn] = await Promise.all([
        loadVaultRecord(),
        loadAutoLockMs(),
        loadBiometricEnabled()
      ]);
      setStoredRecord(rec);
      setAutoLockMsState(typeof lockMs === "number" ? lockMs : 300_000);
      setBiometricEnabledState(Boolean(bioOn));
    })();
  }, []);

  // Boot: hydrate Supabase session + subscribe
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let mounted = true;
    getSession()
      .then((s) => { if (mounted) { setSession(s); setSessionLoaded(true); } })
      .catch(() => { if (mounted) setSessionLoaded(true); });
    const unsub = onAuthStateChange((next) => {
      if (!mounted) return;
      setSession(next);
      setSessionLoaded(true);
    });
    return () => { mounted = false; unsub(); };
  }, []);

  // When session arrives: register device, fetch sub, reconcile vault
  useEffect(() => {
    if (!session) { setSubscription(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureDeviceToken();
        await registerOrTouchDevice({ deviceToken: token });
      } catch {}
      try {
        const sub = await fetchMySubscription();
        if (!cancelled) setSubscription(sub);
      } catch {}
      try {
        const { record: serverRecord } = await fetchEncryptedRecord();
        if (cancelled) return;
        const decision = reconcileLocalAndServer({ localRecord: storedRecord as any, serverRecord });
        if (decision.needsReplaceLocal && decision.record) {
          await saveVaultRecord(decision.record);
          setStoredRecord(decision.record);
        } else if (decision.needsPush && decision.record) {
          pushEncryptedRecord(decision.record).catch(() => {});
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Auto-lock on activity timer + background
  useEffect(() => {
    const interval = setInterval(() => {
      if (!vaultKeyRef.current) return;
      if (Date.now() - lastActivityRef.current > autoLockMs) lock("inactivity");
    }, 30_000);

    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") {
        lastActivityRef.current = Date.now();
      } else if (vaultKeyRef.current) {
        // any non-active state (background / inactive) → lock
        lock("background");
      }
    });

    return () => { clearInterval(interval); sub.remove(); };
  }, [autoLockMs]);

  // ============================================================
  // Actions
  // ============================================================

  const persistDecrypted = useCallback(async (record: VaultRecord, decryptedVault: any) => {
    await saveVaultRecord(record);
    setStoredRecord(record);
    setVault(decryptedVault);
    if (session) pushEncryptedRecord(record).catch(() => {});
  }, [session]);

  const createVault = useCallback(async (input: { passphrase: string; recoveryPhrase: string; initialVault?: any }) => {
    const log = (m: string) => { try { console.log("[lyfos:createVault]", m); } catch {} };
    const v = input.initialVault ?? createEmptyVault();
    log("createVaultRecord start (argon2id ×2)…");
    const t0 = Date.now();
    const { record, vaultKey } = await createVaultRecord({
      vault: v, passphrase: input.passphrase, recoveryPhrase: input.recoveryPhrase
    });
    log(`createVaultRecord done in ${Date.now() - t0}ms; persisting…`);
    vaultKeyRef.current = vaultKey;
    await persistDecrypted(record, v);
    log("persisted ok");
    lastActivityRef.current = Date.now();
  }, [persistDecrypted]);

  const unlockWithPassphrase = useCallback(async (passphrase: string) => {
    if (!storedRecord) throw new Error("No vault to unlock on this device.");
    const result = await decryptWithPassphrase(storedRecord, passphrase);
    vaultKeyRef.current = result.vaultKey;
    // Append unlock audit + drain pending events from background-locked sessions
    const pending = await drainPendingAuditEvents();
    let auditedVault = appendAuditEvent(result.vault, "Vault unlocked with phrase");
    for (const evt of pending.reverse()) auditedVault = appendAuditEvent(auditedVault, evt);
    const updated = await reencryptVaultPayload(storedRecord, result.vaultKey, auditedVault);
    await persistDecrypted(updated, auditedVault);
    lastActivityRef.current = Date.now();
  }, [storedRecord, persistDecrypted]);

  const unlockWithRecovery = useCallback(async (phrase: string) => {
    if (!storedRecord) throw new Error("No vault to unlock on this device.");
    const result = await decryptWithRecoveryPhrase(storedRecord, phrase);
    vaultKeyRef.current = result.vaultKey;
    const pending = await drainPendingAuditEvents();
    let auditedVault = appendAuditEvent(result.vault, "Vault unlocked with recovery key");
    for (const evt of pending.reverse()) auditedVault = appendAuditEvent(auditedVault, evt);
    const updated = await reencryptVaultPayload(storedRecord, result.vaultKey, auditedVault);
    await persistDecrypted(updated, auditedVault);
    lastActivityRef.current = Date.now();
  }, [storedRecord, persistDecrypted]);

  const unlockWithBiometricIfReady = useCallback(async () => {
    if (!biometricEnabled) return false;
    if (!(await biometricUnlockConfigured())) return false;
    const passphrase = await unlockWithBiometric();
    if (!passphrase) return false;
    try {
      await unlockWithPassphrase(passphrase);
      return true;
    } catch {
      return false;
    }
  }, [biometricEnabled, unlockWithPassphrase]);

  const lock = useCallback((reason?: string) => {
    if (vaultKeyRef.current) {
      // Best-effort zero the key buffer
      for (let i = 0; i < vaultKeyRef.current.length; i++) vaultKeyRef.current[i] = 0;
      vaultKeyRef.current = null;
    }
    setVault(null);
    if (reason && reason !== "manual") {
      // Buffer the audit event for next unlock to record
      loadPendingAuditEvents().then((arr) => savePendingAuditEvents([...arr, `Vault auto-locked (${reason})`]));
    }
  }, []);

  const save = useCallback(async (mutator: (vault: any) => any, eventLabel?: string) => {
    if (!vault || !vaultKeyRef.current || !storedRecord) throw new Error("Vault is locked.");
    const next = mutator(vault);
    const audited = eventLabel ? appendAuditEvent(next, eventLabel) : next;
    const updated = await reencryptVaultPayload(storedRecord, vaultKeyRef.current, audited);
    await persistDecrypted(updated, audited);
    lastActivityRef.current = Date.now();
  }, [vault, storedRecord, persistDecrypted]);

  const setAutoLockMs = useCallback(async (ms: number) => {
    await saveAutoLockMs(ms);
    setAutoLockMsState(ms);
  }, []);

  const setBiometricEnabled = useCallback(async (b: boolean) => {
    await saveBiometricEnabled(b);
    setBiometricEnabledState(b);
  }, []);

  const refreshSubscription = useCallback(async () => {
    const fresh = await fetchMySubscription().catch(() => null);
    setSubscription(fresh);
  }, []);

  const signOut = useCallback(async () => {
    await appendServerAuditEvent("sign_out", {}).catch(() => {});
    await authSignOut();
    setSession(null);
    setSubscription(null);
  }, []);

  const deleteLocalVault = useCallback(async () => {
    await clearVaultRecord();
    setStoredRecord(null);
    setVault(null);
    vaultKeyRef.current = null;
  }, []);

  const entitlements = useMemo(() => entitlementsFor(subscription), [subscription]);

  const getRawVaultKey = useCallback(() => vaultKeyRef.current, []);

  const value = useMemo<AppContextValue>(() => ({
    session, sessionLoaded, signOut, getRawVaultKey,
    storedRecord, vault, unlocked: Boolean(vault),
    autoLockMs, setAutoLockMs,
    biometricEnabled, setBiometricEnabled,
    subscription, entitlements, refreshSubscription,
    createVault, unlockWithPassphrase, unlockWithRecovery, unlockWithBiometricIfReady,
    lock, save, deleteLocalVault
  }), [
    session, sessionLoaded, signOut,
    storedRecord, vault,
    autoLockMs, setAutoLockMs,
    biometricEnabled, setBiometricEnabled,
    subscription, entitlements, refreshSubscription,
    createVault, unlockWithPassphrase, unlockWithRecovery, unlockWithBiometricIfReady,
    lock, save, deleteLocalVault
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Pulse activity on user interaction (called from a touchable wrapper in the layout)
export function pulseActivity() {
  // Imperative side-channel: the AppProvider holds the ref. We expose a
  // hookable that updates lastActivityRef via context, but for now any
  // navigation event implicitly counts as activity since AppState change
  // also pulses. Leaving this stub for completeness.
}

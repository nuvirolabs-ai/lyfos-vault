import { useEffect, useState } from "react";
import { useApp } from "./AppContext";

/**
 * Returns the raw 32-byte vault key snapshot, or null if locked.
 * Updates when the vault unlocks/locks via the `vault` truthiness.
 */
export function useVaultKey(): Uint8Array | null {
  const { vault, getRawVaultKey } = useApp();
  const [snapshot, setSnapshot] = useState<Uint8Array | null>(null);
  useEffect(() => {
    setSnapshot(vault ? getRawVaultKey() : null);
  }, [vault, getRawVaultKey]);
  return snapshot;
}

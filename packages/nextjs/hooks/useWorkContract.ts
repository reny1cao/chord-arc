"use client";

import { useEffect, useState } from "react";
import { type WorkContract, parseContractURI } from "~~/types/contract";

/**
 * Fetch the off-chain WorkContract referenced by a `Project.contractURI`.
 *
 * Spec: docs/CONTRACT-SCHEMA.md
 *
 * Behavior:
 *   - `contractURI` is the empty string → `{ contract: undefined, ... isLoading: false }`
 *     (legacy project; consumers should fall back to the per-milestone parser).
 *   - Malformed URI                       → `error` is set, `contract` is undefined.
 *   - Fetch error / 404                   → `error` is set, `contract` is undefined.
 *   - Success                             → `contract` holds the parsed JSON.
 *
 * The endpoint emits `Cache-Control: public, max-age=31536000, immutable` (content-
 * addressed: same hash always serves the same bytes), so the browser caches across
 * navigations automatically — we don't add a SWR layer.
 */
export interface UseWorkContractResult {
  contract: WorkContract | undefined;
  isLoading: boolean;
  error: string | undefined;
}

export function useWorkContract(contractURI: string | undefined): UseWorkContractResult {
  const [contract, setContract] = useState<WorkContract | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!contractURI) {
      setContract(undefined);
      setIsLoading(false);
      setError(undefined);
      return;
    }
    const parsed = parseContractURI(contractURI);
    if (!parsed) {
      setContract(undefined);
      setIsLoading(false);
      setError(`invalid contract URI: ${contractURI}`);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    setContract(undefined);

    (async () => {
      try {
        const res = await fetch(`/api/contracts/${parsed.hash}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as WorkContract;
        if (cancelled) return;
        setContract(json);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contractURI]);

  return { contract, isLoading, error };
}

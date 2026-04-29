/**
 * useLicenseStatus — React hook for the current Citadel Cloud license state.
 *
 * Wraps GET /api/citadel-license/status with sensible polling (every 5 min)
 * plus a manual refresh() and a resilient `isUsable` flag matching the
 * backend's license.isUsable() semantics.
 *
 * Phase 2 ships this scaffolding; no component currently uses it (besides
 * <LicenseGate>). Phase 3+ paid features will read from it directly.
 *
 * Usage:
 *
 *   import useLicenseStatus from '../hooks/useLicenseStatus';
 *
 *   function GlobalBansPage() {
 *     const { isUsable, status, refresh } = useLicenseStatus();
 *     if (!isUsable) return <UpgradePrompt />;
 *     ...
 *   }
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import API from '../api';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches CitadelLicenseBanner

/** Match backend/lib/license/index.js#isUsable */
function deriveIsUsable(status) {
  return status === 'active' || status === 'grace';
}

/**
 * Phase 3 — feature entitlement check. Mirrors backend `hasFeature()`:
 * the customer must have an active Citadel sub AND the requested
 * feature must be in their entitlements array.
 */
function deriveHasFeature(status, entitlements, feature) {
  if (!deriveIsUsable(status)) return false;
  if (!Array.isArray(entitlements)) return false;
  return entitlements.includes(feature);
}

/**
 * @returns {{
 *   loading: boolean,
 *   error: string | null,
 *   status: string | null,
 *   subscription: object | null,
 *   cloudSubscription: object | null,
 *   claims: object | null,
 *   entitlements: string[],
 *   lastVerifiedAt: string | null,
 *   isUsable: boolean,
 *   hasCloud: boolean,
 *   hasFeature: (feature: string) => boolean,
 *   refresh: () => Promise<void>,
 * }}
 */
export default function useLicenseStatus() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    status: null,
    subscription: null,
    cloudSubscription: null,
    claims: null,
    entitlements: [],
    lastVerifiedAt: null,
    isUsable: false,
    hasCloud: false,
  });

  // Track mounted-ness so we don't setState after unmount when the poll
  // resolves late.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await API.get('/api/citadel-license/status');
      if (!mountedRef.current) return;
      // Endpoint requires `license.manage` permission — the backend returns
      // 403 for users without it. Treat that as "no info" rather than error.
      if (res?.error === 'Insufficient permissions') {
        setState({
          loading: false, error: null,
          status: 'hidden', subscription: null, cloudSubscription: null,
          claims: null, entitlements: [],
          lastVerifiedAt: null, isUsable: false, hasCloud: false,
        });
        return;
      }
      const entitlements = Array.isArray(res?.entitlements) ? res.entitlements : [];
      setState({
        loading: false,
        error: null,
        status: res?.status ?? null,
        subscription: res?.subscription ?? null,
        cloudSubscription: res?.cloudSubscription ?? null,
        claims: res?.claims ?? null,
        entitlements,
        lastVerifiedAt: res?.lastVerifiedAt ?? null,
        isUsable: deriveIsUsable(res?.status),
        hasCloud: Boolean(res?.hasCloud) || entitlements.includes('cloud'),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || String(err),
        // Don't reset isUsable/hasCloud on transient network errors — keep
        // the last known good state so a paywall doesn't flash on a flaky
        // connection.
      }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(() => { refresh(); }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  // Stable function reference for hasFeature() — avoids re-renders on every
  // call while still reading from the latest state.
  const hasFeature = useCallback(
    (feature) => deriveHasFeature(state.status, state.entitlements, feature),
    [state.status, state.entitlements],
  );

  return { ...state, refresh, hasFeature };
}

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postJson } from '../lib/api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const navigate = useNavigate();
  const [resetTarget, setResetTarget] = useState(null); // {owner, name} | null
  const [remergeInQa, setRemergeInQa] = useState(true);
  const [toast, setToast] = useState('');
  const [resetting, setResetting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedTicketKey, setSelectedTicketKey] = useState(null);
  const toastTimer = useRef(null);
  const refreshers = useRef(new Set());
  const healthRefreshRef = useRef(null);

  const openTicket = useCallback((key) => setSelectedTicketKey(key), []);
  const closeTicket = useCallback(() => setSelectedTicketKey(null), []);

  const registerRefresh = useCallback((fn) => {
    if (!fn) return () => {};
    refreshers.current.add(fn);
    return () => refreshers.current.delete(fn);
  }, []);

  const runPageRefresh = useCallback(() => {
    for (const fn of refreshers.current) fn();
  }, []);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await postJson('/sync', {});
    } catch (err) {
      showToast(`Sync failed: ${err.message}`);
    } finally {
      runPageRefresh();
      healthRefreshRef.current?.();
      setSyncing(false);
    }
  }, [runPageRefresh, showToast]);

  // Hard refresh / first load: pull Jira into the local DB immediately
  // instead of waiting up to POLL_INTERVAL_MS for the timer.
  useEffect(() => {
    syncNow();
  }, [syncNow]);

  // Separate from registerRefresh/syncNow (the per-page "Sync now" target):
  // AppShell's sidebar (watched-repo list, lock state) is always mounted
  // and polls on its own 15s timer, so connecting/removing/editing a repo
  // elsewhere would otherwise sit stale for up to that long. Pages that
  // mutate repos call refreshHealth() right after so the sidebar catches
  // up immediately instead of needing a manual reload.
  const registerHealthRefresh = useCallback((fn) => {
    healthRefreshRef.current = fn;
  }, []);

  const refreshHealth = useCallback(() => {
    healthRefreshRef.current?.();
  }, []);

  const openReset = useCallback((repo) => setResetTarget(repo), []);
  const closeReset = useCallback(() => setResetTarget(null), []);
  const toggleRemerge = useCallback(() => setRemergeInQa((v) => !v), []);

  const confirmReset = useCallback(async () => {
    if (!resetTarget) return undefined;
    setResetting(true);
    try {
      const result = await postJson('/staging/reset', { ...resetTarget, remergeInQa });
      setResetTarget(null);
      const remergedCount = result.remerge?.results?.length || 0;
      const repoLabel = `${resetTarget.owner}/${resetTarget.name}`;
      showToast(
        remergeInQa && remergedCount
          ? `${repoLabel}: staging reset to develop. Re-merged ${remergedCount} ticket${remergedCount === 1 ? '' : 's'} in QA.`
          : `${repoLabel}: staging reset to develop ${result.newHeadSha ? result.newHeadSha.slice(0, 7) : ''}.`
      );
      navigate('/staging');
      runPageRefresh();
      return result;
    } catch (err) {
      // Not rethrown: confirmReset is wired directly to a button's onClick
      // (nothing awaits or catches its promise), and the toast above is
      // the only surface the user needs — an uncaught rejection here would
      // just be console noise.
      showToast(`Reset failed: ${err.message}`);
      return undefined;
    } finally {
      setResetting(false);
    }
  }, [resetTarget, remergeInQa, navigate, showToast, runPageRefresh]);

  const value = {
    resetTarget,
    openReset,
    closeReset,
    remergeInQa,
    toggleRemerge,
    confirmReset,
    resetting,
    toast,
    registerRefresh,
    syncNow,
    syncing,
    registerHealthRefresh,
    refreshHealth,
    selectedTicketKey,
    openTicket,
    closeTicket,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

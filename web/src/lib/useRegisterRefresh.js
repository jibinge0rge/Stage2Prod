import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

/**
 * Registers a page's data-refresh function as the target of the shared
 * "Sync now" header button, for as long as that page is mounted.
 */
export function useRegisterRefresh(refreshFn) {
  const { registerRefresh } = useAppContext();
  useEffect(() => {
    registerRefresh(refreshFn);
    return () => registerRefresh(null);
  }, [refreshFn, registerRefresh]);
}

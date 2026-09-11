import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

/**
 * Registers a page's data-refresh function as a target of the shared
 * "Sync now" header button, for as long as that page is mounted.
 * Several surfaces can register at once (pipeline table + ticket drawer).
 */
export function useRegisterRefresh(refreshFn) {
  const { registerRefresh } = useAppContext();
  useEffect(() => registerRefresh(refreshFn), [refreshFn, registerRefresh]);
}

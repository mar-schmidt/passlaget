import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../client';
import type { InventoryMatch } from '../domain/model';

interface Profile {
  clubId: number;
  clubName: string;
  groupId: number;
  memberId: number;
  groupName?: string;
}
export interface Integration {
  connected: boolean;
  selected?: Profile;
  profiles: Profile[];
  activities: { id: number; title: string; startsAt: string }[];
  players: { id: number; name: string; birthYear: string }[];
  mapping: Record<string, number>;
  links: Record<string, number>;
  lastSyncAt?: string;
  error?: string;
  rosterStatus?: string;
  inventoryEnabled?: boolean;
  rosterError?: string;
  inventoryConflicts?: InventoryMatch[];
  inventory?: {
    checkedAt: string;
    groupName: string;
    active: number;
    departed: number;
    missingEmail: number;
  };
}
export function useSportAdmin(refresh: () => Promise<void>, version?: number) {
  const [data, setData] = useState<Integration>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestSequence = useRef(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const act = useCallback(async (operation: string, values: Record<string, unknown> = {}) => {
    const request = ++requestSequence.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ integration: Integration }>({
        action: 'sportadmin',
        operation,
        ...values,
      });
      if (request === requestSequence.current) setData(result.integration);
      await refreshRef.current();
      setNotice(
        result.integration.rosterError || result.integration.error || 'Uppgifterna är uppdaterade.',
      );
      return !result.integration.rosterError && !result.integration.error;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (isDemo) return;
    let current = true;
    const request = ++requestSequence.current;
    void api<{ integration: Integration }>({ action: 'sportadmin', operation: 'status' })
      .then((result) => {
        if (current && request === requestSequence.current) {
          setData(result.integration);
          setError('');
        }
      })
      .catch((e: Error) => {
        if (current && request === requestSequence.current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [version]);
  return { data, busy, error, notice, act };
}

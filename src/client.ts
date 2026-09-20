import { createClient } from '@supabase/supabase-js';
import { applyCommand, publicState } from './domain/logic';
import { demoState } from './domain/demo';
import type { PortalCommand, PortalState } from './domain/model';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const isDemo = !url || !key;
export const mailEnabled = isDemo || import.meta.env.VITE_MAIL_ENABLED === 'true';
export const supabase = !isDemo
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
const storageKey = 'passlaget-demo-v1';
const teamSlug = import.meta.env.VITE_TEAM_SLUG || 'landvetter-p2018';
const demoRead = (): PortalState => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const value = JSON.parse(saved);
      if (value.team && Array.isArray(value.events)) return value;
    }
  } catch {
    /* use a fresh demo when browser storage is unavailable */
  }
  return demoState();
};
export const resetDemo = () => localStorage.removeItem(storageKey);
function fullShape(value: PortalState): PortalState {
  return {
    ...value,
    history: value.history || [],
    audit: value.audit || [],
    requests: value.requests || [],
  };
}
export async function api<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Den här åtgärden behöver en ansluten server.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch(`${url}/functions/v1/portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key!,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ teamSlug, ...body }),
  });
  const result = await response.json().catch(() => ({ error: 'Servern kunde inte svara.' }));
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? 'Schemat har ändrats. Hämta den senaste versionen och försök igen.'
        : result.error || 'Åtgärden kunde inte sparas. Försök igen.',
    );
  return result;
}
export async function readPortal(admin = false): Promise<PortalState> {
  if (isDemo) {
    const state = demoRead();
    return fullShape(admin ? state : (publicState(state) as PortalState));
  }
  const result = await api<{ state: PortalState }>({ action: 'read', admin });
  return fullShape(result.state);
}
export async function runCommand(
  command: PortalCommand,
  expectedVersion: number,
  admin: boolean,
): Promise<PortalState> {
  if (isDemo) {
    const original = demoRead();
    if (original.version !== expectedVersion)
      throw new Error('Demot har ändrats i en annan flik. Uppdatera sidan.');
    const next = applyCommand(original, command, admin ? 'admin' : 'public');
    localStorage.setItem(storageKey, JSON.stringify(next));
    return fullShape(admin ? next : (publicState(next) as PortalState));
  }
  const result = await api<{ state: PortalState }>({ action: 'command', expectedVersion, command });
  return fullShape(result.state);
}
export interface MailStatus {
  enabled: boolean;
  counts: Record<string, number>;
  lastWorkerAt: string | null;
  lastSentAt: string | null;
  messages: {
    id: string;
    kind: string;
    status: string;
    to: string;
    subject: string;
    createdAt: string;
    sentAt?: string;
    error?: string;
  }[];
}
export async function mailStatus(): Promise<MailStatus> {
  if (isDemo)
    return {
      enabled: true,
      counts: { queued: 0, leased: 0, sent: 0, failed: 0, uncertain: 0, suppressed: 0 },
      lastWorkerAt: null,
      lastSentAt: null,
      messages: [],
    };
  return api<MailStatus>({ action: 'mail_status' });
}

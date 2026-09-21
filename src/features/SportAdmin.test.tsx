// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { demoState } from '../domain/demo';
import SportAdminPanel from './SportAdmin';
const api = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ api, isDemo: false }));
afterEach(() => {
  cleanup();
  api.mockReset();
});
test('connection page keeps roster tools and explains that events are linked in the editor', async () => {
  const s = demoState();
  const integration = {
    connected: true,
    selected: { clubId: 1, clubName: 'Testklubb', groupId: 2, memberId: 3 },
    profiles: [],
    players: [],
    activities: [{ id: 7, title: 'Testmatch', startsAt: '2030-10-23T09:00:00Z' }],
    mapping: {},
    links: {},
    rosterStatus: 'leader_required',
  };
  api.mockResolvedValue({ integration });
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<SportAdminPanel state={s} refresh={refresh} />);
  await screen.findByRole('heading', { name: 'Kopplade evenemang' });
  expect(screen.queryByLabelText('Evenemang i Passlaget')).toBeNull();
  expect(screen.getByText(/när du skapar eller redigerar evenemanget/)).toBeTruthy();
  expect(screen.getByText(/väntar på ledarbehörighet/)).toBeTruthy();
});
test('connection form clears password after submit', async () => {
  api.mockResolvedValue({
    integration: {
      connected: false,
      profiles: [],
      activities: [],
      players: [],
      mapping: {},
      links: {},
    },
  });
  render(<SportAdminPanel state={demoState()} refresh={async () => {}} />);
  await screen.findByRole('heading', { name: 'Anslut ditt konto' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Mejladress'), 'admin@example.test');
  await user.type(screen.getByLabelText('Lösenord till SportAdmin'), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Anslut SportAdmin' }));
  expect((screen.getByLabelText('Lösenord till SportAdmin') as HTMLInputElement).value).toBe('');
});

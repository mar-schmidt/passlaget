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
  expect(screen.getByRole('heading', { name: 'Spelarinventeringen' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Aktivera Spelarinventeringen' })).toBeTruthy();
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

test('inventory searches players, shows source and departed status, and opens the correct family', async () => {
  const s = demoState();
  s.children[0].source = 'sportadmin';
  s.children[0].active = false;
  s.children[1].source = 'manual';
  api.mockResolvedValue({
    integration: {
      connected: true,
      selected: { clubId: 1, clubName: 'Test', groupId: 2, memberId: 3 },
      profiles: [],
      activities: [],
      players: [],
      mapping: {},
      links: {},
      inventoryEnabled: true,
      inventory: {
        checkedAt: '2026-09-22T10:00:00Z',
        groupName: 'P2018',
        active: 1,
        departed: 1,
        missingEmail: 0,
      },
    },
  });
  const onEditFamily = vi.fn();
  render(<SportAdminPanel state={s} refresh={async () => {}} onEditFamily={onEditFamily} />);
  await screen.findByRole('heading', { name: 'Spelarinventeringen' });
  const user = userEvent.setup();
  expect(screen.queryByText(s.children[0].name)).toBeNull();
  await user.click(screen.getByLabelText('Visa även slutade spelare'));
  await user.type(screen.getByLabelText('Sök spelare'), s.children[0].name);
  expect(screen.getByText('Slutat')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: `Visa familjen för ${s.children[0].name}` }));
  expect(onEditFamily).toHaveBeenCalledWith(s.children[0].familyId);
  await user.click(screen.getByRole('button', { name: 'Lägg till manuell spelare' }));
  expect(onEditFamily).toHaveBeenLastCalledWith();
});

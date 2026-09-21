// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
test('admin links a saved event to a selected SportAdmin activity', async () => {
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
  await screen.findByRole('heading', { name: '2. Koppla evenemang' });
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Evenemang i Passlaget'), s.events[0].id);
  await user.selectOptions(screen.getByLabelText('Aktivitet i SportAdmin'), '7');
  await user.click(screen.getByRole('button', { name: 'Spara koppling' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith({
      action: 'sportadmin',
      operation: 'link',
      eventId: s.events[0].id,
      activityId: 7,
    }),
  );
  expect(refresh).toHaveBeenCalled();
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

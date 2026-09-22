// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import Admin from './Admin';
import PlayerSync from './PlayerSync';
import { demoState } from '../domain/demo';
import type { Integration } from './useSportAdmin';
const api = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ api, isDemo: false, mailEnabled: false, mailStatus: vi.fn() }));
afterEach(() => {
  cleanup();
  api.mockReset();
});
function fixture() {
  const state = demoState();
  state.children.forEach((c) => {
    c.source = 'sportadmin';
  });
  state.adults.forEach((a) => {
    a.source = 'sportadmin';
  });
  state.children[0].source = 'manual';
  state.families[0].exempt = true;
  const integration: Integration = {
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
      active: 12,
      departed: 1,
      missingEmail: 0,
    },
    inventoryConflicts: [],
  };
  api.mockResolvedValue({ integration });
  return { state, integration };
}
test('single directory searches parents and displays independent membership, source and exemption statuses', async () => {
  const { state } = fixture();
  render(
    <Admin state={state} page="familjer" mutate={vi.fn()} tell={vi.fn()} navigate={vi.fn()} />,
  );
  await screen.findByText(/Senaste synkning:/);
  const row = screen.getByRole('row', { name: new RegExp(state.children[0].name) });
  expect(within(row).getByText('MANUELL')).toBeTruthy();
  expect(within(row).getByText('SYNKAD')).toBeTruthy();
  expect(within(row).getAllByText('AKTIV')).toHaveLength(2);
  expect(within(row).getAllByText('UNDANTAGEN')).toHaveLength(2);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Sök barn eller förälder'), state.adults[0].name);
  expect(screen.getByText(state.children[0].name)).toBeTruthy();
  expect(screen.queryByText(state.children[3].name)).toBeNull();
});
test('synced player and guardian details are read-only while family exemption and availability remain editable', async () => {
  const { state } = fixture();
  const family = state.families[1];
  const child = state.children.find((c) => c.familyId === family.id)!;
  const mutate = vi.fn().mockResolvedValue(state);
  render(<Admin state={state} page="familjer" mutate={mutate} tell={vi.fn()} navigate={vi.fn()} />);
  await screen.findByText(/Senaste synkning:/);
  const row = screen.getByRole('row', { name: new RegExp(child.name) });
  expect(within(row).queryByRole('button', { name: 'Redigera' })).toBeNull();
  const user = userEvent.setup();
  await user.click(within(row).getByRole('button', { name: 'Visa & bemanning' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('textbox', { name: 'Namn' })).toBeNull();
  expect(within(dialog).queryByRole('textbox', { name: 'Mejladress' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Lägg till barn' })).toBeNull();
  await user.click(within(dialog).getByLabelText(/Undanta familjen/));
  await user.click(within(dialog).getByText('Perioder då familjen inte kan delta'));
  await user.click(within(dialog).getByRole('button', { name: 'Lägg till period' }));
  await user.click(within(dialog).getByRole('button', { name: 'Spara bemanning' }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'save_family',
      family: expect.objectContaining({ exempt: !family.exempt, unavailable: expect.any(Array) }),
    }),
    state.version,
  );
});
test('manual player remains editable in a mixed sibling family', async () => {
  const { state } = fixture();
  const mutate = vi.fn().mockResolvedValue(state);
  render(<Admin state={state} page="familjer" mutate={mutate} tell={vi.fn()} navigate={vi.fn()} />);
  await screen.findByText(/Senaste synkning:/);
  const row = screen.getByRole('row', { name: new RegExp(state.children[0].name) });
  const user = userEvent.setup();
  await user.click(within(row).getByRole('button', { name: 'Redigera' }));
  const dialog = screen.getByRole('dialog');
  const name = within(dialog).getByRole('textbox', { name: 'Namn' });
  await user.clear(name);
  await user.type(name, 'Mina Nyttnamn');
  await user.click(within(dialog).getByRole('button', { name: 'Spara familj' }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      children: expect.arrayContaining([
        expect.objectContaining({ id: state.children[0].id, name: 'Mina Nyttnamn' }),
        state.children[1],
      ]),
    }),
    state.version,
  );
});
for (const [label, resolution] of [
  ['Ändra till synkad', 'sync'],
  ['Inte samma person', 'different'],
]) {
  test(`identity review shows both contacts and sends an explicit ${resolution} decision`, async () => {
    const { state, integration } = fixture();
    const child = state.children[0];
    integration.inventoryConflicts = [
      {
        childId: child.id,
        memberId: 99,
        name: child.name,
        active: true,
        guardians: [
          { name: 'Registerförälder', phone: '0701234567', email: 'parent@example.test' },
        ],
      },
    ];
    api.mockImplementation(async (body) => ({
      integration:
        body.operation === 'resolve_inventory_match'
          ? { ...integration, inventoryConflicts: [] }
          : integration,
    }));
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<PlayerSync state={state} refresh={refresh} onOpenConnection={vi.fn()} />);
    const match = await screen.findByRole('article', { name: `Matchning för ${child.name}` });
    expect(within(match).getByText(/Registerförälder/)).toBeTruthy();
    expect(within(match).getByText(state.adults[0].name, { exact: false })).toBeTruthy();
    expect(within(match).queryByRole('button', { name: 'Behåll manuell' })).toBeNull();
    await userEvent.setup().click(within(match).getByRole('button', { name: label }));
    expect(api).toHaveBeenCalledWith({
      action: 'sportadmin',
      operation: 'resolve_inventory_match',
      childId: child.id,
      memberId: 99,
      resolution,
      expectedVersion: state.version,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('article')).toBeNull();
  });
}

test('status filters combine with parent search per player, including mixed siblings, departed players and reset', async () => {
  const { state } = fixture();
  const [manual, syncedSibling] = state.children;
  delete manual.source; // Older local players are also manual in the directory.
  syncedSibling.active = false;
  render(
    <Admin state={state} page="familjer" mutate={vi.fn()} tell={vi.fn()} navigate={vi.fn()} />,
  );
  await screen.findByText(/Senaste synkning:/);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Sök barn eller förälder'), state.adults[0].name);
  await user.selectOptions(screen.getByLabelText('Registerstatus'), 'manual');
  await user.selectOptions(screen.getByLabelText('Bemanning'), 'exempt');
  expect(screen.getByText(manual.name)).toBeTruthy();
  expect(screen.queryByText(syncedSibling.name)).toBeNull();
  expect(screen.getByText(`Visar 1 av ${state.children.length} spelare.`)).toBeTruthy();

  await user.selectOptions(screen.getByLabelText('I laget'), 'inactive');
  expect(screen.getByText('Inga spelare matchar filtren')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Registerstatus'), 'sportadmin');
  expect(screen.getByText(syncedSibling.name)).toBeTruthy();
  expect(screen.queryByText(manual.name)).toBeNull();
  expect(screen.getByText('AVSLUTAD')).toBeTruthy();

  await user.selectOptions(screen.getByLabelText('Bemanning'), 'included');
  expect(screen.getByText('Inga spelare matchar filtren')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Bemanning'), 'all');
  await user.selectOptions(screen.getByLabelText('I laget'), 'all');
  await user.selectOptions(screen.getByLabelText('Registerstatus'), 'all');
  expect(screen.getByText(manual.name)).toBeTruthy();
  expect(screen.getByText(syncedSibling.name)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Återställ filter' }));
  expect((screen.getByLabelText('Sök barn eller förälder') as HTMLInputElement).value).toBe('');
  expect(screen.getByText(manual.name)).toBeTruthy();
  expect(screen.queryByText(syncedSibling.name)).toBeNull();
  expect(screen.getByText(state.children[3].name)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Återställ filter' })).toBeNull();
});

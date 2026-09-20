// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PortalCommand, PortalState } from '../domain/model';
import { applyCommand, publicState } from '../domain/logic';
import App from '../App';
import Admin from '../features/Admin';
import Parents from '../features/Parents';

const client = vi.hoisted(() => ({
  readPortal: vi.fn(),
  runCommand: vi.fn(),
  api: vi.fn(),
  mailStatus: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../client', () => ({
  isDemo: false,
  readPortal: client.readPortal,
  runCommand: client.runCommand,
  api: client.api,
  mailStatus: client.mailStatus,
  resetDemo: vi.fn(),
  supabase: {
    auth: {
      getSession: client.getSession,
      onAuthStateChange: client.onAuthStateChange,
      signOut: client.signOut,
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

// Synthetic, deliberately small data. No names or contacts from the imported PDF.
function fixture(): PortalState {
  const details = {
    title: 'Öppet testsammandrag',
    location: 'Testplanen',
    startDate: '2030-06-15',
    endDate: '2030-06-15',
    description: 'Samling vid klubbhuset.',
    shifts: [
      {
        id: 'shift-one',
        roleId: 'parking',
        roleName: 'Parkeringsvärd',
        instructions: 'Håll infarten fri.',
        startsAt: '2030-06-15T11:00:00+02:00',
        endsAt: '2030-06-15T13:00:00+02:00',
        slots: [
          {
            id: 'slot-one',
            familyId: 'family-one',
            locked: false,
            revision: 1,
            status: 'pending' as const,
          },
        ],
      },
    ],
  };
  return {
    version: 1,
    team: {
      id: 'team-test',
      slug: 'team-test',
      name: 'Testlaget',
      clubName: 'Testföreningen',
      contactName: 'Testansvarig',
      contactPhone: '0700000099',
      reminderDays: [1],
    },
    families: [
      { id: 'family-one', label: 'Testfamilj ett', active: true, exempt: false },
      { id: 'family-two', label: 'Testfamilj två', active: true, exempt: false },
    ],
    children: [
      { id: 'child-one', name: 'Testbarn Ett', familyId: 'family-one', active: true },
      { id: 'child-two', name: 'Testbarn Två', familyId: 'family-two', active: true },
    ],
    adults: [
      {
        id: 'adult-one',
        name: 'Testvuxen Ett',
        phone: '0700000001',
        familyIds: ['family-one'],
        active: true,
      },
      {
        id: 'adult-two',
        name: 'Testvuxen Två',
        phone: '0700000002',
        familyIds: ['family-one'],
        active: true,
      },
    ],
    roles: [{ id: 'parking', name: 'Parkeringsvärd', instructions: 'Håll infarten fri.' }],
    events: [
      {
        id: 'event-one',
        draft: structuredClone(details),
        published: structuredClone(details),
        publication: 1,
        cancelled: false,
        updatedAt: '2030-01-01T10:00:00Z',
      },
      {
        id: 'private-event',
        draft: {
          ...structuredClone(details),
          title: 'Privat planeringsutkast',
          description: 'Privat arbetsanteckning',
          shifts: [],
        },
        publication: 0,
        cancelled: false,
        updatedAt: '2030-01-01T10:00:00Z',
      },
    ],
    history: [
      {
        id: 'history-one',
        familyId: 'family-one',
        assignmentId: 'historical-slot',
        eventTitle: 'Tidigare testcup',
        roleName: 'Parkeringsvärd',
        startsAt: '2025-06-15T11:00:00+02:00',
        endsAt: '2025-06-15T13:00:00+02:00',
        source: 'import',
        verified: true,
      },
    ],
    requests: [],
    audit: [],
  };
}
function projected(state: PortalState): PortalState {
  return { ...publicState(state), history: [], audit: [], requests: [] };
}

let server: PortalState;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  history.replaceState(null, '', '/');
  server = fixture();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  client.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session' } } });
  client.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  client.readPortal.mockImplementation(async (admin = false) =>
    structuredClone(admin ? server : projected(server)),
  );
  client.runCommand.mockImplementation(async (command: PortalCommand, version: number) => {
    if (version !== server.version) throw new Error('Testserver: versionskonflikt');
    const isPublic = command.type === 'confirm' || command.type === 'request_change';
    server = applyCommand(server, command, isPublic ? 'public' : 'admin');
    // Match the real backend contract even if a session is present.
    return structuredClone(isPublic ? projected(server) : server);
  });
  client.mailStatus.mockResolvedValue({
    counts: {},
    lastWorkerAt: null,
    lastSentAt: null,
    messages: [],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('planning forms', () => {
  it('keeps the new event title field and keyboard focus for the entire name', async () => {
    const user = userEvent.setup({ delay: 2 });
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    render(
      <Admin state={server} page="oversikt" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Nytt evenemang' }));
    const dialog = screen.getByRole('dialog', { name: 'Nytt evenemang' });
    const title = within(dialog).getByRole('textbox', {
      name: 'Evenemangets namn',
    }) as HTMLInputElement;
    await user.type(title, 'Cup för hela laget');
    expect(title.value).toBe('Cup för hela laget');
    expect(document.activeElement).toBe(title);
    expect(within(dialog).getByRole('textbox', { name: 'Evenemangets namn' })).toBe(title);
    await user.click(within(dialog).getByRole('button', { name: 'Spara utkast' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: 'save_event',
      event: { draft: { title: 'Cup för hela laget' } },
    });
  });

  it('does not move focus to Close while typing a custom role', async () => {
    const user = userEvent.setup({ delay: 2 });
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    render(
      <Admin state={server} page="evenemang" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Eget uppdrag' }));
    const dialog = screen.getByRole('dialog', { name: 'Skapa eget uppdrag' });
    const input = within(dialog).getByRole('textbox', {
      name: 'Namn på uppdrag',
    }) as HTMLInputElement;
    await user.type(input, 'Pumpaverkstad och pyssel');
    expect(input.value).toBe('Pumpaverkstad och pyssel');
    expect(document.activeElement).toBe(input);
    await user.click(within(dialog).getByRole('button', { name: 'Spara uppdrag' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: 'save_role',
      role: { name: 'Pumpaverkstad och pyssel' },
    });
  });

  it('rejects a stale editor if another loaded state changed after opening it', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    const props = { page: 'evenemang' as const, navigate: vi.fn(), mutate, tell: vi.fn() };
    const view = render(<Admin state={server} {...props} />);
    const article = screen
      .getByRole('heading', { name: 'Öppet testsammandrag' })
      .closest('article')!;
    await user.click(within(article).getByRole('button', { name: 'Öppna planering' }));
    const title = screen.getByRole('textbox', { name: 'Evenemangets namn' });
    await user.clear(title);
    await user.type(title, 'Min lokala ändring');
    const fresh = structuredClone(server);
    fresh.version += 1;
    fresh.events[0].draft.title = 'Någon annans sparade ändring';
    view.rerender(<Admin state={fresh} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Spara utkast' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/ändrat|ändrats|öppna|senaste/i),
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('disables editing until an in-flight save finishes', async () => {
    const user = userEvent.setup();
    let resolveSave!: (state: PortalState) => void;
    let savedCommand: PortalCommand;
    const mutate = vi.fn((command: PortalCommand) => {
      savedCommand = command;
      return new Promise<PortalState>((resolve) => {
        resolveSave = resolve;
      });
    });
    render(
      <Admin state={server} page="oversikt" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Nytt evenemang' }));
    const title = screen.getByRole('textbox', { name: 'Evenemangets namn' }) as HTMLInputElement;
    await user.type(title, 'Långsamt sparat schema');
    await user.click(screen.getByRole('button', { name: 'Spara utkast' }));
    expect(title.matches(':disabled')).toBe(true);
    await act(async () => resolveSave(applyCommand(server, savedCommand, 'admin')));
    await waitFor(() => expect(title.matches(':disabled')).toBe(false));
    expect(title.value).toBe('Långsamt sparat schema');
  });
});

describe('parent actions', () => {
  it('keeps a previously entered free adult unlinked when confirming again', async () => {
    const user = userEvent.setup();
    const slot = server.events[0].published!.shifts[0].slots[0];
    Object.assign(slot, {
      status: 'confirmed',
      adultName: 'Annan Testvuxen',
      adultPhone: '0700000088',
      confirmedRevision: 1,
    });
    delete slot.adultId;
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'public'));
    render(
      <Parents
        state={server}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={mutate}
        tell={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Visa / ändra ansvarig' }));
    const dialog = screen.getByRole('dialog');
    expect(
      (within(dialog).getByRole('combobox', { name: 'Vem kommer?' }) as HTMLSelectElement).value,
    ).toBe('');
    expect((within(dialog).getByRole('textbox', { name: 'Namn' }) as HTMLInputElement).value).toBe(
      'Annan Testvuxen',
    );
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: 'confirm',
      adultId: undefined,
      adultName: 'Annan Testvuxen',
      adultPhone: '0700000088',
    });
  });

  it('refuses calendar export after the pass has been assigned to another family', async () => {
    const user = userEvent.setup();
    const old = structuredClone(server);
    server.events[0].published!.shifts[0].slots[0].familyId = 'family-two';
    const tell = vi.fn();
    render(
      <Parents
        state={old}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={vi.fn()}
        tell={tell}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Lägg till i kalender' }));
    await waitFor(() =>
      expect(tell).toHaveBeenCalledWith(expect.stringMatching(/inte längre aktuellt/i), true),
    );
    expect(screen.queryByRole('dialog', { name: 'Lägg till i kalender' })).toBeNull();
  });
});

describe('administration across public actions', () => {
  it('reloads full admin data after a public confirmation instead of losing private drafts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lagets bemanning' });
    await user.click(screen.getByRole('button', { name: 'Administration' }));
    await screen.findByRole('heading', { name: 'En insats för laget.' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Privat planeringsutkast' })).toBeTruthy(),
    );
    await user.click(screen.getByRole('button', { name: 'Föräldrasida' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Välj barn eller familj' }),
      'family-one',
    );
    const readsBefore = client.readPortal.mock.calls.filter((args) => args[0] === true).length;
    await user.click(screen.getByRole('button', { name: 'Bekräfta passet' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.runCommand).toHaveBeenCalledTimes(1);
    expect(client.readPortal.mock.calls.filter((args) => args[0] === true).length).toBeGreaterThan(
      readsBefore,
    );
    await user.click(screen.getByRole('button', { name: 'Evenemang' }));
    expect(screen.getByRole('heading', { name: 'Privat planeringsutkast' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rättvis fördelning' }));
    const historicalStat = screen.getByText('Genomförda pass').closest('.stat-card')!;
    expect(within(historicalStat as HTMLElement).getByText('1')).toBeTruthy();
  });
});

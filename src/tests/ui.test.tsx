// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PortalCommand, PortalEvent, PortalState } from '../domain/model';
import { applyCommand, publicState } from '../domain/logic';
import App from '../App';
import Admin from '../features/Admin';
import Parents from '../features/Parents';

const client = vi.hoisted(() => ({
  mailEnabled: true,
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
  get mailEnabled() {
    return client.mailEnabled;
  },
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

function publishedEvent(
  id: string,
  title: string,
  date: string,
  familyId = 'family-one',
): PortalEvent {
  const event = structuredClone(fixture().events[0]);
  event.id = id;
  const details = event.published!;
  details.title = title;
  details.startDate = date;
  details.endDate = date;
  details.shifts[0].id = `${id}-shift`;
  details.shifts[0].startsAt = `${date}T11:00:00+02:00`;
  details.shifts[0].endsAt = `${date}T13:00:00+02:00`;
  details.shifts[0].slots[0].id = `${id}-slot`;
  details.shifts[0].slots[0].familyId = familyId;
  event.draft = structuredClone(details);
  return event;
}

let server: PortalState;
beforeEach(() => {
  vi.clearAllMocks();
  client.api.mockReset().mockResolvedValue({
    integration: {
      connected: false,
      profiles: [],
      activities: [],
      players: [],
      mapping: {},
      links: {},
    },
  });
  // Keep fixture passes upcoming even when this suite runs in a later calendar year.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-06-01T12:00:00Z'));
  localStorage.clear();
  history.replaceState(null, '', '/');
  server = fixture();
  client.mailEnabled = true;
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
    enabled: true,
    counts: {},
    lastWorkerAt: null,
    lastSentAt: null,
    messages: [],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mejladress' }),
      'parent@example.test',
    );
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

describe('matchday parent view', () => {
  it('opens the shared schedule without a family and offers one way back to family selection', async () => {
    const user = userEvent.setup();
    render(
      <Parents state={server} familyId="" setFamilyId={vi.fn()} mutate={vi.fn()} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Visa hela schemat' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Öppet testsammandrag');
    expect(screen.getByRole('region', { name: 'Dagens bemanning' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Familjens uppdrag' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bekräfta passet' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Välj familj' }));
    expect(screen.getByRole('searchbox', { name: 'Sök barn eller familj' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Välj barn eller familj' })).toBeNull();
  });

  it('opens the next family assignment ahead of earlier team events and old family passes', () => {
    const past = publishedEvent('past', 'Familjens gamla cup', '2030-05-01');
    const otherFamily = publishedEvent(
      'other-family',
      'Lagets tidigare sammandrag',
      '2030-06-05',
      'family-two',
    );
    const later = publishedEvent('later', 'Familjens senare cup', '2030-07-01');
    const cancelled = publishedEvent('cancelled', 'Inställd cup', '2030-06-02');
    cancelled.cancelled = true;
    server.events.push(later, past, otherFamily, cancelled);
    render(
      <Parents
        state={server}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={vi.fn()}
        tell={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Öppet testsammandrag');
    const own = screen.getByRole('region', { name: 'Familjens uppdrag' });
    expect(within(own).getByRole('button', { name: 'Bekräfta passet' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Privat planeringsutkast/ })).toBeNull();
    expect(screen.queryByText('Privat arbetsanteckning')).toBeNull();
  });

  it('finds a sibling through one family choice and keeps every assigned slot actionable', async () => {
    const user = userEvent.setup();
    server.children.push({
      id: 'sibling',
      name: 'Testsyskon',
      familyId: 'family-one',
      active: true,
    });
    const secondShift = structuredClone(server.events[0].published!.shifts[0]);
    secondShift.id = 'shift-two';
    secondShift.roleName = 'Löpare';
    secondShift.startsAt = '2030-06-15T13:00:00+02:00';
    secondShift.endsAt = '2030-06-15T15:00:00+02:00';
    secondShift.slots[0].id = 'slot-two';
    server.events[0].published!.shifts.push(secondShift);
    const setFamilyId = vi.fn();
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'public'));
    const props = { state: server, setFamilyId, mutate, tell: vi.fn() };
    const view = render(<Parents {...props} familyId="" />);
    await user.type(screen.getByRole('searchbox', { name: 'Sök barn eller familj' }), 'Testsyskon');
    expect(screen.queryByRole('combobox', { name: 'Välj barn eller familj' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Testbarn Ett & Testsyskon' }));
    expect(setFamilyId).toHaveBeenCalledWith('family-one');
    view.rerender(<Parents {...props} familyId="family-one" />);
    const own = screen.getByRole('region', { name: 'Familjens uppdrag' });
    expect(within(own).getAllByRole('button', { name: 'Bekräfta passet' })).toHaveLength(2);
    for (const index of [0, 1]) {
      await user.click(within(own).getAllByRole('button', { name: 'Bekräfta passet' })[index]);
      const dialog = screen.getByRole('dialog', { name: 'Bekräfta familjens pass' });
      await user.selectOptions(
        within(dialog).getByRole('combobox', { name: 'Vem kommer?' }),
        index ? 'adult-two' : 'adult-one',
      );
      await user.click(within(dialog).getByRole('checkbox'));
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Mejladress' }),
        'parent@example.test',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(mutate.mock.calls.map(([command]) => command)).toEqual([
      expect.objectContaining({
        type: 'confirm',
        familyId: 'family-one',
        slotId: 'slot-one',
        adultId: 'adult-one',
      }),
      expect.objectContaining({
        type: 'confirm',
        familyId: 'family-one',
        slotId: 'slot-two',
        adultId: 'adult-two',
      }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Byt spelare' }));
    expect(screen.getByRole('searchbox', { name: 'Sök barn eller familj' })).toBeTruthy();
  });

  it('switches events without losing custom roles, external teams, instructions or phone contacts', async () => {
    const user = userEvent.setup();
    const halloween = publishedEvent('halloween', 'Halloween med laget', '2030-10-31');
    const ownShift = halloween.published!.shifts[0];
    ownShift.roleId = 'pumpkins';
    ownShift.roleName = 'Pumpaverkstad';
    ownShift.instructions = 'Hjälp barnen med pyntet.';
    const contactShift = structuredClone(ownShift);
    contactShift.id = 'halloween-contact';
    contactShift.roleName = 'Entrévärd';
    contactShift.slots[0] = {
      ...contactShift.slots[0],
      id: 'contact-slot',
      familyId: 'family-two',
      status: 'confirmed',
      adultName: 'Kontakt Testvuxen',
      adultPhone: '+46 70 000 00 77',
    };
    halloween.published!.shifts.push(contactShift, {
      ...structuredClone(ownShift),
      id: 'external-kiosk',
      roleName: 'Kiosk',
      externalTeam: 'Grannlaget P2019',
      slots: [],
    });
    server.events.push(halloween);
    render(
      <Parents
        state={server}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={vi.fn()}
        tell={vi.fn()}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Evenemang' }), 'halloween');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Halloween med laget');
    const own = screen.getByRole('region', { name: 'Familjens uppdrag' });
    expect(within(own).getByRole('heading', { name: 'Pumpaverkstad' })).toBeTruthy();
    expect(within(own).getByRole('button', { name: 'Bekräfta passet' })).toBeTruthy();
    const roster = screen.getByRole('region', { name: 'Dagens bemanning' });
    expect(within(roster).getByText('Grannlaget P2019').closest('p')?.textContent).toBe(
      'Bemannas av Grannlaget P2019',
    );
    expect(within(roster).getByText('Kontakt Testvuxen')).toBeTruthy();
    expect(
      within(roster)
        .getByRole('link', { name: /\+46 70 000 00 77/ })
        .getAttribute('href'),
    ).toBe('tel:+46700000077');
    const instructions = within(roster).getAllByText('Instruktioner')[0];
    await user.click(instructions);
    expect(instructions.closest('details')?.open).toBe(true);
    expect(within(roster).getAllByText('Hjälp barnen med pyntet.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('option', { name: /Privat planeringsutkast/ })).toBeNull();
  });

  it('shows cancelled events and assignments without offering confirmation or calendar actions', async () => {
    const user = userEvent.setup();
    server.events[0].published!.shifts[0].slots[0].status = 'cancelled';
    const cancelled = publishedEvent('cancelled', 'Inställd familjedag', '2030-06-20');
    cancelled.cancelled = true;
    server.events.push(cancelled);
    render(
      <Parents
        state={server}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={vi.fn()}
        tell={vi.fn()}
      />,
    );
    for (const eventId of ['event-one', 'cancelled']) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Evenemang' }), eventId);
      expect(screen.queryByRole('button', { name: 'Bekräfta passet' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Visa / ändra ansvarig' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lägg till i kalender' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Jag behöver hjälp att byta' })).toBeNull();
      expect(screen.getAllByText('Inställt').length).toBeGreaterThan(0);
    }
  });

  it('keeps requests subject to organiser approval instead of changing the assignment', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'public'));
    const tell = vi.fn();
    render(
      <Parents
        state={server}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={mutate}
        tell={tell}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Jag behöver hjälp att byta' }));
    const dialog = screen.getByRole('dialog', { name: 'Be om hjälp med passet' });
    expect(
      within(dialog).getByText('Du står kvar på passet tills lagföräldern har godkänt en ändring.'),
    ).toBeTruthy();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Meddelande till lagföräldern' }),
      'Vi behöver byta till eftermiddagen.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Skicka förfrågan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mutate).toHaveBeenCalledWith({
      type: 'request_change',
      eventId: 'event-one',
      slotId: 'slot-one',
      revision: 1,
      familyId: 'family-one',
      message: 'Vi behöver byta till eftermiddagen.',
    });
    expect(tell).toHaveBeenCalledWith(expect.stringMatching(/Nuvarande schema gäller tills/));
    expect(
      within(screen.getByRole('region', { name: 'Familjens uppdrag' })).getByRole('button', {
        name: 'Bekräfta passet',
      }),
    ).toBeTruthy();
  });
});

describe('administration across public actions', () => {
  it('reloads full admin data after a public confirmation instead of losing private drafts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Välj ditt barn för att komma vidare' });
    await user.click(screen.getByRole('button', { name: 'Administration' }));
    await screen.findByRole('heading', { name: 'Översikt' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Privat planeringsutkast' })).toBeTruthy(),
    );
    await user.click(screen.getByRole('button', { name: 'Föräldrasida' }));
    await user.type(
      screen.getByRole('searchbox', { name: 'Sök barn eller familj' }),
      'Testbarn Ett',
    );
    await user.click(screen.getByRole('button', { name: 'Testbarn Ett' }));
    const readsBefore = client.readPortal.mock.calls.filter((args) => args[0] === true).length;
    await user.click(screen.getByRole('button', { name: 'Bekräfta passet' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mejladress' }),
      'parent@example.test',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.runCommand).toHaveBeenCalledTimes(1);
    expect(client.readPortal.mock.calls.filter((args) => args[0] === true).length).toBeGreaterThan(
      readsBefore,
    );
    await user.click(screen.getByRole('button', { name: 'Administration' }));
    await user.click(screen.getByRole('button', { name: 'Evenemang' }));
    expect(screen.getByRole('heading', { name: 'Privat planeringsutkast' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Topplista' }));
    const historicalStat = screen.getByText('Genomförda pass').closest('.stat-card')!;
    expect(within(historicalStat as HTMLElement).getByText('1')).toBeTruthy();
  });
});

describe('portal without email', () => {
  it('keeps confirmation and calendar available without offering email subscriptions', async () => {
    client.mailEnabled = false;
    const user = userEvent.setup();
    render(
      <Parents
        state={server}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={vi.fn()}
        tell={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Mejlpåminnelser' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bekräfta passet' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Lägg till i kalender' }));
    expect(await screen.findByRole('dialog', { name: 'Lägg till i kalender' })).toBeTruthy();
    expect(client.api).not.toHaveBeenCalled();
  });

  it('does not offer password recovery before email is active', async () => {
    client.mailEnabled = false;
    client.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Välj ditt barn för att komma vidare' });
    await user.click(screen.getByRole('button', { name: 'Administration' }));
    const dialog = screen.getByRole('dialog', { name: 'Logga in som lagförälder' });
    expect(within(dialog).queryByRole('button', { name: 'Glömt lösenord?' })).toBeNull();
    expect(within(dialog).getByText(/Återställning via mejl är inte aktiverad/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Logga in' })).toBeTruthy();
    expect(client.api).not.toHaveBeenCalled();
  });

  it('respects the backend mail switch and still saves the contact person', async () => {
    client.mailStatus.mockResolvedValue({
      enabled: false,
      counts: {},
      lastWorkerAt: null,
      lastSentAt: null,
      messages: [],
    });
    const user = userEvent.setup();
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    render(
      <Admin state={server} page="paminnelser" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await waitFor(() => expect(client.mailStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Mejl aktiveras senare.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Påminn före passet' })).toBeNull();
    const contact = screen.getByRole('textbox', { name: 'Kontaktperson' });
    await user.clear(contact);
    await user.type(contact, 'Testansvarig');
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: 'update_team',
      team: { contactName: 'Testansvarig' },
    });
    expect(client.api).not.toHaveBeenCalled();
  });
});

describe('honest mail service status', () => {
  it('does not claim sending is paused when the status request fails', async () => {
    client.mailStatus.mockRejectedValue(new Error('Anslutningen bröts.'));
    render(
      <Admin
        state={server}
        page="paminnelser"
        navigate={vi.fn()}
        mutate={vi.fn()}
        tell={vi.fn()}
      />,
    );
    expect(await screen.findByText('Utskicksstatus kunde inte hämtas.')).toBeTruthy();
    expect(screen.queryByText('Mejl aktiveras senare.')).toBeNull();
    expect(screen.queryByText(/Inga nya utskick köas/)).toBeNull();
  });

  it('distinguishes hidden email controls from a disabled server sender', async () => {
    client.mailEnabled = false;
    render(
      <Admin
        state={server}
        page="paminnelser"
        navigate={vi.fn()}
        mutate={vi.fn()}
        tell={vi.fn()}
      />,
    );
    expect(await screen.findByText('Utskick är aktiverade.')).toBeTruthy();
    expect(screen.queryByText(/Inga nya utskick köas/)).toBeNull();
    expect(screen.queryByText(/tidigare utskick är pausade/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Påminn före passet' })).toBeNull();
  });
});

describe('parent contact emails and individual reminders', () => {
  it('requires an email during confirmation, sends it with the answer, and keeps it out of public state', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'public'));
    render(
      <Parents
        state={projected(server)}
        familyId="family-one"
        setFamilyId={vi.fn()}
        mutate={mutate}
        tell={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Bekräfta passet' }));
    const dialog = screen.getByRole('dialog');
    const email = within(dialog).getByRole('textbox', { name: 'Mejladress' }) as HTMLInputElement;
    expect(email.required).toBe(true);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
    expect(mutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Telefonnummer' }), '0700000001');
    await user.type(email, 'parent@example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({ adultEmail: 'parent@example.test' });
    const next: PortalState = await mutate.mock.results[0].value;
    expect(next.adults.some((a) => a.email === 'parent@example.test')).toBe(true);
    expect(JSON.stringify(projected(next))).not.toContain('parent@example.test');
  });
  it('lets admin remind one pending assignment using its current revision', async () => {
    const user = userEvent.setup();
    server.adults[0].email = 'parent@example.test';
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    render(
      <Admin state={server} page="evenemang" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Svar & uppföljning' }));
    await user.click(screen.getByRole('button', { name: 'Påminn via mejl' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: 'remind_confirmation',
      eventId: 'event-one',
      slotId: 'slot-one',
      familyId: 'family-one',
      revision: 1,
    });
  });
  it('explains a missing address instead of offering a reminder that cannot be sent', async () => {
    const user = userEvent.setup();
    render(
      <Admin state={server} page="evenemang" navigate={vi.fn()} mutate={vi.fn()} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Svar & uppföljning' }));
    expect(
      (screen.getByRole('button', { name: 'Påminn via mejl' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Mejladress saknas – lägg till under Spelare & föräldrar.'),
    ).toBeTruthy();
  });
});

it('lets a parent book a vacant preparation, enter a contribution and see the deadline', async () => {
  const user = userEvent.setup();
  const event = server.events[0];
  event.published!.bookingMode = 'self';
  const shift = event.published!.shifts[0];
  Object.assign(shift, {
    kind: 'task',
    countsTowardBalance: false,
    title: 'Bakning',
    group: 'Förberedelser',
    answerPrompt: 'Vad bakar du?',
    endsAt: shift.startsAt,
  });
  delete shift.slots[0].familyId;
  event.draft = structuredClone(event.published!);
  const mutate = vi.fn(async (command: PortalCommand) => {
    server = applyCommand(server, command, 'public');
    return server;
  });
  const props = { setFamilyId: vi.fn(), mutate, tell: vi.fn(), familyId: 'family-one' };
  const view = render(<Parents {...props} state={projected(server)} />);
  expect(screen.getByText('Bakning')).toBeTruthy();
  expect(screen.getByText('Senast 15 juni kl. 11:00')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Boka platsen' }));
  const modal = screen.getByRole('dialog', { name: 'Boka ett uppdrag' });
  await user.type(within(modal).getByRole('textbox', { name: 'Telefonnummer' }), '0701234567');
  await user.type(
    within(modal).getByRole('textbox', { name: 'Mejladress' }),
    'parent@example.test',
  );
  await user.type(within(modal).getByRole('textbox', { name: /Vad bakar du/ }), 'Kanelbullar');
  await user.click(within(modal).getByRole('checkbox'));
  await user.click(within(modal).getByRole('button', { name: 'Boka och bekräfta' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mutate.mock.calls[0][0]).toMatchObject({
    type: 'book',
    familyId: 'family-one',
    answer: 'Kanelbullar',
  });
  view.rerender(<Parents {...props} state={projected(server)} />);
  const own = screen.getByRole('region', { name: 'Familjens uppdrag' });
  expect(within(own).getByText('Bekräftat')).toBeTruthy();
  await user.click(within(own).getByRole('button', { name: 'Skriv / ändra uppgifter' }));
  const answer = screen.getByRole('textbox', { name: /Vad bakar du/ });
  await user.clear(answer);
  await user.type(answer, 'Muffins');
  await user.click(screen.getByRole('button', { name: 'Spara uppgifter' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(server.events[0].published!.shifts[0].slots[0].answer).toBe('Muffins');
});

it('does not offer self booking in administrator assigned events', () => {
  delete server.events[0].published!.shifts[0].slots[0].familyId;
  render(
    <Parents
      state={projected(server)}
      familyId="family-one"
      setFamilyId={vi.fn()}
      mutate={vi.fn()}
      tell={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Boka platsen' })).toBeNull();
});

it('blocks another staffing booking but still offers voluntary preparations for the selected family', () => {
  const event = server.events[0];
  event.published!.bookingMode = 'self';
  const shift = event.published!.shifts[0];
  shift.slots.push({ id: 'vacant-slot', status: 'pending', revision: 1, locked: false });
  const task = structuredClone(shift);
  task.id = 'preparation';
  task.kind = 'task';
  task.title = 'Bakning';
  task.startsAt = task.endsAt;
  task.slots = [{ id: 'task-slot', status: 'pending', revision: 1, locked: false }];
  event.published!.shifts.push(task);
  render(
    <Parents
      state={projected(server)}
      familyId="family-one"
      setFamilyId={vi.fn()}
      mutate={vi.fn()}
      tell={vi.fn()}
    />,
  );
  expect(
    (screen.getByRole('button', { name: 'Familjen har redan ett pass' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: 'Boka platsen' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('omits already assigned families from a vacant staffing place while keeping the current selection editable', async () => {
  const user = userEvent.setup();
  server.events[0].draft.shifts[0].slots.push({
    id: 'vacant-slot',
    status: 'pending',
    revision: 0,
    locked: false,
  });
  render(
    <Admin state={server} page="evenemang" navigate={vi.fn()} mutate={vi.fn()} tell={vi.fn()} />,
  );
  const article = screen.getByRole('heading', { name: 'Öppet testsammandrag' }).closest('article')!;
  await user.click(within(article).getByRole('button', { name: 'Öppna planering' }));
  const first = screen.getByRole('combobox', { name: 'Familj för plats 1' });
  const second = screen.getByRole('combobox', { name: 'Familj för plats 2' });
  expect(
    within(first)
      .getAllByRole('option')
      .some((o) => (o as HTMLOptionElement).value === 'family-one'),
  ).toBe(true);
  expect(
    within(second)
      .getAllByRole('option')
      .some((o) => (o as HTMLOptionElement).value === 'family-one'),
  ).toBe(false);
  expect(
    within(second)
      .getAllByRole('option')
      .some((o) => (o as HTMLOptionElement).value === 'family-two'),
  ).toBe(true);
});

describe('SportAdmin in the event editor', () => {
  const integration = (links: Record<string, number> = {}) => ({
    connected: true,
    profiles: [],
    activities: [{ id: 7, title: 'Testmatch i SportAdmin', startsAt: '2030-06-15T09:00:00Z' }],
    players: [],
    mapping: {},
    links,
  });
  it('saves a selected activity with a new event before automatic planning', async () => {
    client.api.mockResolvedValue({ integration: integration() });
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    const user = userEvent.setup();
    render(
      <Admin state={server} page="oversikt" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Nytt evenemang' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Evenemangets namn'), 'Ny match');
    await screen.findByRole('option', { name: /Testmatch i SportAdmin/ });
    await user.selectOptions(within(dialog).getByLabelText('Koppla till SportAdmin'), '7');
    await user.click(within(dialog).getByRole('button', { name: /Pass & bemanning/ }));
    expect(
      (
        within(dialog).getAllByRole('combobox', {
          name: /Familj för plats/,
        })[0] as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Fördela lediga pass' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: 'save_event',
      sportadminActivityId: 7,
      event: { draft: { title: 'Ny match' } },
    });
    expect(mutate.mock.calls[1][0]).toMatchObject({ type: 'auto_plan' });
  });
  it('preserves the existing link if SportAdmin cannot be loaded', async () => {
    client.api.mockRejectedValue(new Error('unavailable'));
    const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
    const user = userEvent.setup();
    render(
      <Admin state={server} page="oversikt" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Nytt evenemang' }));
    await user.type(screen.getByLabelText('Evenemangets namn'), 'Vanligt evenemang');
    await screen.findByText(/Befintlig koppling behålls/);
    await user.click(screen.getByRole('button', { name: 'Spara utkast' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).not.toHaveProperty('sportadminActivityId');
  });
});

it('shows an existing activity outside the upcoming list and saves removal from the event editor', async () => {
  const event = server.events[0];
  event.attendance = { title: 'Tidigare SportAdmin-match', checkedAt: '', eligibleChildIds: [] };
  client.api.mockResolvedValue({
    integration: {
      connected: false,
      profiles: [],
      activities: [],
      players: [],
      mapping: {},
      links: { [event.id]: 99 },
    },
  });
  const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
  const user = userEvent.setup();
  render(
    <Admin state={server} page="evenemang" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
  );
  const article = screen.getByRole('heading', { name: 'Öppet testsammandrag' }).closest('article')!;
  await user.click(within(article).getByRole('button', { name: 'Öppna planering' }));
  await screen.findByRole('option', { name: 'Tidigare SportAdmin-match' });
  const select = screen.getByLabelText('Koppla till SportAdmin') as HTMLSelectElement;
  expect(select.value).toBe('99');
  await user.selectOptions(select, '');
  await user.click(screen.getByRole('button', { name: 'Spara utkast' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][0]).toMatchObject({
    type: 'save_event',
    sportadminActivityId: null,
    event: { id: event.id },
  });
});

it('keeps unsaved event details and activity choice if the combined save fails', async () => {
  client.api.mockResolvedValue({
    integration: {
      connected: true,
      profiles: [],
      activities: [{ id: 7, title: 'Testmatch', startsAt: '2030-06-15T09:00:00Z' }],
      players: [],
      mapping: {},
      links: {},
    },
  });
  const mutate = vi.fn().mockRejectedValue(new Error('SportAdmin kunde inte läsas.'));
  const user = userEvent.setup();
  render(
    <Admin state={server} page="oversikt" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
  );
  await user.click(screen.getByRole('button', { name: 'Nytt evenemang' }));
  await user.type(screen.getByLabelText('Evenemangets namn'), 'Behåll mitt utkast');
  await screen.findByRole('option', { name: /Testmatch/ });
  await user.selectOptions(screen.getByLabelText('Koppla till SportAdmin'), '7');
  await user.click(screen.getByRole('button', { name: 'Spara utkast' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('SportAdmin kunde inte läsas'),
  );
  expect((screen.getByLabelText('Evenemangets namn') as HTMLInputElement).value).toBe(
    'Behåll mitt utkast',
  );
  expect((screen.getByLabelText('Koppla till SportAdmin') as HTMLSelectElement).value).toBe('7');
});

it('admin marks a manual player as attending in the event editor and saves it with the link', async () => {
  server.children[0].source = 'manual';
  server.children[1].source = 'sportadmin';
  client.api.mockResolvedValue({
    integration: {
      connected: true,
      profiles: [],
      players: [],
      mapping: {},
      links: {},
      activities: [{ id: 7, title: 'Testmatch', startsAt: '2030-06-15T09:00:00Z' }],
    },
  });
  const mutate = vi.fn(async (command: PortalCommand) => applyCommand(server, command, 'admin'));
  const user = userEvent.setup();
  render(
    <Admin state={server} page="oversikt" navigate={vi.fn()} mutate={mutate} tell={vi.fn()} />,
  );
  await user.click(screen.getByRole('button', { name: 'Nytt evenemang' }));
  await user.type(screen.getByLabelText('Evenemangets namn'), 'Manuellt deltagande');
  await screen.findByRole('option', { name: /Testmatch/ });
  await user.selectOptions(screen.getByLabelText('Koppla till SportAdmin'), '7');
  expect(screen.queryByRole('checkbox', { name: server.children[1].name })).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: server.children[0].name }));
  await user.click(screen.getByRole('button', { name: 'Spara utkast' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][0]).toMatchObject({
    type: 'save_event',
    sportadminActivityId: 7,
    event: { manualParticipantIds: ['child-one'] },
  });
});

it('confirmation for a synced parent uses register contacts without asking them to retype private email', async () => {
  server.adults[0].source = 'sportadmin';
  server.adults[0].email = 'synced@example.test';
  const mutate = vi.fn(async (command: PortalCommand) => {
    server = applyCommand(server, command, 'public');
    return server;
  });
  const user = userEvent.setup();
  render(
    <Parents
      state={projected(server)}
      familyId="family-one"
      setFamilyId={vi.fn()}
      mutate={mutate}
      tell={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Bekräfta passet' }));
  const dialog = screen.getByRole('dialog', { name: 'Bekräfta familjens pass' });
  expect(within(dialog).queryByRole('textbox', { name: 'Mejladress' })).toBeNull();
  expect(within(dialog).getByText(/hämtas från SportAdmin när du bekräftar/)).toBeTruthy();
  expect(screen.queryByText('synced@example.test')).toBeNull();
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Bekräfta passet' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(server.adults[0].email).toBe('synced@example.test');
});

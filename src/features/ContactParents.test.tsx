// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { demoState } from '../domain/demo';
import Parents from './Parents';

const readContacts = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ readAdminContacts: readContacts, readPortal: vi.fn() }));
const contacts = [
  { name: 'Alex Test', email: 'alex@example.test' },
  { name: 'Robin Test', email: 'robin+laget@example.test' },
];
beforeEach(() => readContacts.mockReset().mockResolvedValue(contacts));
afterEach(cleanup);
const page = () =>
  render(
    <Parents
      state={demoState()}
      familyId=""
      setFamilyId={vi.fn()}
      mutate={vi.fn()}
      tell={vi.fn()}
    />,
  );

it('lets a parent choose one administrator without selecting a child or signing in', async () => {
  const user = userEvent.setup();
  page();
  expect(readContacts).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Kontakta Lagförälder' }));
  const dialog = screen.getByRole('dialog', { name: 'Kontakta lagförälder' });
  const links = await within(dialog).findAllByRole('link');
  expect(links.map((link) => decodeURIComponent(link.getAttribute('href')!))).toEqual([
    'mailto:alex@example.test',
    'mailto:robin+laget@example.test',
  ]);
  expect(within(dialog).getByText('Alex Test')).toBeTruthy();
  expect(within(dialog).getByText('Robin Test')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kontakta Lagförälder' }));
});

it('refreshes membership when reopened and includes administrators without a parent record', async () => {
  const user = userEvent.setup();
  page();
  await user.click(screen.getByRole('button', { name: 'Kontakta Lagförälder' }));
  await screen.findByText('Alex Test');
  await user.click(screen.getByRole('button', { name: 'Stäng' }));
  readContacts.mockResolvedValue([{ name: 'new@example.test', email: 'new@example.test' }]);
  await user.click(screen.getByRole('button', { name: 'Kontakta Lagförälder' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByRole('link', { name: 'new@example.test' })).toBeTruthy();
  expect(within(dialog).queryByText('Alex Test')).toBeNull();
  expect(readContacts).toHaveBeenCalledTimes(2);
});

it('offers retry after a failed lookup instead of displaying an outdated recipient', async () => {
  const user = userEvent.setup();
  readContacts.mockRejectedValueOnce(new Error('connection failed'));
  page();
  await user.click(screen.getByRole('button', { name: 'Kontakta Lagförälder' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(within(screen.getByRole('dialog')).queryAllByRole('link')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Försök igen' }));
  expect(await screen.findByText('Alex Test')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows an explicit empty state when there are no current administrator contacts', async () => {
  const user = userEvent.setup();
  readContacts.mockResolvedValue([]);
  page();
  await user.click(screen.getByRole('button', { name: 'Kontakta Lagförälder' }));
  expect(
    await screen.findByText('Det finns inga lagföräldrar med mejladress att visa just nu.'),
  ).toBeTruthy();
  expect(within(screen.getByRole('dialog')).queryAllByRole('link')).toHaveLength(0);
});

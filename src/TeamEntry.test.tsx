// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamEntry from './TeamEntry';

const readDirectory = vi.hoisted(() => vi.fn());
vi.mock('./team-directory', () => ({ readTeamDirectory: readDirectory }));
vi.mock('./App', () => ({ default: () => <div>Lagets portal</div> }));
const landvetter = { slug: 'landvetter-p2018', name: 'P2018', clubName: 'Landvetter IS' };
const other = { slug: 'another-team', name: 'P2019', clubName: 'Testklubben' };
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
});

describe('team entry', () => {
  it('preserves subscription queries, auth fragments and admin links on the old URL', async () => {
    readDirectory.mockResolvedValue([landvetter]);
    for (const suffix of [
      '?subscription=test-token#/foraldrar',
      '#/evenemang',
      '?code=test-code#access_token=test-token&type=recovery',
    ]) {
      history.replaceState(null, '', '/' + suffix);
      const view = render(<TeamEntry />);
      await screen.findByText('Lagets portal');
      expect(location.pathname + location.search + location.hash).toBe(
        '/LandvetterISP2018' + suffix,
      );
      view.unmount();
    }
  });
  it('shows a team choice without choosing for the user when more than one team exists', async () => {
    history.replaceState(null, '', '/');
    readDirectory.mockResolvedValue([landvetter, other]);
    render(<TeamEntry />);
    expect(
      (await screen.findByRole('link', { name: 'Landvetter IS P2018' })).getAttribute('href'),
    ).toBe('/LandvetterISP2018');
    expect(screen.getByRole('link', { name: 'Testklubben P2019' })).toBeTruthy();
    expect(location.pathname).toBe('/');
    expect(screen.queryByText('Lagets portal')).toBeNull();
  });
  it('loads an existing direct team address even when there are multiple teams', async () => {
    history.replaceState(null, '', '/LandvetterISP2018/');
    readDirectory.mockResolvedValue([landvetter, other]);
    render(<TeamEntry />);
    await screen.findByText('Lagets portal');
    expect(location.pathname).toBe('/LandvetterISP2018');
  });
  it('offers retry instead of assuming there is only one team if the directory is unavailable', async () => {
    history.replaceState(null, '', '/');
    readDirectory.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([landvetter]);
    render(<TeamEntry />);
    await screen.findByRole('alert');
    expect(location.pathname).toBe('/');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Försök igen' }));
    await waitFor(() => expect(screen.getByText('Lagets portal')).toBeTruthy());
  });
});

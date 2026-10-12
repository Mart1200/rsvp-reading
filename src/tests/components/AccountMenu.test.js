import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import AccountMenu from '../../lib/components/AccountMenu.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };

function renderMenu(state) {
  auth.set(state);
  render(AccountMenu);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountMenu', () => {
  it.each(['loading', 'unavailable'])('renders nothing while %s', (status) => {
    renderMenu({ status, user: null });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers sign in to guests and opens the dialog', async () => {
    renderMenu({ status: 'guest', user: null });

    await fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));

    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the username and opens the menu', async () => {
    renderMenu({ status: 'user', user: alice });

    const button = screen.getByRole('button', { name: /alice/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['Change password', 'Log out', 'Delete account']);
  });

  it('closes the menu on outside click', async () => {
    renderMenu({ status: 'user', user: alice });
    await fireEvent.click(screen.getByRole('button', { name: /alice/ }));

    await fireEvent.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('logs out and shows the sign-in button again', async () => {
    mockFetch({ 'POST /api/auth/logout': { status: 204 } });
    renderMenu({ status: 'user', user: alice });

    await fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('button', { name: /Sign in/ })).toBeInTheDocument();
    expect(get(auth).status).toBe('guest');
  });

  it('shows an error when logout fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    renderMenu({ status: 'user', user: alice });

    await fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    expect(get(auth).status).toBe('user');
  });

  it('switches to the sign-in dialog when the session turns out to be gone', async () => {
    mockFetch({
      'POST /api/auth/password': { status: 401, body: apiError('UNAUTHENTICATED', 'Not logged in') }
    });
    renderMenu({ status: 'user', user: alice });

    await fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Change password' }));
    await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'old password' } });
    await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'new password' } });
    await fireEvent.input(screen.getByLabelText('Repeat new password'), { target: { value: 'new password' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(get(auth).status).toBe('guest');
  });

  it.each([
    ['Change password', 'Change password'],
    ['Delete account', 'Delete account']
  ])('opens the "%s" dialog', async (item, title) => {
    renderMenu({ status: 'user', user: alice });

    await fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: item }));

    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

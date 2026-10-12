import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import AuthModal from '../../lib/components/AuthModal.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };

async function fill(label, value) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

function renderModal(props = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(AuthModal, { props, events: { done: onDone, close: onClose } });
  return { onDone, onClose };
}

beforeEach(() => {
  auth.set({ status: 'guest', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthModal – sign in', () => {
  it('signs in and reports the user', async () => {
    const server = mockFetch({ 'POST /api/auth/login': { body: { user: alice } } });
    const { onDone } = renderModal();

    await fill('Username', 'alice');
    await fill('Password', 'correct horse');
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(server.calls('POST /api/auth/login')[0].body).toEqual({ username: 'alice', password: 'correct horse' });
    expect(get(auth).user).toEqual(alice);
  });

  it('requires both fields before calling the API', async () => {
    const server = mockFetch();
    renderModal();

    await fireEvent.submit(screen.getByLabelText('Username').closest('form'));

    expect(screen.getByText('Enter your username')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('shows the server error for wrong credentials', async () => {
    mockFetch({
      'POST /api/auth/login': { status: 401, body: apiError('INVALID_CREDENTIALS', 'Wrong username or password') }
    });
    const { onDone } = renderModal();

    await fill('Username', 'alice');
    await fill('Password', 'wrong horse');
    await fireEvent.submit(screen.getByLabelText('Username').closest('form'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('uses current-password autocomplete and has no recovery notice', () => {
    renderModal();

    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByTestId('no-recovery-notice')).not.toBeInTheDocument();
  });

  it('closes on Escape without letting the key reach the reader', async () => {
    const windowKeydown = vi.fn();
    window.addEventListener('keydown', windowKeydown);
    const { onClose } = renderModal();

    await fireEvent.keyDown(screen.getByLabelText('Username'), { key: 'Escape' });
    await fireEvent.keyDown(screen.getByLabelText('Username'), { key: ' ', code: 'Space' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(windowKeydown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowKeydown);
  });
});

describe('AuthModal – register', () => {
  it('shows the no-recovery notice', async () => {
    renderModal({ mode: 'register' });

    expect(screen.getByTestId('no-recovery-notice'))
      .toHaveTextContent('There is no password recovery');
  });

  it('switches between the tabs', async () => {
    renderModal();

    await fireEvent.click(screen.getByRole('tab', { name: 'Register' }));
    expect(screen.getByLabelText('Repeat password')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('tab', { name: 'Sign in' }));
    expect(screen.queryByLabelText('Repeat password')).not.toBeInTheDocument();
  });

  it('validates inline before calling the API', async () => {
    const server = mockFetch();
    renderModal({ mode: 'register' });

    await fill('Username', 'a b');
    await fill('Password', 'short');
    await fireEvent.submit(screen.getByLabelText('Username').closest('form'));

    expect(screen.getByText(/3–32 characters/)).toBeInTheDocument();
    expect(screen.getByText(/8–128 characters/)).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('requires the repeated password to match', async () => {
    const server = mockFetch();
    renderModal({ mode: 'register' });

    await fill('Username', 'alice');
    await fill('Password', 'correct horse');
    await fill('Repeat password', 'correct horsE');
    await fireEvent.submit(screen.getByLabelText('Username').closest('form'));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('registers and reports the user', async () => {
    const server = mockFetch({ 'POST /api/auth/register': { status: 201, body: { user: alice } } });
    const { onDone } = renderModal({ mode: 'register' });

    await fill('Username', 'alice');
    await fill('Password', 'correct horse');
    await fill('Repeat password', 'correct horse');
    await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(server.calls('POST /api/auth/register')[0].body).toEqual({ username: 'alice', password: 'correct horse' });
  });

  it('shows a taken username at the username field', async () => {
    mockFetch({
      'POST /api/auth/register': { status: 409, body: apiError('USERNAME_TAKEN', 'Username is already taken') }
    });
    renderModal({ mode: 'register' });

    await fill('Username', 'alice');
    await fill('Password', 'correct horse');
    await fill('Repeat password', 'correct horse');
    await fireEvent.submit(screen.getByLabelText('Username').closest('form'));

    expect(await screen.findByText('Username is already taken')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses new-password autocomplete', () => {
    renderModal({ mode: 'register' });

    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  });
});

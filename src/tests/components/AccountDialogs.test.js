import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ChangePasswordModal from '../../lib/components/ChangePasswordModal.svelte';
import DeleteAccountModal from '../../lib/components/DeleteAccountModal.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };

async function fill(label, value) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  auth.set({ status: 'user', user: alice });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChangePasswordModal', () => {
  it('changes the password and confirms', async () => {
    const server = mockFetch({ 'POST /api/auth/password': { status: 204 } });
    render(ChangePasswordModal);

    await fill('Current password', 'old password');
    await fill('New password', 'new password');
    await fill('Repeat new password', 'new password');
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Other devices have been signed out');
    expect(server.calls('POST /api/auth/password')[0].body).toEqual({
      currentPassword: 'old password',
      newPassword: 'new password'
    });
  });

  it('validates before calling the API', async () => {
    const server = mockFetch();
    render(ChangePasswordModal);

    await fill('New password', 'short');
    await fireEvent.submit(screen.getByLabelText('New password').closest('form'));

    expect(screen.getByText('Enter your current password')).toBeInTheDocument();
    expect(screen.getByText(/8–128 characters/)).toBeInTheDocument();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('requires the new password to be repeated correctly', async () => {
    const server = mockFetch();
    render(ChangePasswordModal);

    await fill('Current password', 'old password');
    await fill('New password', 'new password');
    await fill('Repeat new password', 'other password');
    await fireEvent.submit(screen.getByLabelText('New password').closest('form'));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('marks a wrong current password', async () => {
    mockFetch({ 'POST /api/auth/password': { status: 403, body: apiError('INVALID_PASSWORD', 'Password is wrong') } });
    render(ChangePasswordModal);

    await fill('Current password', 'wrong one');
    await fill('New password', 'new password');
    await fill('Repeat new password', 'new password');
    await fireEvent.submit(screen.getByLabelText('New password').closest('form'));

    expect(await screen.findByText('Current password is wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('DeleteAccountModal', () => {
  function renderModal() {
    const onDeleted = vi.fn();
    render(DeleteAccountModal, { events: { deleted: onDeleted } });
    return { onDeleted };
  }

  it('asks for confirmation before deleting', async () => {
    const server = mockFetch({ 'DELETE /api/auth/account': { status: 204 } });
    const { onDeleted } = renderModal();

    await fill('Password', 'correct horse');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('cannot be undone');
    expect(server.fetch).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(server.calls('DELETE /api/auth/account')[0].body).toEqual({ password: 'correct horse' });
    expect(get(auth).status).toBe('guest');
  });

  it('requires the password first', async () => {
    renderModal();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
  });

  it('can be cancelled at the confirmation step', async () => {
    const server = mockFetch();
    renderModal();

    await fill('Password', 'correct horse');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Password')).toHaveValue('correct horse');
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('goes back to the password field when the password is wrong', async () => {
    mockFetch({ 'DELETE /api/auth/account': { status: 403, body: apiError('INVALID_PASSWORD', 'Password is wrong') } });
    const { onDeleted } = renderModal();

    await fill('Password', 'wrong horse');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByText('Password is wrong')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(get(auth).status).toBe('user');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import App from '../../App.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const press = (code) => fireEvent.keyDown(window, { code });
const contextText = () => [...document.querySelectorAll('.paused-context')].map((el) => el.textContent).join(' ');
const hasContext = () => document.querySelectorAll('.paused-context').length > 0;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  auth.set({ status: 'loading', user: null });
  mockFetch({ 'GET /api/auth/me': { status: 401, body: apiError('UNAUTHENTICATED') } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('surrounding text', () => {
  it('is shown before reading starts', () => {
    render(App);

    // Default text starts with "Rapid serial visual presentation ..."
    expect(contextText()).toContain('serial visual presentation');
  });

  it('is hidden while reading', async () => {
    render(App);

    await press('Space');
    await vi.advanceTimersByTimeAsync(500);

    expect(hasContext()).toBe(false);
  });

  it('is shown on a manual pause, as before', async () => {
    render(App);
    await press('Space');
    await vi.advanceTimersByTimeAsync(1500);

    await press('Space');

    expect(hasContext()).toBe(true);
  });

  it('is shown after leaving reading mode, around the current position', async () => {
    render(App);
    await press('Space');
    await vi.advanceTimersByTimeAsync(1500);

    await fireEvent.click(screen.getByRole('button', { name: 'Exit reading mode' }));

    // Some words have passed, so there is text before the current word
    expect(document.querySelectorAll('.paused-context')).toHaveLength(2);
    expect(contextText()).toContain('Rapid');
  });

  it('is shown after Stop', async () => {
    render(App);
    await press('Space');
    await vi.advanceTimersByTimeAsync(1500);

    await fireEvent.click(screen.getByTitle('Stop (back to your saved position)'));

    expect(contextText()).toContain('serial visual presentation');
  });

  it('can still be turned off in the settings', async () => {
    render(App);
    await fireEvent.click(screen.getByTitle('Settings'));

    await fireEvent.click(screen.getByRole('switch', { name: /show context/i }));

    expect(hasContext()).toBe(false);
  });
});

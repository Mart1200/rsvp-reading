import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import App from '../../App.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const header = () => screen.queryByRole('heading', { name: 'RSVP Reader' });
const exitButton = () => screen.queryByRole('button', { name: 'Exit reading mode' });
const press = (code) => fireEvent.keyDown(window, { code });

// "12 / 63" from the progress bar outside focus mode
function shownPosition() {
  const match = document.body.textContent.match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

async function startReading() {
  render(App);
  await press('Space');
  // Let a few words pass
  await vi.advanceTimersByTimeAsync(1500);
}

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

describe('exit reading mode', () => {
  it('is only offered in reading mode', async () => {
    render(App);
    expect(exitButton()).not.toBeInTheDocument();

    await press('Space');

    expect(exitButton()).toBeInTheDocument();
    expect(header()).not.toBeInTheDocument();
  });

  it('leaves reading mode while reading and keeps the position', async () => {
    await startReading();

    await fireEvent.click(exitButton());

    expect(header()).toBeInTheDocument();
    expect(exitButton()).not.toBeInTheDocument();
    expect(shownPosition()).toBeGreaterThan(0);
  });

  it('stops advancing words after leaving', async () => {
    await startReading();
    await fireEvent.click(exitButton());
    const position = shownPosition();

    await vi.advanceTimersByTimeAsync(3000);

    expect(shownPosition()).toBe(position);
  });

  it('also works while paused', async () => {
    await startReading();
    await press('Space');
    expect(exitButton()).toBeInTheDocument();

    await fireEvent.click(exitButton());

    expect(header()).toBeInTheDocument();
    expect(shownPosition()).toBeGreaterThan(0);
  });

  it('behaves like Esc', async () => {
    await startReading();

    await press('Escape');

    expect(header()).toBeInTheDocument();
    expect(exitButton()).not.toBeInTheDocument();
    expect(shownPosition()).toBeGreaterThan(0);
  });

  it('can continue reading from the same position afterwards', async () => {
    await startReading();
    await fireEvent.click(exitButton());
    const position = shownPosition();

    await press('Space');
    await press('Escape');

    expect(shownPosition()).toBeGreaterThanOrEqual(position);
  });
});

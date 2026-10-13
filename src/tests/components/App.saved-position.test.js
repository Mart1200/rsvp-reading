import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import App from '../../App.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };
const content = Array.from({ length: 200 }, (_, i) => `word${i + 1}`).join(' ');
const book = {
  id: 't1', title: 'Long text', totalWords: 200, currentWordIndex: 50, progressPercent: 25,
  lastReadAt: null, createdAt: '2026-01-01T00:00:00Z', content, chapters: []
};

const press = (code, options = {}) => fireEvent.keyDown(window, { code, ...options });
const stopButton = () => screen.getByTitle('Stop (back to your saved position)');
const restartButton = () => screen.getByTitle('Restart');

// "57 / 200" from the progress bar outside focus mode
function shownPosition() {
  const match = document.body.textContent.match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

async function readFor(ms) {
  await press('Space');
  await vi.advanceTimersByTimeAsync(ms);
}

function guestServer() {
  return mockFetch({ 'GET /api/auth/me': { status: 401, body: apiError('UNAUTHENTICATED') } });
}

function libraryServer() {
  return mockFetch({
    'GET /api/auth/me': { body: { user: alice } },
    'GET /api/texts': { body: { texts: [book] } },
    'GET /api/texts/t1': { body: { text: book } },
    'PUT /api/texts/t1/progress': { status: 204 }
  });
}

async function openBook() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
  await fireEvent.click(await screen.findByRole('button', { name: /Long text/ }));
  await screen.findByTitle('Open from your library');
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  auth.set({ status: 'loading', user: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Stop', () => {
  it('goes to the beginning when nothing is saved', async () => {
    guestServer();
    render(App);
    await readFor(1500);

    await fireEvent.click(stopButton());

    expect(shownPosition()).toBe(0);
  });

  it('goes back to the saved position of a library text', async () => {
    libraryServer();
    render(App);
    await openBook();
    await readFor(1500);

    await fireEvent.click(stopButton());

    expect(shownPosition()).toBe(50);
  });

  it('goes back to the last position saved with Ctrl+S', async () => {
    const server = libraryServer();
    render(App);
    await openBook();
    await readFor(1500);
    await press('Escape');
    const savedAt = shownPosition();
    expect(savedAt).toBeGreaterThan(50);
    // Esc already saved; Ctrl+S saves again even though nothing changed
    await press('KeyS', { ctrlKey: true });
    await vi.waitFor(() => expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(2));
    expect(server.calls('PUT /api/texts/t1/progress')[1].body).toEqual({ currentWordIndex: savedAt });

    await readFor(1500);
    await fireEvent.click(stopButton());

    expect(shownPosition()).toBe(savedAt);
  });

  it('goes back to the position of a browser session (guest)', async () => {
    guestServer();
    render(App);
    await readFor(1500);
    await press('Escape');
    const savedAt = shownPosition();
    await press('KeyS', { ctrlKey: true });

    await readFor(1500);
    await fireEvent.click(stopButton());

    expect(shownPosition()).toBe(savedAt);
  });

  it('never writes the stopped position to the server', async () => {
    const server = libraryServer();
    render(App);
    await openBook();
    await readFor(1500);

    await fireEvent.click(stopButton());

    expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(0);
  });
});

describe('Restart', () => {
  it('starts right away when nothing is saved', async () => {
    guestServer();
    render(App);

    await fireEvent.click(restartButton());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'RSVP Reader' })).not.toBeInTheDocument();
  });

  it('asks before leaving saved progress behind', async () => {
    libraryServer();
    render(App);
    await openBook();

    await fireEvent.click(restartButton());

    const dialog = screen.getByRole('dialog', { name: 'Start from the beginning?' });
    expect(dialog).toHaveTextContent('Your saved position (word 50 of 200)');
  });

  it('keeps the position when cancelled', async () => {
    const server = libraryServer();
    render(App);
    await openBook();

    await fireEvent.click(restartButton());
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shownPosition()).toBe(50);
    expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(0);
  });

  it('starts from the beginning when confirmed, without touching the saved progress', async () => {
    const server = libraryServer();
    render(App);
    await openBook();

    await fireEvent.click(restartButton());
    await fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await vi.advanceTimersByTimeAsync(300);

    expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(0);

    // The saved position is still the way back
    await fireEvent.click(stopButton());
    expect(shownPosition()).toBe(50);
    expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(0);
  });

  it('replaces the saved progress once reading continues after a restart', async () => {
    const server = libraryServer();
    render(App);
    await openBook();

    await fireEvent.click(restartButton());
    await fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await vi.advanceTimersByTimeAsync(1500);
    await press('Space');

    await vi.waitFor(() => expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(1));
    const [{ body }] = server.calls('PUT /api/texts/t1/progress');
    expect(body.currentWordIndex).toBeLessThan(50);
  });

  it('does not ask after the progress was reset in the library', async () => {
    libraryServer();
    render(App);
    await openBook();
    await fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Reset progress' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() => expect(shownPosition()).toBe(0));
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await fireEvent.click(restartButton());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import App from '../../App.svelte';
import { auth } from '../../lib/auth.js';
import { loadSession, wasImportOffered } from '../../lib/progress-storage.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };
const content = 'Call me Ishmael. Some years ago';
const chapters = [{ title: 'Loomings', wordIndex: 0, level: 0 }];
const SESSION_KEY = 'rsvp-reading-session';
const IMPORT_DIALOG = { name: 'Save to library?' };

function storeGuestSession(overrides = {}) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    text: content, currentWordIndex: 3, totalWords: 6, chapters, settings: {}, savedAt: Date.now(),
    ...overrides
  }));
}

function guestServer(routes = {}) {
  return mockFetch({
    'GET /api/auth/me': { status: 401, body: apiError('UNAUTHENTICATED') },
    'POST /api/auth/login': { body: { user: alice } },
    'POST /api/auth/logout': { status: 204 },
    'PUT /api/auth/settings': { status: 204 },
    'POST /api/texts': (req) => ({
      status: 201,
      body: { text: { id: 't9', title: req.body.title, currentWordIndex: req.body.currentWordIndex } }
    }),
    ...routes
  });
}

async function signIn() {
  await fireEvent.click(await screen.findByRole('button', { name: /Sign in/ }));
  const dialog = screen.getByRole('dialog', { name: 'Sign in' });
  await fireEvent.input(within(dialog).getByLabelText('Username'), { target: { value: 'alice' } });
  await fireEvent.input(within(dialog).getByLabelText('Password'), { target: { value: 'secret123' } });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('button', { name: 'Library' });
}

async function signOut() {
  await fireEvent.click(screen.getByRole('button', { name: /alice/ }));
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
  await screen.findByRole('button', { name: /Sign in/ });
}

beforeEach(() => {
  localStorage.clear();
  auth.set({ status: 'loading', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Importing the guest session after signing in', () => {
  it('offers to save the browser session with its title and progress', async () => {
    storeGuestSession();
    guestServer();
    render(App);

    await signIn();

    const dialog = screen.getByRole('dialog', IMPORT_DIALOG);
    expect(dialog).toHaveTextContent("Save your current text ('Call me Ishmael. Some years ago', 50%) to your library?");
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Call me Ishmael. Some years ago');
  });

  it('saves text, chapters and position, then reads the saved text from the library', async () => {
    storeGuestSession();
    const server = guestServer();
    render(App);
    await signIn();

    const dialog = screen.getByRole('dialog', IMPORT_DIALOG);
    await fireEvent.input(within(dialog).getByLabelText('Title'), { target: { value: 'Moby Dick' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByTitle('Open from your library')).toHaveTextContent('Moby Dick');
    expect(server.calls('POST /api/texts')[0].body).toEqual({ title: 'Moby Dick', content, chapters, currentWordIndex: 3 });
    expect(screen.queryByRole('dialog', IMPORT_DIALOG)).not.toBeInTheDocument();
    // The reader switched to the saved text at its position
    expect(document.body).toHaveTextContent(/3\s*\/\s*6/);
    // Moved, not copied: the browser session is gone
    expect(loadSession()).toBeNull();
  });

  it('saves the reader position when the session is open and read further', async () => {
    storeGuestSession();
    const server = guestServer();
    render(App);

    await fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await fireEvent.keyDown(window, { code: 'ArrowRight' });
    await fireEvent.keyDown(window, { code: 'ArrowRight' });
    await signIn();

    const dialog = screen.getByRole('dialog', IMPORT_DIALOG);
    expect(dialog).toHaveTextContent('83%');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await screen.findByTitle('Open from your library');
    expect(server.calls('POST /api/texts')[0].body.currentWordIndex).toBe(5);
  });

  it('keeps the saved position when the reader was reset to the start', async () => {
    storeGuestSession();
    const server = guestServer();
    render(App);

    await fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await fireEvent.keyDown(window, { code: 'KeyG' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await signIn();

    const dialog = screen.getByRole('dialog', IMPORT_DIALOG);
    expect(dialog).toHaveTextContent('50%');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await screen.findByTitle('Open from your library');
    expect(server.calls('POST /api/texts')[0].body.currentWordIndex).toBe(3);
    expect(document.body).toHaveTextContent(/3\s*\/\s*6/);
  });

  it('keeps another text the reader shows and only saves the session', async () => {
    storeGuestSession();
    const server = guestServer();
    render(App);

    await fireEvent.click(await screen.findByTitle('Load Content'));
    await fireEvent.input(screen.getByPlaceholderText('Paste or type your text here...'), { target: { value: 'Another pasted text' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load Text' }));
    await signIn();

    await fireEvent.click(within(screen.getByRole('dialog', IMPORT_DIALOG)).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved "Call me Ishmael. Some years ago" to your library');
    expect(server.calls('POST /api/texts')[0].body.content).toBe(content);
    expect(screen.queryByTitle('Open from your library')).not.toBeInTheDocument();
    expect(document.body).toHaveTextContent(/0\s*\/\s*3/);
    expect(loadSession()).toBeNull();
  });

  it('closes the offer when the session ends', async () => {
    storeGuestSession();
    guestServer();
    render(App);
    await signIn();
    expect(screen.getByRole('dialog', IMPORT_DIALOG)).toBeInTheDocument();

    auth.set({ status: 'guest', user: null });

    await vi.waitFor(() => expect(screen.queryByRole('dialog', IMPORT_DIALOG)).not.toBeInTheDocument());
    expect(loadSession()).toMatchObject({ text: content });
  });

  it('keeps the browser session on "No" and does not ask again', async () => {
    storeGuestSession();
    const server = guestServer();
    render(App);
    await signIn();

    await fireEvent.click(within(screen.getByRole('dialog', IMPORT_DIALOG)).getByRole('button', { name: 'No' }));

    expect(screen.queryByRole('dialog', IMPORT_DIALOG)).not.toBeInTheDocument();
    expect(server.calls('POST /api/texts')).toHaveLength(0);
    expect(loadSession()).toMatchObject({ text: content, currentWordIndex: 3 });

    await signOut();
    await signIn();
    expect(screen.queryByRole('dialog', IMPORT_DIALOG)).not.toBeInTheDocument();
  });

  it('does not ask without a browser session', async () => {
    guestServer();
    render(App);

    await signIn();

    expect(screen.queryByRole('dialog', IMPORT_DIALOG)).not.toBeInTheDocument();
  });

  it('does not ask when the page loads already signed in', async () => {
    storeGuestSession();
    guestServer({ 'GET /api/auth/me': { body: { user: alice } } });
    render(App);

    await screen.findByRole('button', { name: 'Library' });

    expect(screen.queryByRole('dialog', IMPORT_DIALOG)).not.toBeInTheDocument();
    expect(wasImportOffered(content)).toBe(false);
  });
});

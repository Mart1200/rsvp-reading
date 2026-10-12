import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import App from '../../App.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };
const moby = {
  id: 't1', title: 'Moby Dick', totalWords: 6, currentWordIndex: 3, progressPercent: 50,
  lastReadAt: null, createdAt: '2026-01-01T00:00:00Z',
  content: 'Call me Ishmael. Some years ago', chapters: []
};

function signedInServer(routes = {}) {
  return mockFetch({
    'GET /api/auth/me': { body: { user: alice } },
    'GET /api/texts': { body: { texts: [moby] } },
    'GET /api/texts/t1': { body: { text: moby } },
    ...routes
  });
}

async function openMobyFromLibrary() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
  await fireEvent.click(await screen.findByRole('button', { name: /Moby Dick/ }));
  await screen.findByTitle('Open from your library');
}

beforeEach(() => {
  localStorage.clear();
  auth.set({ status: 'loading', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App with the library', () => {
  it('shows library actions only when signed in', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: apiError('UNAUTHENTICATED') } });
    render(App);

    await screen.findByRole('button', { name: /Sign in/ });
    expect(screen.queryByRole('button', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
  });

  it('offers to save the loaded text when signed in', async () => {
    signedInServer();
    render(App);

    await fireEvent.click(await screen.findByRole('button', { name: 'Save to library' }));

    const dialog = screen.getByRole('dialog', { name: 'Save to library' });
    // Pasted/default text: first six words as suggested title
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Rapid serial visual presentation (RSVP) is…');
  });

  it('links the text after saving and hides the save button', async () => {
    const server = signedInServer({
      'POST /api/texts': { status: 201, body: { text: { ...moby, id: 't9', title: 'Rapid serial' } } }
    });
    render(App);

    await fireEvent.click(await screen.findByRole('button', { name: 'Save to library' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTitle('Open from your library')).toHaveTextContent('Rapid serial');
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
    expect(server.calls('POST /api/texts')[0].body.content).toMatch(/^Rapid serial visual presentation/);
  });

  it('opens a library text at its saved position', async () => {
    signedInServer();
    render(App);

    await openMobyFromLibrary();

    expect(screen.getByTitle('Open from your library')).toHaveTextContent('Moby Dick');
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
    // Position 3 of 6 words: the progress bar shows word 3
    expect(document.body).toHaveTextContent(/3\s*\/\s*6/);
  });

  it('saves the position of a library text to the server on Ctrl+S, not to the browser', async () => {
    const server = signedInServer({ 'PUT /api/texts/t1/progress': { status: 204 } });
    render(App);
    await openMobyFromLibrary();

    await fireEvent.keyDown(window, { code: 'KeyS', ctrlKey: true });

    await vi.waitFor(() => expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(1));
    expect(server.calls('PUT /api/texts/t1/progress')[0].body).toEqual({ currentWordIndex: 3 });
    expect(localStorage.getItem('rsvp-reading-session')).toBeNull();
  });

  it('closes the library text when the user signs out', async () => {
    signedInServer();
    render(App);
    await openMobyFromLibrary();

    auth.set({ status: 'guest', user: null });

    await vi.waitFor(() => expect(screen.queryByTitle('Open from your library')).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent(/3\s*\/\s*6/);
  });

  it('keeps the text but unlinks it when it is deleted from the library', async () => {
    signedInServer({ 'DELETE /api/texts/t1': { status: 204 } });
    render(App);
    await openMobyFromLibrary();

    await fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    const row = (await screen.findByRole('button', { name: /Moby Dick/ })).closest('li');
    await fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => expect(screen.queryByTitle('Open from your library')).not.toBeInTheDocument());
    expect(get(auth).status).toBe('user');
    expect(screen.getByRole('button', { name: 'Save to library' })).toBeInTheDocument();
  });
});

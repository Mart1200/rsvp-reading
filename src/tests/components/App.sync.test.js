import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import App from '../../App.svelte';
import { auth } from '../../lib/auth.js';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const content = Array.from({ length: 400 }, (_, i) => `word${i + 1}`).join(' ');
const book = {
  id: 't1', title: 'Long text', totalWords: 400, currentWordIndex: 50, progressPercent: 12,
  lastReadAt: null, createdAt: '2026-01-01T00:00:00Z', content, chapters: []
};
const PROGRESS = 'PUT /api/texts/t1/progress';

const press = (code, options = {}) => fireEvent.keyDown(window, { code, ...options });
const stopButton = () => screen.getByTitle('Stop (back to your saved position)');

// "57 / 400" from the progress bar outside focus mode
function shownPosition() {
  const match = document.body.textContent.match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function server({ settings = {}, routes = {} } = {}) {
  return mockFetch({
    'GET /api/auth/me': { body: { user: { id: 'u1', username: 'alice', settings } } },
    'GET /api/texts': { body: { texts: [book] } },
    'GET /api/texts/t1': { body: { text: book } },
    [PROGRESS]: { status: 204 },
    'PUT /api/auth/settings': { status: 204 },
    'POST /api/auth/logout': { status: 204 },
    ...routes
  });
}

async function openBook() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
  await fireEvent.click(await screen.findByRole('button', { name: /Long text/ }));
  await screen.findByTitle('Open from your library');
}

const positions = (srv) => srv.calls(PROGRESS).map((call) => call.body.currentWordIndex);

let sendBeacon;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  auth.set({ status: 'loading', user: null });
  sendBeacon = vi.fn(() => true);
  vi.stubGlobal('navigator', { ...navigator, sendBeacon });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Progress sync of library texts', () => {
  it('saves every 10 seconds while playing, and only when the position changed', async () => {
    const srv = server();
    render(App);
    await openBook();

    await press('Space');
    await vi.advanceTimersByTimeAsync(9_000);
    expect(srv.calls(PROGRESS)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(positions(srv)).toHaveLength(1);
    expect(positions(srv)[0]).toBeGreaterThan(50);
  });

  it('makes the auto-saved position the target of Stop', async () => {
    const srv = server();
    render(App);
    await openBook();
    await press('Space');
    await vi.advanceTimersByTimeAsync(10_500);
    const [saved] = positions(srv);

    await vi.advanceTimersByTimeAsync(2_000);
    await fireEvent.click(stopButton());

    expect(shownPosition()).toBe(saved);
    // Stop itself sends nothing
    expect(srv.calls(PROGRESS)).toHaveLength(1);
  });

  it('saves right away on pause', async () => {
    const srv = server();
    render(App);
    await openBook();
    await press('Space');
    await vi.advanceTimersByTimeAsync(1_500);

    await press('Space');

    await vi.waitFor(() => expect(positions(srv)).toHaveLength(1));
    expect(positions(srv)[0]).toBeGreaterThan(50);
  });

  it.each([
    ['Esc', () => press('Escape')],
    ['the Exit button', () => fireEvent.click(screen.getByRole('button', { name: 'Exit reading mode' }))]
  ])('saves right away when leaving reading mode with %s', async (_, leave) => {
    const srv = server();
    render(App);
    await openBook();
    await press('Space');
    await vi.advanceTimersByTimeAsync(1_500);

    await leave();

    await vi.waitFor(() => expect(positions(srv)).toEqual([shownPosition()]));
  });

  it('saves a jump right away', async () => {
    const srv = server();
    render(App);
    await openBook();

    await press('KeyG');
    await fireEvent.click(screen.getByRole('button', { name: '50%' }));

    await vi.waitFor(() => expect(positions(srv)).toEqual([200]));
  });

  it('does not save small steps on their own', async () => {
    const srv = server();
    render(App);
    await openBook();

    await press('ArrowRight');
    await vi.advanceTimersByTimeAsync(20_000);

    expect(srv.calls(PROGRESS)).toHaveLength(0);
  });

  it('sends a beacon when the page is hidden', async () => {
    server();
    render(App);
    await openBook();
    await press('ArrowRight');

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith('/api/texts/t1/progress', JSON.stringify({ currentWordIndex: 51 }));
  });

  it('sends no beacon when nothing changed', async () => {
    server();
    render(App);
    await openBook();

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('retries a failed save silently with the next trigger', async () => {
    let fail = true;
    const srv = server({
      routes: { [PROGRESS]: () => (fail ? { status: 500, body: apiError('INTERNAL_ERROR') } : { status: 204 }) }
    });
    render(App);
    await openBook();
    await press('KeyG');
    await fireEvent.click(screen.getByRole('button', { name: '50%' }));
    await vi.waitFor(() => expect(srv.calls(PROGRESS)).toHaveLength(1));

    fail = false;
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledWith('/api/texts/t1/progress', JSON.stringify({ currentWordIndex: 200 }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves the position before another text is loaded', async () => {
    const srv = server();
    render(App);
    await openBook();
    await press('ArrowRight');
    await press('ArrowRight');

    await fireEvent.click(screen.getByTitle('Load Content'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Something else entirely' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load Text' }));

    await vi.waitFor(() => expect(positions(srv)).toEqual([52]));
  });

  it('never syncs texts that are not in the library', async () => {
    const srv = server();
    render(App);
    await screen.findByRole('button', { name: 'Library' });

    await press('Space');
    await vi.advanceTimersByTimeAsync(10_500);
    await press('Space');

    expect(srv.fetch.mock.calls.filter(([path]) => path.includes('/progress'))).toHaveLength(0);
  });
});

describe('Review findings', () => {
  // Server that remembers the stored position like the real one
  function statefulServer(routes = {}) {
    let stored = book.currentWordIndex;
    const order = [];
    const srv = server({
      routes: {
        'GET /api/texts/t1': () => { order.push('GET'); return { body: { text: { ...book, currentWordIndex: stored } } }; },
        [PROGRESS]: (req) => { order.push(`PUT ${req.body.currentWordIndex}`); stored = req.body.currentWordIndex; return { status: 204 }; },
        'PUT /api/auth/settings': () => { order.push('PUT settings'); return { status: 204 }; },
        'POST /api/auth/logout': () => { order.push('logout'); return { status: 204 }; },
        ...routes
      }
    });
    return { srv, order };
  }

  it('re-opening the open text from the library keeps unsaved steps', async () => {
    const { srv, order } = statefulServer();
    render(App);
    await openBook();
    await press('ArrowRight');
    await press('ArrowRight');

    await openBook();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    window.dispatchEvent(new Event('pagehide'));

    // Saved before the text was fetched again, so the server position is the current one
    expect(order.indexOf('PUT 52')).toBeLessThan(order.lastIndexOf('GET'));
    expect(shownPosition()).toBe(52);
    expect(positions(srv)).toEqual([52]);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('signing out saves progress and settings first', async () => {
    const { order } = statefulServer();
    render(App);
    await openBook();
    order.length = 0;
    await press('ArrowRight');
    await press('ArrowUp');

    await fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    await vi.waitFor(() => expect(order).toContain('logout'));
    expect(order.slice(0, 2).sort()).toEqual(['PUT 51', 'PUT settings']);
    expect(order[2]).toBe('logout');
  });

  it('hiding the page sends pending settings with a beacon', async () => {
    server({ settings: { wordsPerMinute: 300 } });
    render(App);
    await screen.findByRole('button', { name: 'Library' });
    await press('ArrowUp');

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledWith('/api/auth/settings', expect.stringContaining('"wordsPerMinute":325'));
  });

  it('a failed manual save says so', async () => {
    server({ routes: { [PROGRESS]: { status: 500, body: apiError('INTERNAL_ERROR') } } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(App);
    await openBook();

    await press('KeyS', { ctrlKey: true });

    expect(await screen.findByRole('status')).toHaveTextContent('Could not save progress');
  });

  it('a successful manual save says so', async () => {
    server();
    render(App);
    await openBook();

    await press('KeyS', { ctrlKey: true });

    expect(await screen.findByRole('status')).toHaveTextContent('Progress saved');
  });
});

describe('Settings sync', () => {
  const wpm = () => Number(document.querySelector('.stat.wpm').textContent.match(/\d+/)[0]);

  it('applies the settings stored for the account', async () => {
    const srv = server({ settings: { wordsPerMinute: 450 } });
    render(App);

    await vi.waitFor(() => expect(wpm()).toBe(450));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(srv.calls('PUT /api/auth/settings')).toHaveLength(0);
  });

  it('uploads the local settings when the account has none', async () => {
    const srv = server();
    render(App);

    await vi.waitFor(() => expect(srv.calls('PUT /api/auth/settings')).toHaveLength(1));
    expect(srv.calls('PUT /api/auth/settings')[0].body.settings).toMatchObject({ wordsPerMinute: 300, fadeEnabled: true });
  });

  it('saves changes once, a second after the last one', async () => {
    const srv = server({ settings: { wordsPerMinute: 300 } });
    render(App);
    await screen.findByRole('button', { name: 'Library' });

    await press('ArrowUp');
    await vi.advanceTimersByTimeAsync(500);
    await press('ArrowUp');
    await vi.advanceTimersByTimeAsync(900);
    expect(srv.calls('PUT /api/auth/settings')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(srv.calls('PUT /api/auth/settings')).toHaveLength(1);
    expect(srv.calls('PUT /api/auth/settings')[0].body.settings.wordsPerMinute).toBe(350);
  });

  it('brings the local settings back after signing out', async () => {
    server({ settings: { wordsPerMinute: 450 } });
    render(App);
    await vi.waitFor(() => expect(wpm()).toBe(450));

    auth.set({ status: 'guest', user: null });

    await vi.waitFor(() => expect(wpm()).toBe(300));
  });

  it('keeps the guest settings in the browser session while signed in', async () => {
    server({ settings: { wordsPerMinute: 450 } });
    render(App);
    await vi.waitFor(() => expect(wpm()).toBe(450));

    await press('KeyS', { ctrlKey: true });

    const stored = JSON.parse(localStorage.getItem('rsvp-reading-session'));
    expect(stored.settings.wordsPerMinute).toBe(300);
  });
});

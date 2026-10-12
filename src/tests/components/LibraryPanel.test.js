import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import LibraryPanel from '../../lib/components/LibraryPanel.svelte';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const moby = {
  id: 't1', title: 'Moby Dick', totalWords: 1200, currentWordIndex: 600, progressPercent: 50,
  lastReadAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(), createdAt: '2026-01-01T00:00:00Z'
};
const essay = {
  id: 't2', title: 'Short essay', totalWords: 300, currentWordIndex: 0, progressPercent: 0,
  lastReadAt: null, createdAt: '2026-01-01T00:00:00Z'
};

function renderPanel(props = {}) {
  const events = { open: vi.fn(), renamed: vi.fn(), reset: vi.fn(), deleted: vi.fn(), close: vi.fn() };
  render(LibraryPanel, { props, events });
  return events;
}

const row = (title) => screen.getByText(title).closest('li');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LibraryPanel', () => {
  it('lists texts with word count, progress and last read', async () => {
    mockFetch({ 'GET /api/texts': { body: { texts: [moby, essay] } } });
    renderPanel();

    const mobyRow = (await screen.findByText('Moby Dick')).closest('li');
    expect(mobyRow).toHaveTextContent('1,200 words · 50% · 2 days ago');
    expect(within(mobyRow).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(row('Short essay')).toHaveTextContent('300 words · 0% · Never');
  });

  it('shows a loading state first', () => {
    mockFetch({ 'GET /api/texts': () => new Promise(() => {}) });
    renderPanel();

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('explains the empty library', async () => {
    mockFetch({ 'GET /api/texts': { body: { texts: [] } } });
    renderPanel();

    expect(await screen.findByText('Your library is empty.')).toBeInTheDocument();
    expect(screen.getByText(/Save to library/)).toBeInTheDocument();
  });

  it('shows load errors with a retry', async () => {
    const server = mockFetch({ 'GET /api/texts': { status: 500, body: apiError('INTERNAL_ERROR', 'Internal server error') } });
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');

    server.route('GET /api/texts', { body: { texts: [moby] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Moby Dick')).toBeInTheDocument();
  });

  it('marks the text that is open in the reader', async () => {
    mockFetch({ 'GET /api/texts': { body: { texts: [moby, essay] } } });
    renderPanel({ currentTextId: 't1' });

    await screen.findByText('Moby Dick');
    expect(within(row('Moby Dick')).getByText('Open')).toBeInTheDocument();
    expect(within(row('Short essay')).queryByText('Open')).not.toBeInTheDocument();
  });

  it('opens a text with its content', async () => {
    const full = { ...moby, content: 'Call me Ishmael', chapters: [] };
    mockFetch({
      'GET /api/texts': { body: { texts: [moby] } },
      'GET /api/texts/t1': { body: { text: full } }
    });
    const events = renderPanel();

    await fireEvent.click(await screen.findByRole('button', { name: /Moby Dick/ }));

    await vi.waitFor(() => expect(events.open).toHaveBeenCalled());
    expect(events.open.mock.calls[0][0].detail).toEqual(full);
  });

  it('drops a text that was deleted elsewhere when opening it', async () => {
    mockFetch({
      'GET /api/texts': { body: { texts: [moby, essay] } },
      'GET /api/texts/t1': { status: 404, body: apiError('NOT_FOUND', 'Text not found') }
    });
    const events = renderPanel();

    await fireEvent.click(await screen.findByRole('button', { name: /Moby Dick/ }));

    await vi.waitFor(() => expect(screen.queryByText('Moby Dick')).not.toBeInTheDocument());
    expect(events.deleted.mock.calls[0][0].detail).toBe('t1');
    expect(events.open).not.toHaveBeenCalled();
  });

  it('shows other errors at the row', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path) => {
      if (path === '/api/texts') return new Response(JSON.stringify({ texts: [moby] }), { headers: { 'Content-Type': 'application/json' } });
      throw new TypeError('offline');
    }));
    renderPanel();

    await fireEvent.click(await screen.findByRole('button', { name: /Moby Dick/ }));

    expect(await within(row('Moby Dick')).findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  describe('rename', () => {
    it('renames inline and reports the new title', async () => {
      const server = mockFetch({
        'GET /api/texts': { body: { texts: [moby] } },
        'PATCH /api/texts/t1': { body: { text: { ...moby, title: 'The Whale' } } }
      });
      const events = renderPanel();
      await screen.findByText('Moby Dick');

      await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
      await fireEvent.input(screen.getByLabelText('Title'), { target: { value: '  The Whale ' } });
      await fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' });

      expect(await screen.findByText('The Whale')).toBeInTheDocument();
      expect(server.calls('PATCH /api/texts/t1')[0].body).toEqual({ title: 'The Whale' });
      expect(events.renamed.mock.calls[0][0].detail).toEqual({ id: 't1', title: 'The Whale' });
    });

    it('cancels with Escape without closing the dialog', async () => {
      const server = mockFetch({ 'GET /api/texts': { body: { texts: [moby] } } });
      const events = renderPanel();
      await screen.findByText('Moby Dick');

      await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
      await fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' });

      expect(screen.getByText('Moby Dick')).toBeInTheDocument();
      expect(events.close).not.toHaveBeenCalled();
      expect(server.calls('PATCH /api/texts/t1')).toHaveLength(0);
    });

    it('does not call the API for an empty or unchanged title', async () => {
      const server = mockFetch({ 'GET /api/texts': { body: { texts: [moby] } } });
      renderPanel();
      await screen.findByText('Moby Dick');

      await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
      await fireEvent.input(screen.getByLabelText('Title'), { target: { value: '   ' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.getByText('Moby Dick')).toBeInTheDocument();
      expect(server.calls('PATCH /api/texts/t1')).toHaveLength(0);
    });
  });

  describe('reset progress', () => {
    it('asks for confirmation, then resets to 0 %', async () => {
      const server = mockFetch({
        'GET /api/texts': { body: { texts: [moby] } },
        'PUT /api/texts/t1/progress': { status: 204 }
      });
      const events = renderPanel();
      await screen.findByText('Moby Dick');

      await fireEvent.click(screen.getByRole('button', { name: 'Reset progress' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Start this text from the beginning?');
      expect(server.calls('PUT /api/texts/t1/progress')).toHaveLength(0);

      await fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      await vi.waitFor(() => expect(events.reset).toHaveBeenCalled());
      expect(server.calls('PUT /api/texts/t1/progress')[0].body).toEqual({ currentWordIndex: 0 });
      expect(row('Moby Dick')).toHaveTextContent('· 0% ·');
    });

    it('is disabled for texts at the beginning', async () => {
      mockFetch({ 'GET /api/texts': { body: { texts: [essay] } } });
      renderPanel();
      await screen.findByText('Short essay');

      expect(screen.getByRole('button', { name: 'Reset progress' })).toBeDisabled();
    });
  });

  describe('delete', () => {
    it('asks for confirmation, then removes the text', async () => {
      const server = mockFetch({
        'GET /api/texts': { body: { texts: [moby, essay] } },
        'DELETE /api/texts/t1': { status: 204 }
      });
      const events = renderPanel();
      await screen.findByText('Moby Dick');

      await fireEvent.click(within(row('Moby Dick')).getByRole('button', { name: 'Delete' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Delete this text and its reading progress?');

      await fireEvent.click(within(row('Moby Dick')).getByRole('button', { name: 'Delete' }));

      await vi.waitFor(() => expect(screen.queryByText('Moby Dick')).not.toBeInTheDocument());
      expect(server.calls('DELETE /api/texts/t1')).toHaveLength(1);
      expect(events.deleted.mock.calls[0][0].detail).toBe('t1');
      expect(screen.getByText('Short essay')).toBeInTheDocument();
    });

    it('can be cancelled', async () => {
      const server = mockFetch({ 'GET /api/texts': { body: { texts: [moby] } } });
      renderPanel();
      await screen.findByText('Moby Dick');

      await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('Moby Dick')).toBeInTheDocument();
      expect(server.calls('DELETE /api/texts/t1')).toHaveLength(0);
    });
  });
});

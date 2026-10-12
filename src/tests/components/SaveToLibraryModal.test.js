import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SaveToLibraryModal from '../../lib/components/SaveToLibraryModal.svelte';
import { mockFetch, apiError } from '../helpers/fetch-mock.js';

const props = {
  title: 'Moby Dick',
  content: 'Call me Ishmael. Some years ago',
  chapters: [{ title: 'Loomings', wordIndex: 0, level: 0 }],
  currentWordIndex: 3,
  totalWords: 6
};

function renderModal(overrides = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(SaveToLibraryModal, { props: { ...props, ...overrides }, events: { saved: onSaved, close: onClose } });
  return { onSaved, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SaveToLibraryModal', () => {
  it('prefills the suggested title and shows what will be saved', () => {
    mockFetch();
    renderModal();

    expect(screen.getByLabelText('Title')).toHaveValue('Moby Dick');
    expect(screen.getByText(/6 words, saved at word 3/)).toBeInTheDocument();
  });

  it('saves text, chapters and position with the edited title', async () => {
    const saved = { id: 't1', title: 'The Whale' };
    const server = mockFetch({ 'POST /api/texts': { status: 201, body: { text: saved } } });
    const { onSaved } = renderModal();

    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: '  The Whale ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0].detail).toEqual(saved);
    expect(server.calls('POST /api/texts')[0].body).toEqual({
      title: 'The Whale',
      content: props.content,
      chapters: props.chapters,
      currentWordIndex: 3
    });
  });

  it('requires a title', async () => {
    const server = mockFetch();
    renderModal({ title: '' });

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Use 1–200 characters')).toBeInTheDocument();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('shows server errors', async () => {
    mockFetch({ 'POST /api/texts': { status: 400, body: apiError('VALIDATION', 'Content must contain at least one word') } });
    const { onSaved } = renderModal();

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Content must contain at least one word');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('can be cancelled', async () => {
    mockFetch();
    const { onClose } = renderModal();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});

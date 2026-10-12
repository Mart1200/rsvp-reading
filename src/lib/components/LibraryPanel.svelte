<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import {
    listTexts, getText, renameText, deleteText, saveProgress,
    formatRelativeTime, formatWordCount, TITLE_MAX_LENGTH
  } from '../library.js';

  /** ID of the library text currently open in the reader */
  export let currentTextId = null;

  const dispatch = createEventDispatcher();

  /** @type {import('../library.js').TextSummary[]} */
  let texts = [];
  let loading = true;
  let loadError = '';
  let rowError = { id: null, message: '' };

  // Only one row is in a special state at a time
  let editingId = null;
  let editTitle = '';
  /** @type {{id: string, action: 'reset'|'delete'}|null} */
  let confirming = null;
  let busyId = null;

  onMount(load);

  async function load() {
    loading = true;
    loadError = '';
    try {
      texts = await listTexts();
    } catch (error) {
      loadError = error.message;
    } finally {
      loading = false;
    }
  }

  function resetRowState() {
    editingId = null;
    confirming = null;
    rowError = { id: null, message: '' };
  }

  // A text that vanished (deleted on another device) is dropped from the list
  function handleRowError(id, error) {
    if (error.status === 404) {
      texts = texts.filter((t) => t.id !== id);
      loadError = '';
      rowError = { id: null, message: '' };
      dispatch('deleted', id);
      return;
    }
    rowError = { id, message: error.message };
  }

  async function open(id) {
    resetRowState();
    busyId = id;
    try {
      dispatch('open', await getText(id));
    } catch (error) {
      handleRowError(id, error);
    } finally {
      busyId = null;
    }
  }

  function startRename(text) {
    resetRowState();
    editingId = text.id;
    editTitle = text.title;
  }

  async function saveRename(text) {
    const title = editTitle.trim();
    if (!title || title === text.title) {
      editingId = null;
      return;
    }
    busyId = text.id;
    try {
      const updated = await renameText(text.id, title);
      texts = texts.map((t) => (t.id === text.id ? { ...t, title: updated.title } : t));
      editingId = null;
      dispatch('renamed', { id: text.id, title: updated.title });
    } catch (error) {
      handleRowError(text.id, error);
    } finally {
      busyId = null;
    }
  }

  function handleRenameKeydown(e, text) {
    if (e.key === 'Escape') {
      // Cancel the rename only, keep the dialog open
      e.stopPropagation();
      editingId = null;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      saveRename(text);
    }
  }

  function askConfirm(id, action) {
    resetRowState();
    confirming = { id, action };
  }

  async function confirmAction() {
    const { id, action } = confirming;
    busyId = id;
    try {
      if (action === 'delete') {
        await deleteText(id);
        texts = texts.filter((t) => t.id !== id);
        dispatch('deleted', id);
      } else {
        await saveProgress(id, 0);
        texts = texts.map((t) => (t.id === id ? { ...t, currentWordIndex: 0, progressPercent: 0 } : t));
        dispatch('reset', id);
      }
      confirming = null;
    } catch (error) {
      confirming = null;
      handleRowError(id, error);
    } finally {
      busyId = null;
    }
  }
</script>

<Modal title="Library" wide on:close>
  {#if loading}
    <p class="state" role="status">Loading your library…</p>
  {:else if loadError}
    <div class="state">
      <p class="form-error" role="alert">{loadError}</p>
      <div class="actions">
        <button type="button" class="secondary" on:click={load}>Try again</button>
      </div>
    </div>
  {:else if texts.length === 0}
    <div class="state empty">
      <p><strong>Your library is empty.</strong></p>
      <p class="notice">
        Load a text or a PDF/EPUB file, then use “Save to library” in the header.
        Your reading position is kept with your account, so you can continue on any device.
      </p>
    </div>
  {:else}
    <ul class="texts">
      {#each texts as text (text.id)}
        <li class:current={text.id === currentTextId} aria-busy={busyId === text.id}>
          {#if editingId === text.id}
            <div class="rename">
              <input
                type="text"
                bind:value={editTitle}
                maxlength={TITLE_MAX_LENGTH}
                aria-label="Title"
                on:keydown={(e) => handleRenameKeydown(e, text)}
              />
              <div class="actions">
                <button type="button" class="secondary" on:click={() => (editingId = null)}>Cancel</button>
                <button type="button" class="primary" on:click={() => saveRename(text)} disabled={busyId === text.id}>Save</button>
              </div>
            </div>
          {:else}
            <button type="button" class="open" on:click={() => open(text.id)} disabled={busyId === text.id}>
              <span class="title">{text.title}</span>
              {#if text.id === currentTextId}<span class="badge">Open</span>{/if}
            </button>
            <div class="meta">
              {formatWordCount(text.totalWords)} · {text.progressPercent}% · {formatRelativeTime(text.lastReadAt)}
            </div>
            <div
              class="bar"
              role="progressbar"
              aria-label="Progress of {text.title}"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={text.progressPercent}
            >
              <div class="fill" style="width: {text.progressPercent}%"></div>
            </div>

            {#if confirming?.id === text.id}
              <div class="confirm" role="alert">
                <span>
                  {confirming.action === 'delete'
                    ? 'Delete this text and its reading progress?'
                    : 'Start this text from the beginning?'}
                </span>
                <div class="actions">
                  <button type="button" class="secondary" on:click={() => (confirming = null)}>Cancel</button>
                  <button
                    type="button"
                    class={confirming.action === 'delete' ? 'danger' : 'primary'}
                    on:click={confirmAction}
                    disabled={busyId === text.id}
                  >
                    {confirming.action === 'delete' ? 'Delete' : 'Reset'}
                  </button>
                </div>
              </div>
            {:else}
              <div class="row-actions">
                <button type="button" on:click={() => startRename(text)}>Rename</button>
                <button type="button" on:click={() => askConfirm(text.id, 'reset')} disabled={text.currentWordIndex === 0}>
                  Reset progress
                </button>
                <button type="button" class="delete" on:click={() => askConfirm(text.id, 'delete')}>Delete</button>
              </div>
            {/if}
          {/if}

          {#if rowError.id === text.id}
            <p class="form-error" role="alert">{rowError.message}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .state {
    color: #aaa;
    margin: 0.5rem 0;
  }

  .state p {
    margin: 0 0 0.5rem 0;
  }

  .empty strong {
    color: #ddd;
    font-weight: 500;
  }

  .texts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  li {
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  li.current {
    border-color: #ff4444;
  }

  li[aria-busy='true'] {
    opacity: 0.7;
  }

  .open {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    color: #fff;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .open:hover .title {
    color: #ff6666;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex-shrink: 0;
    font-size: 0.7rem;
    color: #ff4444;
    border: 1px solid #ff4444;
    border-radius: 4px;
    padding: 0 0.3rem;
  }

  .meta {
    color: #777;
    font-size: 0.8rem;
  }

  .bar {
    height: 4px;
    background: #2a2a2a;
    border-radius: 2px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: #ff4444;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
  }

  .row-actions button {
    background: none;
    border: none;
    padding: 0.2rem 0;
    color: #888;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .row-actions button:hover:not(:disabled) {
    color: #fff;
  }

  .row-actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .row-actions .delete:hover {
    color: #ff6b6b !important;
  }

  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    color: #ddd;
    font-size: 0.85rem;
  }

  .confirm .actions,
  .rename .actions {
    margin: 0;
  }

  .rename {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>

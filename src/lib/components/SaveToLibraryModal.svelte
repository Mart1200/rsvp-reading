<script>
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import { saveText, TITLE_MAX_LENGTH } from '../library.js';

  /** Suggested title, editable */
  export let title = '';
  export let content;
  export let chapters = [];
  export let currentWordIndex = 0;
  export let totalWords = 0;

  const dispatch = createEventDispatcher();
  const errorId = `save-title-error-${Math.random().toString(36).slice(2)}`;

  let titleError = '';
  let formError = '';
  let busy = false;

  async function submit() {
    formError = '';
    const trimmed = title.trim();
    titleError = trimmed.length === 0 || [...trimmed].length > TITLE_MAX_LENGTH
      ? `Use 1–${TITLE_MAX_LENGTH} characters`
      : '';
    if (titleError) return;

    busy = true;
    try {
      const saved = await saveText({ title: trimmed, content, chapters, currentWordIndex });
      dispatch('saved', saved);
    } catch (error) {
      formError = error.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Save to library" on:close>
  <form on:submit|preventDefault={submit} novalidate>
    <div class="field">
      <label>
        Title
        <input
          type="text"
          bind:value={title}
          maxlength={TITLE_MAX_LENGTH}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? errorId : undefined}
        />
      </label>
      {#if titleError}<span class="field-error" id={errorId}>{titleError}</span>{/if}
    </div>

    <p class="notice">
      {totalWords.toLocaleString('en')} words{#if currentWordIndex > 0}, saved at word {currentWordIndex.toLocaleString('en')}{/if}.
      Your reading position will be kept with your account.
    </p>

    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}

    <div class="actions">
      <button type="button" class="secondary" on:click={() => dispatch('close')}>Cancel</button>
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </form>
</Modal>

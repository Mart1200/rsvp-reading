<script>
  import { createEventDispatcher, onMount } from 'svelte';

  export let title;
  /** Wider dialog, e.g. for lists */
  export let wide = false;

  const dispatch = createEventDispatcher();
  const titleId = `modal-title-${Math.random().toString(36).slice(2)}`;
  let panel;

  onMount(() => {
    panel.querySelector('input, select, textarea, button:not(.close-btn)')?.focus();
  });

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dispatch('close');
    }
    // Keep reader shortcuts (Space, arrows, ...) from firing while the dialog is open
    e.stopPropagation();
  }
</script>

<div class="modal-overlay" role="presentation" on:keydown={handleKeydown}>
  <div class="modal" class:wide role="dialog" aria-modal="true" aria-labelledby={titleId} bind:this={panel}>
    <div class="modal-header">
      <h3 id={titleId}>{title}</h3>
      <button type="button" class="close-btn" on:click={() => dispatch('close')} aria-label="Close" title="Close">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <slot />
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }

  .modal {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1.5rem;
    width: 100%;
    max-width: 360px;
    max-height: 100%;
    overflow-y: auto;
  }

  .modal.wide {
    max-width: 560px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  h3 {
    margin: 0;
    color: #fff;
    font-size: 1.1rem;
    font-weight: 500;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
  }

  .close-btn:hover {
    color: #fff;
  }

  .close-btn svg {
    width: 20px;
    height: 20px;
  }

  /* Shared form styles for dialog content */
  .modal :global(form) {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .modal :global(.field) {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .modal :global(label) {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: #aaa;
    font-size: 0.85rem;
  }

  .modal :global(input[type='text']),
  .modal :global(input[type='password']) {
    width: 100%;
    padding: 0.7rem 0.75rem;
    background: #111;
    border: 1px solid #333;
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
  }

  .modal :global(input:focus) {
    outline: none;
    border-color: #ff4444;
  }

  .modal :global(input[aria-invalid='true']) {
    border-color: #ff6b6b;
  }

  .modal :global(.field-error) {
    color: #ff6b6b;
    font-size: 0.8rem;
  }

  .modal :global(.form-error) {
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.4);
    color: #ff8080;
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
    margin: 0;
  }

  .modal :global(.notice) {
    color: #888;
    font-size: 0.8rem;
    margin: 0;
  }

  .modal :global(.actions) {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }

  .modal :global(.actions button) {
    padding: 0.55rem 1rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.2s;
  }

  .modal :global(.actions button:disabled) {
    opacity: 0.6;
    cursor: default;
  }

  .modal :global(button.primary) {
    background: #ff4444;
    color: #fff;
  }

  .modal :global(button.primary:hover:not(:disabled)) {
    background: #ff6666;
  }

  .modal :global(button.secondary) {
    background: #333;
    color: #fff;
  }

  .modal :global(button.secondary:hover:not(:disabled)) {
    background: #444;
  }

  .modal :global(button.danger) {
    background: #b3261e;
    color: #fff;
  }

  .modal :global(button.danger:hover:not(:disabled)) {
    background: #d0342b;
  }
</style>

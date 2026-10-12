<script>
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import { deleteAccount } from '../auth.js';

  const dispatch = createEventDispatcher();
  const uid = Math.random().toString(36).slice(2);
  const errorId = (field) => `${field}-error-${uid}`;

  let password = '';
  let passwordError = '';
  let formError = '';
  let busy = false;
  // Second step: explicit confirmation after the password was entered
  let confirming = false;

  function requestConfirmation() {
    formError = '';
    passwordError = password ? '' : 'Enter your password';
    if (!passwordError) confirming = true;
  }

  async function confirmDelete() {
    busy = true;
    try {
      await deleteAccount(password);
      dispatch('deleted');
    } catch (error) {
      confirming = false;
      if (error.code === 'INVALID_PASSWORD') passwordError = 'Password is wrong';
      else formError = error.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Delete account" on:close>
  {#if confirming}
    <p class="warning" role="alert">
      Are you sure? Your account, all saved texts and your reading progress will be deleted permanently.
      This cannot be undone.
    </p>
    <div class="actions">
      <button type="button" class="secondary" on:click={() => (confirming = false)} disabled={busy}>Cancel</button>
      <button type="button" class="danger" on:click={confirmDelete} disabled={busy}>
        {busy ? 'Deleting…' : 'Delete permanently'}
      </button>
    </div>
  {:else}
    <form on:submit|preventDefault={requestConfirmation} novalidate>
      <p class="notice">
        This deletes your account together with all saved texts and reading progress.
        Enter your password to continue.
      </p>

      <div class="field">
        <label>
          Password
          <input type="password" bind:value={password} autocomplete="current-password" aria-invalid={!!passwordError}
            aria-describedby={passwordError ? errorId('password') : undefined} />
        </label>
        {#if passwordError}<span class="field-error" id={errorId('password')}>{passwordError}</span>{/if}
      </div>

      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}

      <div class="actions">
        <button type="button" class="secondary" on:click={() => dispatch('close')}>Cancel</button>
        <button type="submit" class="danger">Delete account</button>
      </div>
    </form>
  {/if}
</Modal>

<style>
  .warning {
    color: #ff8080;
    font-size: 0.9rem;
    margin: 0 0 1rem 0;
  }
</style>

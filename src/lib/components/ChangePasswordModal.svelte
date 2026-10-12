<script>
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import { changePassword, validatePassword } from '../auth.js';

  const dispatch = createEventDispatcher();
  const uid = Math.random().toString(36).slice(2);
  const errorId = (field) => `${field}-error-${uid}`;

  let currentPassword = '';
  let newPassword = '';
  let repeatPassword = '';
  let errors = {};
  let formError = '';
  let busy = false;
  let done = false;

  function validate() {
    const result = {};
    if (!currentPassword) result.currentPassword = 'Enter your current password';
    const passwordError = validatePassword(newPassword);
    if (passwordError) result.newPassword = passwordError;
    else if (repeatPassword !== newPassword) result.repeatPassword = 'Passwords do not match';
    return result;
  }

  async function submit() {
    formError = '';
    errors = validate();
    if (Object.keys(errors).length > 0) return;

    busy = true;
    try {
      await changePassword(currentPassword, newPassword);
      done = true;
    } catch (error) {
      if (error.code === 'INVALID_PASSWORD') errors = { currentPassword: 'Current password is wrong' };
      else formError = error.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Change password" on:close>
  {#if done}
    <p class="notice" role="status">Your password was changed. Other devices have been signed out.</p>
    <div class="actions">
      <button type="button" class="primary" on:click={() => dispatch('close')}>Done</button>
    </div>
  {:else}
    <form on:submit|preventDefault={submit} novalidate>
      <div class="field">
        <label>
          Current password
          <input type="password" bind:value={currentPassword} autocomplete="current-password" aria-invalid={!!errors.currentPassword}
            aria-describedby={errors.currentPassword ? errorId('currentPassword') : undefined} />
        </label>
        {#if errors.currentPassword}<span class="field-error" id={errorId('currentPassword')}>{errors.currentPassword}</span>{/if}
      </div>

      <div class="field">
        <label>
          New password
          <input type="password" bind:value={newPassword} autocomplete="new-password" aria-invalid={!!errors.newPassword}
            aria-describedby={errors.newPassword ? errorId('newPassword') : undefined} />
        </label>
        {#if errors.newPassword}<span class="field-error" id={errorId('newPassword')}>{errors.newPassword}</span>{/if}
      </div>

      <div class="field">
        <label>
          Repeat new password
          <input type="password" bind:value={repeatPassword} autocomplete="new-password" aria-invalid={!!errors.repeatPassword}
            aria-describedby={errors.repeatPassword ? errorId('repeatPassword') : undefined} />
        </label>
        {#if errors.repeatPassword}<span class="field-error" id={errorId('repeatPassword')}>{errors.repeatPassword}</span>{/if}
      </div>

      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}

      <div class="actions">
        <button type="button" class="secondary" on:click={() => dispatch('close')}>Cancel</button>
        <button type="submit" class="primary" disabled={busy}>{busy ? 'Please wait…' : 'Change password'}</button>
      </div>
    </form>
  {/if}
</Modal>

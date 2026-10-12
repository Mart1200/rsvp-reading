<script>
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import { login, register, validateUsername, validatePassword } from '../auth.js';

  /** @type {'login'|'register'} */
  export let mode = 'login';

  const dispatch = createEventDispatcher();
  const uid = Math.random().toString(36).slice(2);
  const errorId = (field) => `${field}-error-${uid}`;

  let username = '';
  let password = '';
  let repeatPassword = '';
  let errors = {};
  let formError = '';
  let busy = false;

  $: isRegister = mode === 'register';

  function switchMode(next) {
    mode = next;
    errors = {};
    formError = '';
    repeatPassword = '';
  }

  function validate() {
    const result = {};
    if (isRegister) {
      const usernameError = validateUsername(username);
      const passwordError = validatePassword(password);
      if (usernameError) result.username = usernameError;
      if (passwordError) result.password = passwordError;
      if (!passwordError && repeatPassword !== password) result.repeatPassword = 'Passwords do not match';
    } else {
      if (!username) result.username = 'Enter your username';
      if (!password) result.password = 'Enter your password';
    }
    return result;
  }

  async function submit() {
    formError = '';
    errors = validate();
    if (Object.keys(errors).length > 0) return;

    busy = true;
    try {
      const user = isRegister ? await register(username, password) : await login(username, password);
      dispatch('done', user);
    } catch (error) {
      if (error.code === 'USERNAME_TAKEN') errors = { username: error.message };
      else formError = error.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={isRegister ? 'Create account' : 'Sign in'} on:close>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected={!isRegister} class:active={!isRegister} on:click={() => switchMode('login')}>
      Sign in
    </button>
    <button type="button" role="tab" aria-selected={isRegister} class:active={isRegister} on:click={() => switchMode('register')}>
      Register
    </button>
  </div>

  <form on:submit|preventDefault={submit} novalidate>
    <div class="field">
      <label>
        Username
        <input
          type="text"
          bind:value={username}
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? errorId('username') : undefined}
        />
      </label>
      {#if errors.username}<span class="field-error" id={errorId('username')}>{errors.username}</span>{/if}
    </div>

    <div class="field">
      <label>
        Password
        <input
          type="password"
          bind:value={password}
          autocomplete={isRegister ? 'new-password' : 'current-password'}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? errorId('password') : undefined}
        />
      </label>
      {#if errors.password}<span class="field-error" id={errorId('password')}>{errors.password}</span>{/if}
    </div>

    {#if isRegister}
      <div class="field">
        <label>
          Repeat password
          <input
            type="password"
            bind:value={repeatPassword}
            autocomplete="new-password"
            aria-invalid={!!errors.repeatPassword}
            aria-describedby={errors.repeatPassword ? errorId('repeatPassword') : undefined}
          />
        </label>
        {#if errors.repeatPassword}<span class="field-error" id={errorId('repeatPassword')}>{errors.repeatPassword}</span>{/if}
      </div>

      <p class="notice" data-testid="no-recovery-notice">
        There is no password recovery. Make sure you remember your password.
      </p>
    {/if}

    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}

    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>
        {#if busy}Please wait…{:else}{isRegister ? 'Create account' : 'Sign in'}{/if}
      </button>
    </div>
  </form>
</Modal>

<style>
  .tabs {
    display: flex;
    gap: 0.25rem;
    background: #111;
    border-radius: 8px;
    padding: 0.25rem;
    margin-bottom: 1rem;
  }

  .tabs button {
    flex: 1;
    background: transparent;
    border: none;
    color: #888;
    padding: 0.45rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .tabs button.active {
    background: #333;
    color: #fff;
  }
</style>

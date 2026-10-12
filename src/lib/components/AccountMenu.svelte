<script>
  import { createEventDispatcher } from 'svelte';
  import { auth, logout } from '../auth.js';
  import AuthModal from './AuthModal.svelte';
  import ChangePasswordModal from './ChangePasswordModal.svelte';
  import DeleteAccountModal from './DeleteAccountModal.svelte';

  const dispatch = createEventDispatcher();

  /** @type {null|'login'|'password'|'delete'} */
  let dialog = null;
  let menuOpen = false;
  let menuError = '';
  let root;

  // Session ended elsewhere while an account dialog was open: offer to sign in again
  $: if ($auth.status === 'guest' && (dialog === 'password' || dialog === 'delete')) {
    dialog = 'login';
  }

  function openDialog(name) {
    menuOpen = false;
    menuError = '';
    dialog = name;
  }

  async function handleLogout() {
    menuError = '';
    try {
      await logout();
      menuOpen = false;
    } catch (error) {
      menuError = error.message;
    }
  }


  function handleWindowClick(e) {
    if (menuOpen && root && !root.contains(e.target)) menuOpen = false;
  }

  function handleMenuKeydown(e) {
    if (e.key === 'Escape') {
      menuOpen = false;
      e.stopPropagation();
    }
  }
</script>

<svelte:window on:click={handleWindowClick} />

<div class="account" bind:this={root}>
  {#if $auth.status === 'guest'}
    <button class="account-btn" on:click={() => openDialog('login')} title="Sign in to save texts and progress">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
      <span class="label">Sign in</span>
    </button>
  {:else if $auth.status === 'user'}
    <button
      class="account-btn"
      class:active={menuOpen}
      on:click={() => (menuOpen = !menuOpen)}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      title="Account"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
      <span class="label username">{$auth.user.username}</span>
    </button>

    {#if menuOpen}
      <div class="menu" role="menu" tabindex="-1" on:keydown={handleMenuKeydown}>
        <div class="menu-user">Signed in as <strong>{$auth.user.username}</strong></div>
        <button role="menuitem" on:click={() => { menuOpen = false; dispatch('library'); }}>Library</button>
        <button role="menuitem" on:click={() => openDialog('password')}>Change password</button>
        <button role="menuitem" on:click={handleLogout}>Log out</button>
        <button role="menuitem" class="danger" on:click={() => openDialog('delete')}>Delete account</button>
        {#if menuError}<p class="menu-error" role="alert">{menuError}</p>{/if}
      </div>
    {/if}
  {/if}
</div>

{#if dialog === 'login'}
  <AuthModal on:close={() => (dialog = null)} on:done={() => (dialog = null)} />
{:else if dialog === 'password'}
  <ChangePasswordModal on:close={() => (dialog = null)} />
{:else if dialog === 'delete'}
  <DeleteAccountModal on:close={() => (dialog = null)} on:deleted={() => (dialog = null)} />
{/if}

<style>
  .account {
    position: relative;
    display: flex;
  }

  .account-btn {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .account-btn:hover {
    border-color: #555;
    color: #fff;
  }

  .account-btn.active {
    border-color: #ff4444;
    color: #ff4444;
  }

  .account-btn svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .username {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    min-width: 200px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 0.35rem;
    z-index: 150;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .menu-user {
    color: #777;
    font-size: 0.8rem;
    padding: 0.5rem 0.65rem;
    border-bottom: 1px solid #2a2a2a;
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-user strong {
    color: #ccc;
    font-weight: 500;
  }

  .menu button {
    background: transparent;
    border: none;
    color: #ddd;
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .menu button:hover {
    background: #2a2a2a;
  }

  .menu button.danger {
    color: #ff6b6b;
  }

  .menu-error {
    color: #ff8080;
    font-size: 0.8rem;
    margin: 0.25rem 0.65rem;
  }

  /* Icon only on narrow screens */
  @media (max-width: 600px) {
    .label {
      display: none;
    }

    .account-btn {
      padding: 0.5rem;
    }
  }
</style>

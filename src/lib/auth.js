import { writable, get } from 'svelte/store';
import { api, onUnauthenticated } from './api.js';

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} username
 * @property {Object} settings
 */

/**
 * @typedef {Object} AuthState
 * @property {'loading'|'guest'|'user'|'unavailable'} status
 *   unavailable: no backend reachable (e.g. static hosting); the app works as guest
 * @property {User|null} user
 */

// Same rules as the server (server/src/auth/validation.js), for instant feedback
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * @param {string} username
 * @returns {string|null} Error message, or null when valid
 */
export function validateUsername(username) {
  return USERNAME_PATTERN.test(username)
    ? null
    : 'Use 3–32 characters: letters, digits, _ or -';
}

/**
 * @param {string} password
 * @returns {string|null} Error message, or null when valid
 */
export function validatePassword(password) {
  const length = [...password].length;
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH
    ? null
    : `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`;
}

/** @type {import('svelte/store').Writable<AuthState>} */
export const auth = writable({ status: 'loading', user: null });

const signedIn = (user) => auth.set({ status: 'user', user });
const signedOut = () => auth.set({ status: 'guest', user: null });

// Any request that finds the session gone signs the user out locally as well
onUnauthenticated(() => {
  if (get(auth).status === 'user') signedOut();
});

/**
 * Determine the auth state on app start
 * @returns {Promise<void>}
 */
export async function initAuth() {
  try {
    const { user } = await api('/api/auth/me');
    signedIn(user);
  } catch (error) {
    // 401: backend is there, nobody logged in. Anything else: no usable backend.
    if (error.status === 401) signedOut();
    else auth.set({ status: 'unavailable', user: null });
  }
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<User>}
 */
export async function register(username, password) {
  const { user } = await api('/api/auth/register', { method: 'POST', body: { username, password } });
  signedIn(user);
  return user;
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<User>}
 */
export async function login(username, password) {
  const { user } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  signedIn(user);
  return user;
}

let beforeLogoutHandler = null;

/**
 * Register a callback that runs before signing out, while the session is still valid
 * (e.g. to save unsynced changes). Its errors do not stop the logout.
 * @param {(() => Promise<void>)|null} handler
 */
export function onBeforeLogout(handler) {
  beforeLogoutHandler = handler;
}

/** @returns {Promise<void>} */
export async function logout() {
  try {
    await beforeLogoutHandler?.();
  } catch {
    // Signing out matters more than the last unsynced change
  }
  await api('/api/auth/logout', { method: 'POST' });
  signedOut();
}

/**
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
export async function changePassword(currentPassword, newPassword) {
  await api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
}

/**
 * Replace the reader settings stored for the account
 * @param {Object} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  await api('/api/auth/settings', { method: 'PUT', body: { settings } });
}

/**
 * Store the settings while the page is being hidden or closed (see sendProgressBeacon)
 * @param {Object} settings
 * @returns {boolean} Whether the browser queued the request
 */
export function sendSettingsBeacon(settings) {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  return navigator.sendBeacon('/api/auth/settings', JSON.stringify({ settings }));
}

/**
 * Permanently delete the account with all texts and progress
 * @param {string} password
 * @returns {Promise<void>}
 */
export async function deleteAccount(password) {
  await api('/api/auth/account', { method: 'DELETE', body: { password } });
  signedOut();
}

/**
 * Current user or null (non-reactive helper)
 * @returns {User|null}
 */
export function currentUser() {
  return get(auth).user;
}

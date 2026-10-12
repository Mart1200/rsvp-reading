import { HttpError } from '../errors.js';

export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * @param {unknown} username
 * @returns {string|null} Error message, or null when valid
 */
export function usernameError(username) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return 'Username must be 3–32 characters and may only contain letters, digits, _ and -';
  }
  return null;
}

/**
 * @param {unknown} password
 * @returns {string|null} Error message, or null when valid
 */
export function passwordError(password) {
  // Count code points so emoji etc. count as one character
  const length = typeof password === 'string' ? [...password].length : 0;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * Throw a 400 VALIDATION error if a check returned a message
 * @param {string|null} message
 */
export function assertValid(message) {
  if (message) throw new HttpError(400, 'VALIDATION', message);
}

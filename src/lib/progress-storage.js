/**
 * Progress storage utilities for persisting reading sessions
 */

const STORAGE_KEY = 'rsvp-reading-session';

/**
 * Save the current reading session to localStorage
 * @param {Object} session - The session data to save
 * @param {string} session.text - The full text being read
 * @param {number} session.currentWordIndex - Current position in the text
 * @param {number} session.totalWords - Total word count
 * @param {Object} session.settings - Reader settings
 * @param {Array} [session.chapters] - Chapters from the file's TOC/outline
 * @returns {boolean} Whether the save was successful
 */
export function saveSession(session) {
  try {
    const data = {
      text: session.text,
      currentWordIndex: session.currentWordIndex,
      totalWords: session.totalWords,
      settings: session.settings,
      chapters: session.chapters || [],
      savedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to save session:', error);
    return false;
  }
}

/**
 * Load a saved reading session from localStorage
 * @returns {Object|null} The saved session data or null if none exists
 */
export function loadSession() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
}

/**
 * Check if a saved session exists
 * @returns {boolean} Whether a saved session exists
 */
export function hasSession() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Clear the saved session from localStorage
 * @returns {boolean} Whether the clear was successful
 */
export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear session:', error);
    return false;
  }
}

const IMPORT_OFFERED_KEY = 'rsvp-reading-import-offered';

/**
 * Short fingerprint of a text (length + FNV-1a hash), so the session's text can be
 * recognized without storing it twice
 * @param {string} text
 * @returns {string}
 */
export function textFingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Remember that saving this session text to the library was offered (after signing in),
 * so it is offered only once. Stored apart from the session, which can be large.
 * @param {string} text - The session's text
 * @returns {boolean} Whether the flag was stored
 */
export function markImportOffered(text) {
  try {
    localStorage.setItem(IMPORT_OFFERED_KEY, textFingerprint(text));
    return true;
  } catch (error) {
    console.error('Failed to store import offer:', error);
    return false;
  }
}

/**
 * Whether saving this session text to the library was already offered. Saving another
 * text starts a new session, which is offered again.
 * @param {string} text - The session's text
 * @returns {boolean}
 */
export function wasImportOffered(text) {
  try {
    return localStorage.getItem(IMPORT_OFFERED_KEY) === textFingerprint(text);
  } catch {
    return false;
  }
}

/**
 * Get a summary of the saved session without loading full text
 * @returns {Object|null} Summary with wordIndex, totalWords, savedAt, or null
 */
export function getSessionSummary() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return {
      currentWordIndex: parsed.currentWordIndex,
      totalWords: parsed.totalWords,
      savedAt: parsed.savedAt,
      hasText: !!parsed.text
    };
  } catch {
    return null;
  }
}

/**
 * Calculate word index from a percentage
 * @param {number} percentage - Percentage (0-100)
 * @param {number} totalWords - Total word count
 * @returns {number} The word index
 */
export function percentageToWordIndex(percentage, totalWords) {
  if (!totalWords || totalWords <= 0) return 0;
  const clamped = Math.max(0, Math.min(100, percentage));
  return Math.floor((clamped / 100) * totalWords);
}

/**
 * Calculate percentage from word index
 * @param {number} wordIndex - Current word index
 * @param {number} totalWords - Total word count
 * @returns {number} The percentage (0-100)
 */
export function wordIndexToPercentage(wordIndex, totalWords) {
  if (!totalWords || totalWords <= 0) return 0;
  return Math.round((wordIndex / totalWords) * 100);
}

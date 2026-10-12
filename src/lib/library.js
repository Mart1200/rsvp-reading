import { api } from './api.js';

/**
 * @typedef {Object} TextSummary
 * @property {string} id
 * @property {string} title
 * @property {number} totalWords
 * @property {number} currentWordIndex
 * @property {number} progressPercent
 * @property {string|null} lastReadAt - ISO date
 * @property {string} createdAt - ISO date
 */

/**
 * @typedef {TextSummary & {content: string, chapters: Array<{title: string, wordIndex: number, level: number}>}} LibraryText
 */

export const TITLE_MAX_LENGTH = 200;

/** @returns {Promise<TextSummary[]>} Most recently read first */
export async function listTexts() {
  return (await api('/api/texts')).texts;
}

/**
 * @param {string} id
 * @returns {Promise<LibraryText>}
 */
export async function getText(id) {
  return (await api(`/api/texts/${encodeURIComponent(id)}`)).text;
}

/**
 * @param {{title: string, content: string, chapters: Array, currentWordIndex: number}} text
 * @returns {Promise<TextSummary>}
 */
export async function saveText({ title, content, chapters, currentWordIndex }) {
  return (await api('/api/texts', {
    method: 'POST',
    body: { title, content, chapters, currentWordIndex }
  })).text;
}

/**
 * @param {string} id
 * @param {string} title
 * @returns {Promise<TextSummary>}
 */
export async function renameText(id, title) {
  return (await api(`/api/texts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } })).text;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteText(id) {
  await api(`/api/texts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Store the reading position of a library text
 * @param {string} id
 * @param {number} currentWordIndex
 * @returns {Promise<void>}
 */
export async function saveProgress(id, currentWordIndex) {
  await api(`/api/texts/${encodeURIComponent(id)}/progress`, { method: 'PUT', body: { currentWordIndex } });
}

const DEFAULT_TITLE_WORDS = 6;

/**
 * Suggested title when saving a text
 * @param {Object} source
 * @param {string} [source.title] - Book title from the file metadata (EPUB)
 * @param {string} [source.fileName] - Name of the uploaded file
 * @param {string} source.text - The text itself (pasted text: its first words)
 * @returns {string}
 */
export function defaultTitle({ title, fileName, text }) {
  const fromMetadata = title?.trim();
  if (fromMetadata) return truncate(fromMetadata);

  const fromFile = fileName?.replace(/\.[^.]+$/, '').trim();
  if (fromFile) return truncate(fromFile);

  const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Untitled';
  const start = words.slice(0, DEFAULT_TITLE_WORDS).join(' ');
  return truncate(words.length > DEFAULT_TITLE_WORDS ? `${start}…` : start);
}

function truncate(title) {
  const chars = [...title];
  return chars.length > TITLE_MAX_LENGTH ? chars.slice(0, TITLE_MAX_LENGTH - 1).join('') + '…' : title;
}

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
];

/**
 * "3 days ago", "yesterday", "just now"
 * @param {string|Date|null} date
 * @param {Date} [now]
 * @returns {string}
 */
export function formatRelativeTime(date, now = new Date()) {
  if (!date) return 'Never';
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return 'Just now';

  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      const text = format.format(Math.round(seconds / size), unit);
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
  return 'Just now';
}

/**
 * "12,345 words"
 * @param {number} count
 * @returns {string}
 */
export function formatWordCount(count) {
  return `${count.toLocaleString('en')} ${count === 1 ? 'word' : 'words'}`;
}

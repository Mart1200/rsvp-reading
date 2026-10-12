import { HttpError } from '../errors.js';

export const TITLE_MAX_LENGTH = 200;
export const CHAPTER_TITLE_MAX_LENGTH = 500;
export const MAX_CHAPTERS = 10_000;
export const MAX_CHAPTER_LEVEL = 10;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return new HttpError(400, 'VALIDATION', message);
}

/**
 * Malformed IDs are answered like unknown ones, so the database never sees them
 * @param {string} id
 */
export function assertTextId(id) {
  if (!UUID_PATTERN.test(id)) throw new HttpError(404, 'NOT_FOUND', 'Text not found');
}

/**
 * @param {unknown} title
 * @returns {string} Trimmed title
 */
export function parseTitle(title) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (trimmed.length === 0 || [...trimmed].length > TITLE_MAX_LENGTH) {
    throw invalid(`Title must be 1–${TITLE_MAX_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * @param {unknown} content
 * @param {number} totalWords - Word count of the content
 * @returns {string}
 */
export function parseContent(content, totalWords) {
  if (typeof content !== 'string' || totalWords === 0) {
    throw invalid('Content must contain at least one word');
  }
  return content;
}

/**
 * @param {unknown} value
 * @param {number} totalWords
 * @returns {number}
 */
export function parseWordIndex(value, totalWords) {
  if (!Number.isInteger(value) || value < 0 || value > totalWords) {
    throw invalid(`currentWordIndex must be an integer between 0 and ${totalWords}`);
  }
  return value;
}

/**
 * Chapters from an EPUB TOC / PDF outline / heading detection
 * @param {unknown} chapters
 * @param {number} totalWords
 * @returns {Array<{title: string, wordIndex: number, level: number}>} Only the known fields
 */
export function parseChapters(chapters, totalWords) {
  if (chapters === undefined || chapters === null) return [];
  if (!Array.isArray(chapters) || chapters.length > MAX_CHAPTERS) {
    throw invalid(`chapters must be an array of at most ${MAX_CHAPTERS} entries`);
  }
  return chapters.map((chapter, i) => {
    const ok = chapter && typeof chapter === 'object' &&
      typeof chapter.title === 'string' && chapter.title.length <= CHAPTER_TITLE_MAX_LENGTH &&
      Number.isInteger(chapter.wordIndex) && chapter.wordIndex >= 0 && chapter.wordIndex <= totalWords &&
      Number.isInteger(chapter.level ?? 0) && (chapter.level ?? 0) >= 0 && (chapter.level ?? 0) <= MAX_CHAPTER_LEVEL;
    if (!ok) {
      throw invalid(`chapters[${i}] must be {title, wordIndex, level} with wordIndex within the text`);
    }
    return { title: chapter.title, wordIndex: chapter.wordIndex, level: chapter.level ?? 0 };
  });
}

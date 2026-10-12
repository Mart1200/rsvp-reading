/**
 * Count words exactly like the reader does (src/lib/rsvp-utils.js parseText),
 * so word positions from the client line up with totalWords on the server.
 * tests/unit/words.test.js checks that both stay in sync.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

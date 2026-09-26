/**
 * Chapter utilities: detection in plain text and position lookup.
 * A chapter is { title: string, wordIndex: number, level: number },
 * where wordIndex is the 0-based index of its first word in parseText(text).
 */

const MAX_HEADING_LENGTH = 80;
const MAX_HEADING_WORDS = 10;

// "Chapter 3", "Kapitel IV", "Part One: ...", "Appendix A"
const KEYWORD_HEADING =
  /^(chapter|kapitel|part|teil|book|buch|section|abschnitt|appendix|anhang)\s+(\d+|[ivxlcdm]+|[a-z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)(?=$|[\s:.\-–—])/i;

// "Prologue", "Epilog: Zehn Jahre später"
const STANDALONE_HEADING =
  /^(prologue|prolog|epilogue|epilog|introduction|einleitung|preface|vorwort|afterword|nachwort)(?=$|\s*[:.\-–—])/i;

// "1 Introduction", "2.3 Results", "4. Methods"
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+\p{Lu}/u;

/**
 * Count words the same way parseText() splits them
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Check whether a single line looks like a chapter heading
 * @param {string} line - Trimmed line
 * @returns {boolean}
 */
export function isHeadingLine(line) {
  if (!line || line.length > MAX_HEADING_LENGTH) return false;
  if (countWords(line) > MAX_HEADING_WORDS) return false;

  if (KEYWORD_HEADING.test(line) || STANDALONE_HEADING.test(line)) return true;

  const numbered = line.match(NUMBERED_HEADING);
  if (!numbered) return false;
  // Headings don't end like sentences
  if (/[.,;!?]$/.test(line)) return false;
  // Skip years like "1984 Was a good year"
  const num = parseInt(numbered[1], 10);
  if (!numbered[1].includes('.') && num >= 1000) return false;
  return true;
}

/**
 * Detect chapter headings in plain text. Only works when the text still
 * has line breaks (pasted text); PDF/EPUB chapters come from their TOC.
 *
 * @param {string} text - Raw text
 * @returns {{ title: string, wordIndex: number, level: number }[]}
 */
export function detectChapters(text) {
  if (!text || !text.includes('\n')) return [];

  const chapters = [];
  let wordIndex = 0;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (isHeadingLine(line)) {
      chapters.push({ title: line, wordIndex, level: 0 });
    }
    wordIndex += countWords(line);
  }

  return normalizeChapters(chapters);
}

/**
 * Sort chapters by position and drop exact duplicates
 * @param {{ title: string, wordIndex: number, level: number }[]} chapters
 * @returns {{ title: string, wordIndex: number, level: number }[]}
 */
export function normalizeChapters(chapters) {
  const seen = new Set();
  return chapters
    .filter((c) => c && c.title && Number.isFinite(c.wordIndex) && c.wordIndex >= 0)
    .sort((a, b) => a.wordIndex - b.wordIndex)
    .filter((c) => {
      const key = `${c.wordIndex}|${c.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Find the chapter that contains the given reading position
 * @param {{ wordIndex: number }[]} chapters - Sorted by wordIndex
 * @param {number} wordIndex - Current reading position
 * @returns {number} Chapter index, or -1 if before the first chapter
 */
export function findChapterIndex(chapters, wordIndex) {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].wordIndex <= wordIndex) index = i;
    else break;
  }
  return index;
}

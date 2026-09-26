import { describe, it, expect } from 'vitest'
import {
  countWords,
  isHeadingLine,
  detectChapters,
  normalizeChapters,
  findChapterIndex
} from '../lib/chapters.js'
import { parseText } from '../lib/rsvp-utils.js'

describe('countWords', () => {
  it('should count words like parseText', () => {
    const text = '  Hello   world\n\nthis is  a test '
    expect(countWords(text)).toBe(parseText(text).length)
  })

  it('should return 0 for empty input', () => {
    expect(countWords('')).toBe(0)
    expect(countWords(null)).toBe(0)
  })
})

describe('isHeadingLine', () => {
  it.each([
    'Chapter 1',
    'CHAPTER XII',
    'Chapter One: The Beginning',
    'Kapitel 3',
    'Part II',
    'Appendix A',
    'Prologue',
    'Epilog: Zehn Jahre später',
    '1 Introduction',
    '2.3 Related Work',
    '4. Methods'
  ])('should accept %s', (line) => {
    expect(isHeadingLine(line)).toBe(true)
  })

  it.each([
    '',
    'Part of the reason was simple.',
    'Chapter and verse were quoted.',
    '1984 Was a strange year',
    '3 Apples fell from the tree.',
    '42',
    'He said 1 Thing and then left the room without saying anything else at all'
  ])('should reject %s', (line) => {
    expect(isHeadingLine(line)).toBe(false)
  })
})

describe('detectChapters', () => {
  it('should return nothing for text without line breaks', () => {
    expect(detectChapters('Chapter 1 It was a dark night. Chapter 2 Morning came.')).toEqual([])
  })

  it('should map headings to the index of their first word', () => {
    const text = 'Preface text here.\n\nChapter 1\nIt was a dark night.\n\nChapter 2\nMorning came.'
    const words = parseText(text)
    const chapters = detectChapters(text)

    expect(chapters.map(c => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
    for (const chapter of chapters) {
      expect(words[chapter.wordIndex]).toBe('Chapter')
    }
  })

  it('should ignore numbers inside sentences', () => {
    const text = 'In 1999 we met 3 People.\nWe had 2 Dogs.\n\n1 Introduction\nText.'
    expect(detectChapters(text).map(c => c.title)).toEqual(['1 Introduction'])
  })
})

describe('normalizeChapters', () => {
  it('should sort by position and remove duplicates and invalid entries', () => {
    const result = normalizeChapters([
      { title: 'B', wordIndex: 10, level: 0 },
      { title: 'A', wordIndex: 0, level: 0 },
      { title: 'B', wordIndex: 10, level: 0 },
      { title: '', wordIndex: 5, level: 0 },
      { title: 'X', wordIndex: NaN, level: 0 }
    ])
    expect(result.map(c => c.title)).toEqual(['A', 'B'])
  })
})

describe('findChapterIndex', () => {
  const chapters = [
    { title: 'One', wordIndex: 10 },
    { title: 'Two', wordIndex: 50 },
    { title: 'Three', wordIndex: 90 }
  ]

  it('should return -1 before the first chapter', () => {
    expect(findChapterIndex(chapters, 5)).toBe(-1)
  })

  it('should return the chapter containing the position', () => {
    expect(findChapterIndex(chapters, 10)).toBe(0)
    expect(findChapterIndex(chapters, 49)).toBe(0)
    expect(findChapterIndex(chapters, 50)).toBe(1)
    expect(findChapterIndex(chapters, 1000)).toBe(2)
  })

  it('should handle an empty list', () => {
    expect(findChapterIndex([], 10)).toBe(-1)
  })
})

/**
 * File parsing utilities for PDF and EPUB files
 */

import { countWords, normalizeChapters } from './chapters.js'

/**
 * @typedef {{ title: string, wordIndex: number, level: number }} Chapter
 * @typedef {{ text: string, chapters: Chapter[] }} ParsedDocument
 */

/**
 * Parse a PDF file and extract its text content and outline
 * @param {File} file - The PDF file to parse
 * @returns {Promise<ParsedDocument>}
 */
async function extractPDF(file) {
  const pdfjsLib = await import('pdfjs-dist')

  // Set up the worker - use unpkg which mirrors npm directly
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  // Word index at which each page (0-based) starts
  const pageStarts = []
  let wordCount = 0

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .filter(item => 'str' in item)
      .map(item => /** @type {{ str: string }} */ (item).str)
      .join(' ')
    pageStarts.push(wordCount)
    wordCount += countWords(pageText)
    fullText += pageText + ' '
  }

  const chapters = await getPDFChapters(pdf, pageStarts)

  // Clean up the text
  return { text: cleanText(fullText), chapters }
}

/**
 * Map the PDF outline (bookmarks) to word positions
 * @param {any} pdf - pdf.js document
 * @param {number[]} pageStarts - Word index at which each page starts
 * @returns {Promise<Chapter[]>}
 */
async function getPDFChapters(pdf, pageStarts) {
  if (typeof pdf.getOutline !== 'function') return []

  try {
    const outline = await pdf.getOutline()
    if (!outline) return []

    const chapters = []
    const walk = async (items, level) => {
      for (const item of items) {
        try {
          const dest = typeof item.dest === 'string'
            ? await pdf.getDestination(item.dest)
            : item.dest
          if (Array.isArray(dest) && dest[0] != null) {
            const pageIndex = typeof dest[0] === 'number'
              ? dest[0]
              : await pdf.getPageIndex(dest[0])
            if (pageStarts[pageIndex] !== undefined) {
              chapters.push({ title: item.title.trim(), wordIndex: pageStarts[pageIndex], level })
            }
          }
        } catch (e) {
          // Broken outline entries are skipped
        }
        if (item.items?.length && level < 2) await walk(item.items, level + 1)
      }
    }
    await walk(outline, 0)
    return normalizeChapters(chapters)
  } catch (e) {
    console.warn('Could not read PDF outline:', e)
    return []
  }
}

/**
 * Parse a PDF file and extract its text content
 * @param {File} file - The PDF file to parse
 * @returns {Promise<string>} The extracted text
 */
export async function parsePDF(file) {
  return (await extractPDF(file)).text
}

/**
 * Parse an EPUB file and extract its text content and table of contents
 * @param {File} file - The EPUB file to parse
 * @returns {Promise<ParsedDocument>}
 */
async function extractEPUB(file) {
  const ePub = (await import('epubjs')).default

  const arrayBuffer = await file.arrayBuffer()
  const book = ePub(arrayBuffer)

  await book.ready
  await book.loaded.spine

  let fullText = ''
  let wordCount = 0
  // Per spine href: word index where the section starts and its document
  const sections = new Map()

  // Get spine items - the API varies between versions
  const spineItems = book.spine?.spineItems || book.spine?.items || []

  for (const item of spineItems) {
    try {
      // Load the section content using the book's load method
      const href = item.href || item.url
      if (!href) continue

      const contents = await book.load(href)
      if (contents) {
        // contents can be a Document, string, or XML document
        const doc = typeof contents === 'string'
          ? new DOMParser().parseFromString(contents, 'text/html')
          : contents
        const root = doc.body || doc.documentElement
        const text = root ? collectText(root) : ''
        sections.set(href, { start: wordCount, doc, root })
        wordCount += countWords(text)
        fullText += text + ' '
      }
    } catch (e) {
      console.warn('Could not load section:', e)
    }
  }

  const chapters = await getEPUBChapters(book, sections)

  // Clean up the text
  return { text: cleanText(fullText), chapters }
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul'
])

/**
 * Get the text of an element, separating block elements with spaces
 * (textContent glues "<h1>Title</h1><p>Text" into "TitleText").
 * @param {Node} root
 * @param {Node|null} stopAt - Only collect text before this node
 * @returns {string}
 */
function collectText(root, stopAt = null) {
  let out = ''
  let stopped = false

  const visit = (node) => {
    if (stopped) return
    if (node === stopAt) {
      stopped = true
      return
    }
    if (node.nodeType === 3) {
      out += node.nodeValue
      return
    }
    if (node.nodeType !== 1) return

    const tag = node.localName?.toLowerCase()
    if (tag === 'script' || tag === 'style') return
    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock) out += ' '
    for (const child of node.childNodes) visit(child)
    if (isBlock) out += ' '
  }

  visit(root)
  return out
}

/**
 * Map the EPUB table of contents to word positions
 * @param {any} book - epub.js book
 * @param {Map<string, { start: number, doc: Document, root: Element }>} sections
 * @returns {Promise<Chapter[]>}
 */
async function getEPUBChapters(book, sections) {
  try {
    if (book.loaded?.navigation) await book.loaded.navigation
    const toc = book.navigation?.toc
    if (!toc?.length) return []

    const chapters = []
    const walk = (items, level) => {
      for (const item of items) {
        try {
          const wordIndex = resolveEPUBHref(item.href, sections)
          if (wordIndex !== null && item.label?.trim()) {
            chapters.push({ title: item.label.trim(), wordIndex, level })
          }
        } catch (e) {
          // Broken TOC entries are skipped
        }
        if (item.subitems?.length && level < 2) walk(item.subitems, level + 1)
      }
    }
    walk(toc, 0)
    return normalizeChapters(chapters)
  } catch (e) {
    console.warn('Could not read EPUB table of contents:', e)
    return []
  }
}

/**
 * Resolve a TOC href ("text/ch2.xhtml#sec1") to a word index
 * @param {string} href
 * @param {Map<string, { start: number, doc: Document, root: Element }>} sections
 * @returns {number|null}
 */
function resolveEPUBHref(href, sections) {
  if (!href) return null
  const [path, fragment] = decodeURI(href).split('#')

  // TOC hrefs are relative to the nav file, spine hrefs to the OPF,
  // so fall back to matching the end of the path
  let section = sections.get(path)
  if (!section) {
    for (const [spineHref, s] of sections) {
      const spinePath = decodeURI(spineHref)
      if (spinePath.endsWith('/' + path) || path.endsWith('/' + spinePath) || spinePath === path) {
        section = s
        break
      }
    }
  }
  if (!section) return null

  if (fragment && section.root) {
    const target = section.doc.getElementById?.(fragment)
    if (target && section.root.contains(target)) {
      return section.start + countWords(collectText(section.root, target))
    }
  }
  return section.start
}

/**
 * Parse an EPUB file and extract its text content
 * @param {File} file - The EPUB file to parse
 * @returns {Promise<string>} The extracted text
 */
export async function parseEPUB(file) {
  return (await extractEPUB(file)).text
}

/**
 * Clean and normalize extracted text
 * @param {string} text - The raw text to clean
 * @returns {string} Cleaned text
 */
function cleanText(text) {
  return text
    // Replace multiple spaces/newlines with single space
    .replace(/\s+/g, ' ')
    // Remove excessive punctuation
    .replace(/([.!?])\1+/g, '$1')
    // Trim
    .trim()
}

/**
 * Detect file type and parse text plus chapters (from PDF outline / EPUB TOC)
 * @param {File} file - The file to parse
 * @returns {Promise<ParsedDocument>}
 */
export async function parseDocument(file) {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.pdf')) {
    return extractPDF(file)
  } else if (fileName.endsWith('.epub')) {
    return extractEPUB(file)
  } else {
    throw new Error(`Unsupported file type: ${fileName}`)
  }
}

/**
 * Detect file type and parse accordingly
 * @param {File} file - The file to parse
 * @returns {Promise<string>} The extracted text
 */
export async function parseFile(file) {
  return (await parseDocument(file)).text
}

/**
 * Get supported file extensions
 * @returns {string} Comma-separated list of supported extensions
 */
export function getSupportedExtensions() {
  return '.pdf,.epub'
}

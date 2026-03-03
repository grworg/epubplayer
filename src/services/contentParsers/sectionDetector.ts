/**
 * Section Detector
 *
 * Smart splitting of raw text into sections (chapters) for non-EPUB sources.
 * Strategies vary by input type but share common heuristics.
 *
 * Design goals:
 * - Prefer fewer, cleaner sections over many small ones
 * - Never produce empty or near-empty sections
 * - Fall back to a single section rather than produce ugly splits
 */

import type {
  DetectedSection,
  SectionConfidence,
  TextBlock,
  HtmlBlock,
} from './types'

// ============================================================================
// Constants
// ============================================================================

const MIN_SECTION_CHARS = 1_000
const MAX_SINGLE_SECTION_CHARS = 120_000
const PARAGRAPH_SPLIT_TARGET_CHARS = 8_000

const CHAPTER_PATTERN =
  /^(?:chapter|part|section|prologue|epilogue|introduction|conclusion|afterword|foreword|preface|appendix)\b/i
const NUMBERED_CHAPTER_PATTERN =
  /^(?:chapter|part|section)\s+(?:\d+|[IVXLCDM]+|[ivxlcdm]+)(?:\s*[:.–—-]\s*.*)?$/i
const ROMAN_NUMERAL_LINE = /^[IVXLCDM]+\.?$/

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect sections from PDF text blocks with font metadata.
 * Uses font size to identify headings.
 */
export function detectSectionsFromTextBlocks(
  blocks: TextBlock[],
  fallbackTitle: string,
): DetectedSection[] {
  if (blocks.length === 0) return [singleSection(fallbackTitle, '')]

  const bodyFontSize = computeBodyFontSize(blocks)
  // Require 50% larger than body text to be a heading — very conservative
  const headingThreshold = bodyFontSize * 1.5

  const raw: { title: string; texts: string[]; confidence: SectionConfidence }[] = []
  let currentTexts: string[] = []
  let currentTitle = ''
  let currentConfidence: SectionConfidence = 'low'

  for (const block of blocks) {
    const trimmed = block.text.trim()
    if (!trimmed) continue

    const isHeadingByFont =
      block.fontSize !== undefined && block.fontSize >= headingThreshold
    const isHeadingByPattern = isChapterHeading(trimmed)
    const isHeading =
      (isHeadingByFont && trimmed.length < 200) || isHeadingByPattern

    if (isHeading && (currentTexts.length > 0 || raw.length > 0)) {
      if (currentTexts.length > 0 || currentTitle) {
        raw.push({
          title: currentTitle,
          texts: currentTexts,
          confidence: currentConfidence,
        })
      }
      currentTitle = trimmed
      currentTexts = []
      currentConfidence = isHeadingByPattern ? 'high' : 'medium'
    } else if (isHeading && currentTexts.length === 0 && raw.length === 0) {
      currentTitle = trimmed
      currentConfidence = isHeadingByPattern ? 'high' : 'medium'
    } else {
      currentTexts.push(trimmed)
    }
  }

  if (currentTexts.length > 0 || currentTitle) {
    raw.push({
      title: currentTitle,
      texts: currentTexts,
      confidence: currentConfidence,
    })
  }

  const sections = raw.map((r) => ({
    title: r.title || fallbackTitle,
    textContent: normalizeText(r.texts.join(' ')),
    confidence: r.confidence,
  }))

  return cleanupSections(sections, fallbackTitle)
}

/**
 * Detect sections from HTML content (from Readability output).
 *
 * Conservative by design: a single web page is almost always one section.
 * Only splits if there are top-level headings (H1 only) that produce
 * sections each above MIN_SECTION_CHARS. Sub-headings (H2-H6) within
 * a page are treated as part of the same section — they're structural
 * headings within a chapter, not chapter boundaries.
 */
export function detectSectionsFromHtml(
  htmlBlocks: HtmlBlock[],
  fallbackTitle: string,
): DetectedSection[] {
  if (htmlBlocks.length === 0) return [singleSection(fallbackTitle, '')]

  // Only split on H1 — the strongest signal of a true section boundary
  const raw: { title: string; texts: string[]; confidence: SectionConfidence }[] = []
  let currentTexts: string[] = []
  let currentTitle = ''

  for (const block of htmlBlocks) {
    const trimmed = block.textContent.trim()
    if (!trimmed) continue

    const isH1 = block.tagName.toUpperCase() === 'H1' && trimmed.length < 200

    if (isH1 && (currentTexts.length > 0 || raw.length > 0)) {
      if (currentTexts.length > 0 || currentTitle) {
        raw.push({ title: currentTitle, texts: currentTexts, confidence: 'high' })
      }
      currentTitle = trimmed
      currentTexts = []
    } else if (isH1 && currentTexts.length === 0 && raw.length === 0) {
      currentTitle = trimmed
    } else {
      currentTexts.push(trimmed)
    }
  }

  if (currentTexts.length > 0 || currentTitle) {
    raw.push({ title: currentTitle, texts: currentTexts, confidence: 'high' })
  }

  const sections = raw.map((r) => ({
    title: r.title || fallbackTitle,
    textContent: normalizeText(r.texts.join(' ')),
    confidence: r.confidence,
  }))

  // If splitting on H1 produced sections that are too small, collapse to one
  const allSubstantial = sections.every(
    (s) => s.textContent.length >= MIN_SECTION_CHARS,
  )
  if (!allSubstantial || sections.length <= 1) {
    const allText = sections.map((s) => s.textContent).join(' ')
    return [singleSection(fallbackTitle, allText)]
  }

  return cleanupSections(sections, fallbackTitle)
}

/**
 * Detect sections from plain text.
 * Uses pattern matching and line-based heuristics.
 */
export function detectSectionsFromPlainText(
  text: string,
  fallbackTitle: string,
): DetectedSection[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return [singleSection(fallbackTitle, '')]

  const lines = normalized.split('\n')

  const raw: { title: string; texts: string[]; confidence: SectionConfidence }[] = []
  let currentTexts: string[] = []
  let currentTitle = ''
  let currentConfidence: SectionConfidence = 'low'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const isHeading = isPlainTextHeading(line, lines, i)

    if (isHeading && (currentTexts.length > 0 || raw.length > 0)) {
      if (currentTexts.length > 0 || currentTitle) {
        raw.push({
          title: currentTitle,
          texts: currentTexts,
          confidence: currentConfidence,
        })
      }
      currentTitle = line
      currentTexts = []
      currentConfidence = isChapterHeading(line) ? 'high' : 'medium'
    } else if (isHeading && currentTexts.length === 0 && raw.length === 0) {
      currentTitle = line
      currentConfidence = isChapterHeading(line) ? 'high' : 'medium'
    } else {
      currentTexts.push(line)
    }
  }

  if (currentTexts.length > 0 || currentTitle) {
    raw.push({
      title: currentTitle,
      texts: currentTexts,
      confidence: currentConfidence,
    })
  }

  const sections = raw.map((r) => ({
    title: r.title || fallbackTitle,
    textContent: normalizeText(r.texts.join(' ')),
    confidence: r.confidence,
  }))

  return cleanupSections(sections, fallbackTitle)
}

/**
 * Collapse a list of sections into a single section.
 */
export function collapseToSingleSection(
  sections: DetectedSection[],
  title: string,
): DetectedSection[] {
  const combined = sections.map((s) => s.textContent).join(' ')
  return [
    {
      title,
      textContent: normalizeText(combined),
      confidence: 'high',
    },
  ]
}

// ============================================================================
// Internal Helpers
// ============================================================================

function singleSection(title: string, text: string): DetectedSection[] {
  return [{ title: title || 'Full Text', textContent: normalizeText(text), confidence: 'high' }]
}

function isChapterHeading(line: string): boolean {
  const trimmed = line.trim()
  return CHAPTER_PATTERN.test(trimmed) ||
    NUMBERED_CHAPTER_PATTERN.test(trimmed) ||
    ROMAN_NUMERAL_LINE.test(trimmed)
}

function isPlainTextHeading(
  line: string,
  allLines: string[],
  index: number,
): boolean {
  if (isChapterHeading(line)) return true

  if (line.length > 100) return false
  if (line.length < 2) return false

  // Short line followed by a blank line then body text
  const nextNonEmpty = findNextNonEmptyLine(allLines, index)
  if (nextNonEmpty === -1) return false

  const gapLines = nextNonEmpty - index - 1
  const isShort = line.length <= 60
  const isUpperCase = line === line.toUpperCase() && /[A-Z]/.test(line)
  const hasNoPunctuation = !/[.!?,;:]$/.test(line)

  if (isShort && hasNoPunctuation && (gapLines >= 1 || isUpperCase)) {
    return true
  }

  return false
}

function findNextNonEmptyLine(lines: string[], fromIndex: number): number {
  for (let i = fromIndex + 1; i < lines.length; i++) {
    if (lines[i].trim()) return i
  }
  return -1
}

function computeBodyFontSize(blocks: TextBlock[]): number {
  const sizes = blocks
    .filter((b) => b.fontSize !== undefined && b.text.trim().length > 20)
    .map((b) => b.fontSize!)

  if (sizes.length === 0) return 12

  // Body font is the most common size among substantial text blocks
  const freq = new Map<number, number>()
  for (const size of sizes) {
    const rounded = Math.round(size * 10) / 10
    freq.set(rounded, (freq.get(rounded) ?? 0) + 1)
  }

  let maxCount = 0
  let bodySize = 12
  for (const [size, count] of freq) {
    if (count > maxCount) {
      maxCount = count
      bodySize = size
    }
  }
  return bodySize
}

/**
 * Clean up detected sections:
 * - Remove empty sections
 * - Merge undersized sections into neighbors
 * - Split oversized single sections at paragraph boundaries
 * - Fall back to a single section if nothing useful was detected
 */
function cleanupSections(
  sections: DetectedSection[],
  fallbackTitle: string,
): DetectedSection[] {
  // Remove empty sections
  let cleaned = sections.filter((s) => s.textContent.trim().length > 0)

  if (cleaned.length === 0) {
    return [singleSection(fallbackTitle, '')]
  }

  // Merge undersized sections into their next neighbor
  cleaned = mergeUndersizedSections(cleaned)

  // If we ended up with a single very large section, try paragraph-based splitting
  if (
    cleaned.length === 1 &&
    cleaned[0].textContent.length > MAX_SINGLE_SECTION_CHARS
  ) {
    const split = splitByParagraphs(
      cleaned[0].textContent,
      fallbackTitle,
      PARAGRAPH_SPLIT_TARGET_CHARS,
    )
    if (split.length > 1) return split
  }

  // Number untitled sections
  let untitledCount = 0
  for (const section of cleaned) {
    if (!section.title || section.title === fallbackTitle) {
      untitledCount++
      if (cleaned.length > 1) {
        section.title = `Section ${untitledCount}`
      }
    }
  }

  return cleaned
}

function mergeUndersizedSections(
  sections: DetectedSection[],
): DetectedSection[] {
  if (sections.length <= 1) return sections

  const result: DetectedSection[] = []
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    if (
      section.textContent.length < MIN_SECTION_CHARS &&
      result.length > 0
    ) {
      // Merge into previous section
      const prev = result[result.length - 1]
      prev.textContent = normalizeText(
        prev.textContent + ' ' + section.textContent,
      )
    } else if (
      section.textContent.length < MIN_SECTION_CHARS &&
      i + 1 < sections.length
    ) {
      // Merge into next section
      sections[i + 1] = {
        ...sections[i + 1],
        textContent: normalizeText(
          section.textContent + ' ' + sections[i + 1].textContent,
        ),
      }
    } else {
      result.push({ ...section })
    }
  }
  return result
}

function splitByParagraphs(
  text: string,
  baseTitle: string,
  targetChars: number,
): DetectedSection[] {
  // Split on double newlines or sentence boundaries
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim())
  if (paragraphs.length <= 1) {
    // No paragraph breaks found, split on sentences
    return splitBySentences(text, baseTitle, targetChars)
  }

  const sections: DetectedSection[] = []
  let currentText = ''
  let sectionNum = 1

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    if (currentText.length + trimmed.length > targetChars && currentText) {
      sections.push({
        title: `${baseTitle} — Part ${sectionNum}`,
        textContent: normalizeText(currentText),
        confidence: 'low',
      })
      sectionNum++
      currentText = trimmed
    } else {
      currentText = currentText ? currentText + ' ' + trimmed : trimmed
    }
  }

  if (currentText) {
    sections.push({
      title:
        sections.length > 0
          ? `${baseTitle} — Part ${sectionNum}`
          : baseTitle,
      textContent: normalizeText(currentText),
      confidence: 'low',
    })
  }

  return sections
}

function splitBySentences(
  text: string,
  baseTitle: string,
  targetChars: number,
): DetectedSection[] {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const sections: DetectedSection[] = []
  let currentText = ''
  let sectionNum = 1

  for (const sentence of sentences) {
    if (currentText.length + sentence.length > targetChars && currentText) {
      sections.push({
        title: `${baseTitle} — Part ${sectionNum}`,
        textContent: normalizeText(currentText),
        confidence: 'low',
      })
      sectionNum++
      currentText = sentence
    } else {
      currentText = currentText ? currentText + ' ' + sentence : sentence
    }
  }

  if (currentText) {
    sections.push({
      title:
        sections.length > 0
          ? `${baseTitle} — Part ${sectionNum}`
          : baseTitle,
      textContent: normalizeText(currentText),
      confidence: 'low',
    })
  }

  return sections
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

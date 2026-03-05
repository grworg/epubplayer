/**
 * Text Cleanup Utilities
 *
 * Pure functions for detecting and fixing common TTS artifacts
 * in imported text: footnote markers, page numbers, URLs,
 * and whitespace issues.
 */

// ============================================================================
// Issue Detection
// ============================================================================

export type IssueType = 'footnote' | 'pageNumber' | 'url' | 'whitespace'

export interface Issue {
  type: IssueType
  count: number
  label: string
}

const FOOTNOTE_PATTERN = /\[\d{1,4}\]|\(\d{1,4}\)/g
const PAGE_NUMBER_PATTERN = /^\s*\d{1,5}\s*$/gm
const URL_PATTERN = /https?:\/\/[^\s)>\]]+|[\w.-]+@[\w.-]+\.\w{2,}/g
const EXCESS_WHITESPACE_PATTERN = /[ \t]{2,}|\n{3,}/g

export function detectIssues(text: string): Issue[] {
  const issues: Issue[] = []

  const footnotes = text.match(FOOTNOTE_PATTERN)
  if (footnotes) issues.push({ type: 'footnote', count: footnotes.length, label: 'Footnote markers' })

  const pageNumbers = text.match(PAGE_NUMBER_PATTERN)
  if (pageNumbers) issues.push({ type: 'pageNumber', count: pageNumbers.length, label: 'Stray page numbers' })

  const urls = text.match(URL_PATTERN)
  if (urls) issues.push({ type: 'url', count: urls.length, label: 'URLs / emails' })

  const whitespace = text.match(EXCESS_WHITESPACE_PATTERN)
  if (whitespace) issues.push({ type: 'whitespace', count: whitespace.length, label: 'Whitespace issues' })

  return issues
}

export function countIssues(text: string): number {
  return detectIssues(text).reduce((sum, i) => sum + i.count, 0)
}

// ============================================================================
// Cleanup Functions
// ============================================================================

export function cleanFootnotes(text: string): string {
  return text.replace(FOOTNOTE_PATTERN, '')
}

export function cleanPageNumbers(text: string): string {
  return text.replace(PAGE_NUMBER_PATTERN, '')
}

export function cleanUrls(text: string): string {
  return text.replace(URL_PATTERN, '')
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+$/gm, '')
    .trim()
}

export function cleanAll(text: string): string {
  let cleaned = text
  cleaned = cleanFootnotes(cleaned)
  cleaned = cleanPageNumbers(cleaned)
  cleaned = cleanUrls(cleaned)
  cleaned = normalizeWhitespace(cleaned)
  return cleaned
}

// ============================================================================
// Highlight helpers (for UI)
// ============================================================================

export interface TextSpan {
  text: string
  isIssue: boolean
  type?: IssueType
}

const ALL_ISSUES_PATTERN = /\[\d{1,4}\]|\(\d{1,4}\)|https?:\/\/[^\s)>\]]+|[\w.-]+@[\w.-]+\.\w{2,}/g

export function highlightIssues(text: string): TextSpan[] {
  const spans: TextSpan[] = []
  let lastIndex = 0

  for (const match of text.matchAll(ALL_ISSUES_PATTERN)) {
    const start = match.index!
    if (start > lastIndex) {
      spans.push({ text: text.slice(lastIndex, start), isIssue: false })
    }

    let type: IssueType = 'footnote'
    const m = match[0]
    if (m.startsWith('http') || m.includes('@')) type = 'url'
    else if (/^\[\d+\]$/.test(m) || /^\(\d+\)$/.test(m)) type = 'footnote'

    spans.push({ text: m, isIssue: true, type })
    lastIndex = start + m.length
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), isIssue: false })
  }

  return spans.length > 0 ? spans : [{ text, isIssue: false }]
}

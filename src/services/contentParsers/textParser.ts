/**
 * Text/Paste Parser
 *
 * Handles pasted plain text or HTML, producing ParsedContent.
 * The simplest parser — user provides title and author via the UI.
 */

import { createLogger } from '@/services/logging'
import { hashText } from '@/services/storage/db'
import { detectSectionsFromPlainText, detectSectionsFromHtml } from './sectionDetector'
import type { ParsedContent, ImportProgressCallback, HtmlBlock } from './types'

const log = createLogger('import')

// ============================================================================
// Public API
// ============================================================================

export interface TextParseOptions {
  title: string
  author?: string
  onProgress?: ImportProgressCallback
}

/**
 * Parse pasted text (plain or HTML) into ParsedContent.
 */
export async function parseText(
  input: string,
  options: TextParseOptions,
): Promise<ParsedContent> {
  const { title, author, onProgress } = options

  onProgress?.('Processing text...', 20)
  log.info('Parsing pasted text', { length: input.length, title })

  const isHtml = looksLikeHtml(input)
  let sections

  if (isHtml) {
    onProgress?.('Extracting content from HTML...', 40)
    const blocks = extractBlocksFromHtml(input)
    const plainText = blocks.map((b) => b.textContent).join(' ')

    if (!plainText.trim()) {
      throw new Error('No readable text content found in the pasted HTML')
    }

    onProgress?.('Detecting sections...', 70)
    sections = detectSectionsFromHtml(blocks, title)
  } else {
    if (!input.trim()) {
      throw new Error('No text content to import')
    }

    onProgress?.('Detecting sections...', 70)
    sections = detectSectionsFromPlainText(input, title)
  }

  const fullText = sections.map((s) => s.textContent).join(' ')
  const contentHash = await hashText(fullText)

  onProgress?.('Done', 100)

  log.info('Text parsed', {
    title,
    sections: sections.length,
    totalChars: fullText.length,
    wasHtml: isHtml,
  })

  return {
    metadata: {
      title,
      author: author || 'Unknown Author',
      sourceType: 'text',
    },
    sections,
    contentHash,
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed.startsWith('<') ||
    /<(?:p|div|h[1-6]|article|section|html|body)\b/i.test(trimmed)
  )
}

function extractBlocksFromHtml(html: string): HtmlBlock[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return []

  // Remove non-content elements
  for (const el of body.querySelectorAll('script, style, noscript, svg')) {
    el.remove()
  }

  const blocks: HtmlBlock[] = []
  const headingTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
  const blockTags = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI',
    'PRE', 'FIGCAPTION', 'TD', 'TH',
  ])

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        blocks.push({ tagName: 'P', textContent: text })
      }
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element

    if (headingTags.has(el.tagName)) {
      const text = el.textContent?.trim()
      if (text) {
        blocks.push({ tagName: el.tagName, textContent: text })
      }
      return
    }

    if (blockTags.has(el.tagName)) {
      const text = el.textContent?.trim()
      if (text) {
        blocks.push({ tagName: el.tagName, textContent: text })
      }
      return
    }

    for (const child of el.childNodes) {
      walk(child)
    }
  }

  walk(body)
  return blocks
}

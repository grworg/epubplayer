/**
 * PDF Worker
 *
 * Runs PDF.js text extraction off the main thread.
 * Posts back text items with font metadata per page.
 */

import { createWorkerLogger } from '@/services/logging/workerLogger'

const log = createWorkerLogger('import')

// ============================================================================
// Message Types
// ============================================================================

export interface PDFWorkerRequest {
  type: 'extract'
  arrayBuffer: ArrayBuffer
}

export interface PDFTextItem {
  text: string
  fontSize: number
  fontName: string
  pageIndex: number
}

export interface PDFWorkerProgress {
  type: 'progress'
  step: string
  current: number
  total: number
}

export interface PDFWorkerResult {
  type: 'result'
  items: PDFTextItem[]
  metadata: {
    title?: string
    author?: string
    pageCount: number
    totalChars: number
  }
  isLikelyScanned: boolean
}

export interface PDFWorkerError {
  type: 'error'
  message: string
}

export type PDFWorkerMessage = PDFWorkerProgress | PDFWorkerResult | PDFWorkerError

// ============================================================================
// Worker Implementation
// ============================================================================

const SCANNED_CHARS_PER_PAGE_THRESHOLD = 50

self.onmessage = async (e: MessageEvent<PDFWorkerRequest>) => {
  if (e.data.type !== 'extract') return

  try {
    log.info('Starting PDF extraction')

    const pdfjsLib = await import('pdfjs-dist')

    // Configure PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()

    const pdf = await pdfjsLib.getDocument({
      data: e.data.arrayBuffer,
      useSystemFonts: true,
    }).promise

    const pageCount = pdf.numPages
    log.info('PDF loaded', { pages: pageCount })

    // Extract metadata
    const pdfMetadata = await pdf.getMetadata().catch(() => null)
    const info = pdfMetadata?.info as Record<string, string> | undefined
    const metadata = {
      title: info?.Title || undefined,
      author: info?.Author || undefined,
      pageCount,
      totalChars: 0,
    }

    // Extract text from all pages
    const items: PDFTextItem[] = []
    let totalChars = 0

    for (let i = 0; i < pageCount; i++) {
      self.postMessage({
        type: 'progress',
        step: 'Extracting text...',
        current: i + 1,
        total: pageCount,
      } satisfies PDFWorkerProgress)

      const page = await pdf.getPage(i + 1)
      const content = await page.getTextContent()

      for (const item of content.items) {
        if (!('str' in item)) continue
        const text = item.str
        if (!text.trim()) continue

        const fontSize = Math.abs(item.transform?.[0] ?? 12)
        const fontName = item.fontName ?? ''

        items.push({
          text,
          fontSize,
          fontName,
          pageIndex: i,
        })
        totalChars += text.length
      }
    }

    metadata.totalChars = totalChars
    const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0
    const isLikelyScanned = avgCharsPerPage < SCANNED_CHARS_PER_PAGE_THRESHOLD

    log.info('PDF extraction complete', {
      items: items.length,
      totalChars,
      avgCharsPerPage: Math.round(avgCharsPerPage),
      isLikelyScanned,
    })

    self.postMessage({
      type: 'result',
      items,
      metadata,
      isLikelyScanned,
    } satisfies PDFWorkerResult)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF extraction failed'
    log.error('PDF extraction error', { error: message })
    self.postMessage({ type: 'error', message } satisfies PDFWorkerError)
  }
}

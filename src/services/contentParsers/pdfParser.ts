/**
 * PDF Parser
 *
 * Extracts text from PDF files using PDF.js with optional OCR fallback
 * via Tesseract.js for scanned documents.
 *
 * PDF.js manages its own internal web worker for heavy parsing,
 * so we run it on the main thread and let it handle concurrency.
 *
 * Produces ParsedContent for the shared import pipeline.
 */

import * as pdfjsLib from 'pdfjs-dist'
import { createLogger } from '@/services/logging'
import { hashBlob } from '@/services/storage/db'
import { detectSectionsFromTextBlocks } from './sectionDetector'
import type { ParsedContent, ImportProgressCallback, TextBlock } from './types'

const log = createLogger('import')

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ============================================================================
// Types
// ============================================================================

interface PDFTextItem {
  text: string
  fontSize: number
  fontName: string
  pageIndex: number
}

const SCANNED_CHARS_PER_PAGE_THRESHOLD = 50

// ============================================================================
// Public API
// ============================================================================

export interface PDFParseOptions {
  onProgress?: ImportProgressCallback
  onScanDetected?: () => Promise<boolean>
}

export async function parsePDF(
  file: File,
  options: PDFParseOptions = {},
): Promise<ParsedContent> {
  const { onProgress, onScanDetected } = options

  onProgress?.('Reading PDF...', 0)
  log.info('Starting PDF parse', { filename: file.name, size: file.size })

  const arrayBuffer = await file.arrayBuffer()
  const contentHash = await hashBlob(file)

  // Extract text using PDF.js (it manages its own worker internally)
  onProgress?.('Extracting text...', 10)
  const extraction = await extractPDFText(arrayBuffer, onProgress)

  let textBlocks: TextBlock[]

  if (extraction.isLikelyScanned) {
    log.info('Scanned PDF detected', {
      avgCharsPerPage: Math.round(
        extraction.totalChars / Math.max(1, extraction.pageCount),
      ),
    })

    const shouldOCR = onScanDetected ? await onScanDetected() : false

    if (shouldOCR) {
      onProgress?.('Running OCR...', 30)
      const ocrText = await runOCR(arrayBuffer, extraction.pageCount, onProgress)
      textBlocks = ocrText.map((page) => ({
        text: page.text,
        pageIndex: page.pageIndex,
      }))
    } else {
      textBlocks = extraction.items.map(itemToTextBlock)
    }
  } else {
    textBlocks = extraction.items.map(itemToTextBlock)
  }

  onProgress?.('Detecting sections...', 80)
  const title = extraction.title || stripExtension(file.name)
  const sections = detectSectionsFromTextBlocks(textBlocks, title)

  onProgress?.('Done', 100)

  log.info('PDF parsed', {
    title,
    sections: sections.length,
    totalChars: textBlocks.reduce((sum, b) => sum + b.text.length, 0),
  })

  return {
    metadata: {
      title,
      author: extraction.author || 'Unknown Author',
      sourceType: 'pdf',
    },
    sections,
    originalBlob: file,
    contentHash,
  }
}

// ============================================================================
// PDF.js Text Extraction
// ============================================================================

interface PDFExtraction {
  items: PDFTextItem[]
  title?: string
  author?: string
  pageCount: number
  totalChars: number
  isLikelyScanned: boolean
}

async function extractPDFText(
  arrayBuffer: ArrayBuffer,
  onProgress?: ImportProgressCallback,
): Promise<PDFExtraction> {
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
  }).promise

  const pageCount = pdf.numPages
  log.info('PDF loaded', { pages: pageCount })

  const pdfMetadata = await pdf.getMetadata().catch(() => null)
  const info = pdfMetadata?.info as Record<string, string> | undefined

  const items: PDFTextItem[] = []
  let totalChars = 0

  for (let i = 0; i < pageCount; i++) {
    const pct = Math.round(((i + 1) / pageCount) * 70) + 10
    onProgress?.(`Extracting text (page ${i + 1}/${pageCount})...`, pct)

    const page = await pdf.getPage(i + 1)
    const content = await page.getTextContent()

    for (const item of content.items) {
      if (!('str' in item)) continue
      const text = item.str
      if (!text.trim()) continue

      const fontSize = Math.abs(item.transform?.[0] ?? 12)
      const fontName = item.fontName ?? ''

      items.push({ text, fontSize, fontName, pageIndex: i })
      totalChars += text.length
    }
  }

  const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0

  return {
    items,
    title: info?.Title || undefined,
    author: info?.Author || undefined,
    pageCount,
    totalChars,
    isLikelyScanned: avgCharsPerPage < SCANNED_CHARS_PER_PAGE_THRESHOLD,
  }
}

// ============================================================================
// OCR (on-demand Tesseract.js)
// ============================================================================

async function runOCR(
  pdfArrayBuffer: ArrayBuffer,
  pageCount: number,
  onProgress?: ImportProgressCallback,
): Promise<{ pageIndex: number; text: string }[]> {
  onProgress?.('Rendering pages for OCR...', 30)
  const pageImages = await renderPDFPagesToImages(pdfArrayBuffer, pageCount, onProgress)

  onProgress?.('Loading OCR engine...', 50)
  const Tesseract = await import('tesseract.js')
  const worker = await Tesseract.createWorker('eng')

  const results: { pageIndex: number; text: string }[] = []

  for (let i = 0; i < pageImages.length; i++) {
    const pct = Math.round(((i + 1) / pageImages.length) * 40) + 50
    onProgress?.(`OCR page ${i + 1} of ${pageImages.length}...`, pct)

    const imageBlob = new Blob([pageImages[i]], { type: 'image/png' })
    const result = await worker.recognize(imageBlob)
    results.push({ pageIndex: i, text: result.data.text })
  }

  await worker.terminate()

  log.info('OCR complete', {
    pages: results.length,
    totalChars: results.reduce((sum, p) => sum + p.text.length, 0),
  })

  return results
}

async function renderPDFPagesToImages(
  arrayBuffer: ArrayBuffer,
  pageCount: number,
  onProgress?: ImportProgressCallback,
): Promise<ArrayBuffer[]> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise
  const images: ArrayBuffer[] = []
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  for (let i = 0; i < pageCount; i++) {
    onProgress?.(`Rendering page ${i + 1}...`, 30 + Math.round((i / pageCount) * 20))

    const page = await pdf.getPage(i + 1)
    const viewport = page.getViewport({ scale: 2.0 })
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({ canvasContext: ctx, viewport, canvas }).promise

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    )
    images.push(await blob.arrayBuffer())
  }

  canvas.remove()
  return images
}

// ============================================================================
// Helpers
// ============================================================================

function itemToTextBlock(item: PDFTextItem): TextBlock {
  return {
    text: item.text,
    fontSize: item.fontSize,
    fontName: item.fontName,
    pageIndex: item.pageIndex,
  }
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

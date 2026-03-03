/**
 * PDF Parser
 *
 * Extracts text from PDF files using PDF.js (Web Worker) with
 * optional OCR fallback via Tesseract.js for scanned documents.
 *
 * Produces ParsedContent for the shared import pipeline.
 */

import { createLogger } from '@/services/logging'
import { handleWorkerLog } from '@/services/logging'
import { hashBlob } from '@/services/storage/db'
import { detectSectionsFromTextBlocks } from './sectionDetector'
import type { ParsedContent, ImportProgressCallback, TextBlock } from './types'
import type { PDFWorkerMessage, PDFTextItem } from './pdfWorker'
import type { OCRWorkerMessage } from './ocrWorker'

const log = createLogger('import')

// ============================================================================
// Public API
// ============================================================================

export interface PDFParseOptions {
  onProgress?: ImportProgressCallback
  /**
   * Called when a scanned PDF is detected. Return true to proceed with OCR.
   */
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

  // Run PDF.js extraction in a worker
  onProgress?.('Extracting text...', 10)
  const extraction = await runPDFWorker(arrayBuffer, onProgress)

  let textBlocks: TextBlock[]

  if (extraction.isLikelyScanned) {
    log.info('Scanned PDF detected', {
      avgCharsPerPage: Math.round(
        extraction.metadata.totalChars / Math.max(1, extraction.metadata.pageCount),
      ),
    })

    const shouldOCR = onScanDetected ? await onScanDetected() : false

    if (shouldOCR) {
      onProgress?.('Running OCR...', 30)
      const ocrText = await runOCR(arrayBuffer, extraction.metadata.pageCount, onProgress)
      textBlocks = ocrText.map((page) => ({
        text: page.text,
        pageIndex: page.pageIndex,
      }))
    } else {
      // Use whatever sparse text we got from PDF.js
      textBlocks = extraction.items.map(itemToTextBlock)
    }
  } else {
    textBlocks = extraction.items.map(itemToTextBlock)
  }

  // Detect sections
  onProgress?.('Detecting sections...', 80)
  const title = extraction.metadata.title || stripExtension(file.name)
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
      author: extraction.metadata.author || 'Unknown Author',
      sourceType: 'pdf',
    },
    sections,
    originalBlob: file,
    contentHash,
  }
}

// ============================================================================
// Worker Coordination
// ============================================================================

interface PDFExtraction {
  items: PDFTextItem[]
  metadata: {
    title?: string
    author?: string
    pageCount: number
    totalChars: number
  }
  isLikelyScanned: boolean
}

function runPDFWorker(
  arrayBuffer: ArrayBuffer,
  onProgress?: ImportProgressCallback,
): Promise<PDFExtraction> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./pdfWorker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (e: MessageEvent<PDFWorkerMessage>) => {
      if (e.data.type === 'log') {
        handleWorkerLog(e.data as never)
        return
      }

      switch (e.data.type) {
        case 'progress': {
          const pct = Math.round((e.data.current / e.data.total) * 70) + 10
          onProgress?.(e.data.step, pct)
          break
        }
        case 'result':
          worker.terminate()
          resolve({
            items: e.data.items,
            metadata: e.data.metadata,
            isLikelyScanned: e.data.isLikelyScanned,
          })
          break
        case 'error':
          worker.terminate()
          reject(new Error(e.data.message))
          break
      }
    }

    worker.onerror = (error) => {
      worker.terminate()
      reject(new Error(error.message || 'PDF worker failed'))
    }

    worker.postMessage({ type: 'extract', arrayBuffer }, [arrayBuffer])
  })
}

async function runOCR(
  pdfArrayBuffer: ArrayBuffer,
  pageCount: number,
  onProgress?: ImportProgressCallback,
): Promise<{ pageIndex: number; text: string }[]> {
  // Render PDF pages to images first using PDF.js on the main thread
  // (canvas rendering requires DOM access, can't run in worker)
  onProgress?.('Rendering pages for OCR...', 30)
  const pageImages = await renderPDFPagesToImages(pdfArrayBuffer, pageCount, onProgress)

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./ocrWorker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (e: MessageEvent<OCRWorkerMessage>) => {
      if (e.data.type === 'log') {
        handleWorkerLog(e.data as never)
        return
      }

      switch (e.data.type) {
        case 'progress': {
          const pct = Math.round((e.data.current / e.data.total) * 40) + 50
          onProgress?.(e.data.step, pct)
          break
        }
        case 'result':
          worker.terminate()
          resolve(e.data.pages)
          break
        case 'error':
          worker.terminate()
          reject(new Error(e.data.message))
          break
      }
    }

    worker.onerror = (error) => {
      worker.terminate()
      reject(new Error(error.message || 'OCR worker failed'))
    }

    const transferable = pageImages.map((img) => img.buffer)
    worker.postMessage(
      { type: 'recognize', pageImages, language: 'eng' },
      transferable as Transferable[],
    )
  })
}

async function renderPDFPagesToImages(
  arrayBuffer: ArrayBuffer,
  pageCount: number,
  onProgress?: ImportProgressCallback,
): Promise<ArrayBuffer[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

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

    await page.render({ canvasContext: ctx, viewport }).promise

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

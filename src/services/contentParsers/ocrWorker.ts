/**
 * OCR Worker
 *
 * Runs Tesseract.js on demand for scanned PDF pages.
 * Loaded lazily — only when a scanned PDF is detected.
 */

import { createWorkerLogger } from '@/services/logging/workerLogger'

const log = createWorkerLogger('import')

// ============================================================================
// Message Types
// ============================================================================

export interface OCRWorkerRequest {
  type: 'recognize'
  pageImages: ArrayBuffer[]
  language: string
}

export interface OCRWorkerProgress {
  type: 'progress'
  step: string
  current: number
  total: number
}

export interface OCRWorkerResult {
  type: 'result'
  pages: { pageIndex: number; text: string }[]
}

export interface OCRWorkerError {
  type: 'error'
  message: string
}

export type OCRWorkerMessage = OCRWorkerProgress | OCRWorkerResult | OCRWorkerError

// ============================================================================
// Worker Implementation
// ============================================================================

self.onmessage = async (e: MessageEvent<OCRWorkerRequest>) => {
  if (e.data.type !== 'recognize') return

  try {
    const { pageImages, language } = e.data
    log.info('Starting OCR', { pages: pageImages.length, language })

    self.postMessage({
      type: 'progress',
      step: 'Loading OCR engine...',
      current: 0,
      total: pageImages.length,
    } satisfies OCRWorkerProgress)

    const Tesseract = await import('tesseract.js')

    const worker = await Tesseract.createWorker(language, undefined, {
      logger: (m: { progress: number; status: string }) => {
        log.debug('Tesseract progress', { status: m.status, progress: m.progress })
      },
    })

    const pages: { pageIndex: number; text: string }[] = []

    for (let i = 0; i < pageImages.length; i++) {
      self.postMessage({
        type: 'progress',
        step: `OCR page ${i + 1} of ${pageImages.length}...`,
        current: i + 1,
        total: pageImages.length,
      } satisfies OCRWorkerProgress)

      const imageBlob = new Blob([pageImages[i]], { type: 'image/png' })
      const result = await worker.recognize(imageBlob)
      pages.push({ pageIndex: i, text: result.data.text })
    }

    await worker.terminate()

    log.info('OCR complete', {
      pages: pages.length,
      totalChars: pages.reduce((sum, p) => sum + p.text.length, 0),
    })

    self.postMessage({ type: 'result', pages } satisfies OCRWorkerResult)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OCR failed'
    log.error('OCR error', { error: message })
    self.postMessage({ type: 'error', message } satisfies OCRWorkerError)
  }
}

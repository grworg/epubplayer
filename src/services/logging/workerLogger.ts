/**
 * Logger for Web Workers
 *
 * Usage in a worker:
 *   import { createWorkerLogger } from '@/services/logging/workerLogger'
 *   const log = createWorkerLogger('tts')
 *   log.info('Starting inference', { text: text.substring(0, 50) })
 *
 * The main thread service should handle these messages:
 *   worker.onmessage = (e) => {
 *     if (e.data.type === 'log') {
 *       logFromWorker(e.data)
 *     }
 *   }
 */

import type { LogLevel } from './logStore'
import type { Subsystem } from './logger'

// ============================================================================
// Types
// ============================================================================

export interface WorkerLogMessage {
  type: 'log'
  level: LogLevel
  subsystem: Subsystem
  message: string
  data?: unknown
  ts: number
}

export interface WorkerLogger {
  debug: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Safely serialize data for postMessage
 * Handles Error objects, circular references, etc.
 */
function serializeData(data: unknown): unknown {
  if (data === undefined) return undefined
  if (data === null) return null
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return data
  }
  if (data instanceof Error) {
    return {
      __type: 'Error',
      name: data.name,
      message: data.message,
      stack: data.stack,
    }
  }
  if (Array.isArray(data)) {
    return data.map(serializeData)
  }
  if (typeof data === 'object') {
    try {
      // Test if it's serializable
      JSON.stringify(data)
      return data
    } catch {
      // Not serializable, convert to string
      return String(data)
    }
  }
  return String(data)
}

// ============================================================================
// Worker Logger Implementation
// ============================================================================

function postLog(level: LogLevel, subsystem: Subsystem, message: string, data?: unknown): void {
  try {
    const logMessage: WorkerLogMessage = {
      type: 'log',
      level,
      subsystem,
      message,
      data: serializeData(data),
      ts: Date.now(),
    }
    postMessage(logMessage)
  } catch {
    // If postMessage fails, fall back to console
    console[level](`[${subsystem}] ${message}`, data)
  }
}

/**
 * Create a logger for use inside a Web Worker
 * Logs are sent to the main thread via postMessage
 */
export function createWorkerLogger(subsystem: Subsystem): WorkerLogger {
  return {
    debug: (message: string, data?: unknown) => postLog('debug', subsystem, message, data),
    info: (message: string, data?: unknown) => postLog('info', subsystem, message, data),
    warn: (message: string, data?: unknown) => postLog('warn', subsystem, message, data),
    error: (message: string, data?: unknown) => postLog('error', subsystem, message, data),
  }
}

// ============================================================================
// Main Thread Handler
// ============================================================================

// This is imported on the main thread to handle worker log messages
import { logStore } from './logStore'

/**
 * Format data for copyable console output
 */
function formatData(data: unknown): string {
  if (data === undefined) return ''
  if (data instanceof Error) {
    return data.stack || data.message
  }
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

/**
 * Handle a log message from a worker
 * Call this in your worker.onmessage handler
 */
export function handleWorkerLog(message: WorkerLogMessage): void {
  if (message.type !== 'log') return

  const { level, subsystem, message: msg, data, ts } = message

  // Reconstruct Error objects
  let processedData = data
  if (data && typeof data === 'object' && (data as { __type?: string }).__type === 'Error') {
    const errData = data as { name: string; message: string; stack?: string }
    const err = new Error(errData.message)
    err.name = errData.name
    if (errData.stack) err.stack = errData.stack
    processedData = err
  }

  // Add to log store with the original timestamp
  logStore.addStructured(level, subsystem, msg, processedData)

  // Also output to console
  // Note: We use console.log for debug too, since console.debug is hidden by default
  const timestamp = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const timeStr = `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}.${pad(timestamp.getMilliseconds(), 3)}`

  const prefix = `[${timeStr}] [${subsystem}:worker]`
  const levelTag = `[${level.toUpperCase()}]`
  const consoleMethod = level === 'debug' ? console.log : console[level]

  // Inline stringified data into a single string so logs are copyable from console
  if (processedData !== undefined) {
    consoleMethod(`${prefix} ${levelTag} ${msg} ${formatData(processedData)}`)
  } else {
    consoleMethod(`${prefix} ${levelTag} ${msg}`)
  }
}


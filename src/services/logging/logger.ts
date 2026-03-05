/**
 * Structured Logging System
 *
 * Usage:
 *   import { createLogger } from '@/services/logging'
 *   const log = createLogger('playback')
 *   log.info('Book loaded', { title: book.title })
 *
 * Runtime control (browser console):
 *   logConfig.disable('tts')      // Silence TTS logs
 *   logConfig.setLevel('info')    // Hide debug logs
 *   logConfig.enableAll()         // Reset to defaults
 */

import { logStore, type LogLevel } from './logStore'

// ============================================================================
// Types
// ============================================================================

export type Subsystem =
  | 'tts'        // TTS engines (Supertonic, Kokoro, Piper, ttsManager)
  | 'playback'   // PlaybackController, StateMachine
  | 'buffer'     // TTSBufferManager
  | 'audio'      // Audio backends (BrowserTTS, AudioBlob, SilentKeepalive)
  | 'media'      // MediaSession
  | 'epub'       // EPUB parsing
  | 'storage'    // IndexedDB repositories
  | 'transfer'   // P2P library transfer
  | 'library'    // Book management
  | 'import'     // EPUB import
  | 'app'        // General app/UI
  | 'debug'      // Debug utilities
  | 'gutendex'   // Gutendex API client
  | 'console'    // Fallback for raw console.log calls

export interface Logger {
  debug: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

export interface LogConfig {
  /** Minimum level to log. 'debug' shows all, 'error' shows only errors */
  level: LogLevel
  /** Per-subsystem enable/disable. '*' is the default for unlisted subsystems */
  subsystems: Partial<Record<Subsystem | '*', boolean>>
}

// ============================================================================
// Configuration
// ============================================================================

const STORAGE_KEY = 'epubplayer:logConfig'

const DEFAULT_CONFIG: LogConfig = {
  level: 'debug',
  subsystems: { '*': true },
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  log: 1,
  info: 2,
  warn: 3,
  error: 4,
}

let config: LogConfig = loadConfig()

function loadConfig(): LogConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_CONFIG }
}

function saveConfig(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Ignore storage errors (private mode, etc.)
  }
}

// ============================================================================
// Log Config API (exposed on window.logConfig)
// ============================================================================

export const logConfig = {
  /** Set minimum log level */
  setLevel(level: LogLevel): void {
    config.level = level
    saveConfig()
    console.info(`[logConfig] Level set to: ${level}`)
  },

  /** Get current level */
  getLevel(): LogLevel {
    return config.level
  },

  /** Enable a specific subsystem */
  enable(subsystem: Subsystem | '*'): void {
    config.subsystems[subsystem] = true
    saveConfig()
    console.info(`[logConfig] Enabled: ${subsystem}`)
  },

  /** Disable a specific subsystem */
  disable(subsystem: Subsystem | '*'): void {
    config.subsystems[subsystem] = false
    saveConfig()
    console.info(`[logConfig] Disabled: ${subsystem}`)
  },

  /** Set multiple subsystems at once */
  setSubsystems(subsystems: Partial<Record<Subsystem | '*', boolean>>): void {
    config.subsystems = { ...config.subsystems, ...subsystems }
    saveConfig()
    console.info(`[logConfig] Subsystems updated:`, config.subsystems)
  },

  /** Enable all subsystems */
  enableAll(): void {
    config.subsystems = { '*': true }
    saveConfig()
    console.info(`[logConfig] All subsystems enabled`)
  },

  /** Disable all subsystems */
  disableAll(): void {
    config.subsystems = { '*': false }
    saveConfig()
    console.info(`[logConfig] All subsystems disabled`)
  },

  /** Reset to defaults */
  reset(): void {
    config = { ...DEFAULT_CONFIG }
    saveConfig()
    console.info(`[logConfig] Reset to defaults`)
  },

  /** Get current config (for debugging) */
  getConfig(): LogConfig {
    return { ...config }
  },

  /** Check if a subsystem is enabled */
  isEnabled(subsystem: Subsystem): boolean {
    const explicit = config.subsystems[subsystem]
    if (explicit !== undefined) return explicit
    return config.subsystems['*'] ?? true
  },
}

// ============================================================================
// Logger Implementation
// ============================================================================

function shouldLog(level: LogLevel, subsystem: Subsystem): boolean {
  // Check subsystem filter first (cheapest check)
  if (!logConfig.isEnabled(subsystem)) return false

  // Check level filter
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[config.level]
}

function formatTimestamp(): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

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

function doLog(level: LogLevel, subsystem: Subsystem, message: string, data?: unknown): void {
  if (!shouldLog(level, subsystem)) return

  const timestamp = formatTimestamp()
  const prefix = `[${timestamp}] [${subsystem}]`
  const levelTag = `[${level.toUpperCase()}]`

  // Console output
  // Note: We use console.log for debug too, since console.debug is hidden by default
  // in browser DevTools (requires "Verbose" to be enabled)
  // We inline the stringified data into a single string so it's copyable from the console
  // (passing objects as separate args shows as "Object" when you copy console text)
  const consoleMethod = level === 'debug' ? console.log : console[level]
  if (data !== undefined) {
    consoleMethod(`${prefix} ${levelTag} ${message} ${formatData(data)}`)
  } else {
    consoleMethod(`${prefix} ${levelTag} ${message}`)
  }

  // Store in logStore (for DebugLogsPage)
  const fullMessage = data !== undefined ? `${message} ${formatData(data)}` : message
  logStore.addStructured(level, subsystem, fullMessage, data)
}

/**
 * Create a logger for a specific subsystem
 */
export function createLogger(subsystem: Subsystem): Logger {
  return {
    debug: (message: string, data?: unknown) => doLog('debug', subsystem, message, data),
    info: (message: string, data?: unknown) => doLog('info', subsystem, message, data),
    warn: (message: string, data?: unknown) => doLog('warn', subsystem, message, data),
    error: (message: string, data?: unknown) => doLog('error', subsystem, message, data),
  }
}

// ============================================================================
// Global Exposure
// ============================================================================

declare global {
  interface Window {
    logConfig: typeof logConfig
  }
}

/** Initialize logging system - call once at app startup */
export function initLogging(): void {
  window.logConfig = logConfig
  
  // Log available commands
  const appLog = createLogger('app')
  appLog.info('Logging system initialized')
  appLog.debug('Runtime control available at window.logConfig', {
    commands: [
      'logConfig.setLevel("info")',
      'logConfig.disable("tts")',
      'logConfig.enable("tts")',
      'logConfig.enableAll()',
      'logConfig.getConfig()',
    ],
  })
}


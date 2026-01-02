export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  ts: number
  level: LogLevel
  subsystem: string
  message: string
  data?: unknown
  /** @deprecated Use subsystem instead */
  source?: string
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  // Keep this compact and sortable
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message || String(value)
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatMessage(args: unknown[]): string {
  return args.map(safeStringify).join(' ')
}

class LogStore {
  private entries: LogEntry[] = []
  private listeners = new Set<() => void>()
  private maxEntries = 2000

  /** @deprecated Use addStructured instead */
  add(level: LogLevel, source: string, ...args: unknown[]) {
    this.addEntry({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      level,
      subsystem: source,
      message: formatMessage(args),
      data: args.length === 1 ? args[0] : args,
      source, // Keep for backwards compat
    })
  }

  /** Add a structured log entry from the logger system */
  addStructured(level: LogLevel, subsystem: string, message: string, data?: unknown) {
    this.addEntry({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      level,
      subsystem,
      message,
      data,
    })
  }

  private addEntry(entry: LogEntry) {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }

    for (const l of this.listeners) l()
  }

  clear() {
    this.entries = []
    for (const l of this.listeners) l()
  }

  getSnapshot(): LogEntry[] {
    return this.entries
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toText(): string {
    return this.entries
      .map((e) => `[${formatTs(e.ts)}] [${e.subsystem}] [${e.level.toUpperCase()}] ${e.message}`)
      .join('\n')
  }

  /** Get unique subsystems from current entries */
  getSubsystems(): string[] {
    const subsystems = new Set<string>()
    for (const entry of this.entries) {
      subsystems.add(entry.subsystem)
    }
    return Array.from(subsystems).sort()
  }
}

export const logStore = new LogStore()



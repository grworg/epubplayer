import { useMemo, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { logStore, type LogEntry } from '@/services/logging/logStore'

function useLogEntries(): LogEntry[] {
  return useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.getSnapshot(),
    () => [],
  )
}

function useSubsystems(): string[] {
  return useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.getSubsystems(),
    () => [],
  )
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function DebugLogsPage() {
  const navigate = useNavigate()
  const entries = useLogEntries()
  const subsystems = useSubsystems()

  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all')
  const [subsystem, setSubsystem] = useState<'all' | string>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (level !== 'all' && e.level !== level) return false
      if (subsystem !== 'all' && e.subsystem !== subsystem) return false
      if (!q) return true
      return `${e.subsystem} ${e.level} ${e.message}`.toLowerCase().includes(q)
    })
  }, [entries, level, subsystem, query])

  const handleExport = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `epubplayer-logs-${timestamp}.txt`
    
    // Create a more detailed export format
    const header = [
      '# EPUB Player Debug Logs',
      `# Exported: ${new Date().toISOString()}`,
      `# Total entries: ${entries.length}`,
      `# User Agent: ${navigator.userAgent}`,
      '#',
      '# Format: [timestamp] [subsystem] [LEVEL] message',
      '#'.repeat(80),
      '',
    ].join('\n')
    
    const logText = logStore.toText()
    downloadText(filename, header + logText)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 py-4">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="pressable text-sm text-text-muted">
            Back
          </button>
          <h1 className="text-xl font-bold text-text-primary">Debug Logs</h1>
          <div className="w-10" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="log-filter" className="sr-only">Filter logs</label>
          <input
            id="log-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter logs…"
            className="h-10 flex-1 min-w-[120px] rounded-lg bg-surface-1 px-3 text-sm text-text-primary outline-none ring-1 ring-border-muted"
          />
          <label htmlFor="log-level" className="sr-only">Filter by log level</label>
          <select
            id="log-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
            className="h-10 rounded-lg bg-surface-1 px-3 text-sm text-text-primary outline-none ring-1 ring-border-muted"
            aria-label="Filter by level"
          >
            <option value="all">All Levels</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="log">Log</option>
            <option value="debug">Debug</option>
          </select>
          <label htmlFor="log-subsystem" className="sr-only">Filter by subsystem</label>
          <select
            id="log-subsystem"
            value={subsystem}
            onChange={(e) => setSubsystem(e.target.value)}
            className="h-10 rounded-lg bg-surface-1 px-3 text-sm text-text-primary outline-none ring-1 ring-border-muted"
            aria-label="Filter by subsystem"
          >
            <option value="all">All Subsystems</option>
            {subsystems.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="pressable rounded-lg bg-surface-1 px-3 py-2 text-sm text-text-primary ring-1 ring-border-muted"
            onClick={() => logStore.clear()}
          >
            Clear
          </button>
          <button
            className="pressable rounded-lg bg-surface-1 px-3 py-2 text-sm text-text-primary ring-1 ring-border-muted"
            onClick={async () => {
              const text = logStore.toText()
              try {
                await navigator.clipboard.writeText(text)
                logStore.addStructured('info', 'app', 'Copied logs to clipboard')
              } catch (e) {
                logStore.addStructured('error', 'app', 'Clipboard copy failed', e)
              }
            }}
          >
            Copy
          </button>
          <button
            className="pressable rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white ring-1 ring-accent"
            onClick={handleExport}
          >
            Export Logs
          </button>
        </div>

        <p className="mt-2 text-xs text-text-muted">
          Tip: Use <code className="rounded bg-surface-2 px-1">window.logConfig</code> in browser console to control logging at runtime.
        </p>
      </header>

      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-5 pb-8">
        <div className="rounded-xl bg-surface-1 ring-1 ring-border-muted">
          <div className="border-b border-border-muted px-4 py-3 text-xs text-text-muted">
            Showing {filtered.length} / {entries.length}
          </div>
          <div className="divide-y divide-border-muted">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-sm text-text-muted">No logs.</div>
            ) : (
              filtered
                .slice(-800) // keep UI snappy on mobile
                .map((e) => (
                  <div key={e.id} className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                      <span className="font-mono">{formatTimestamp(e.ts)}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">{e.subsystem}</span>
                      <span
                        className={
                          e.level === 'error'
                            ? 'font-semibold text-error'
                            : e.level === 'warn'
                              ? 'font-semibold text-warning'
                              : e.level === 'debug'
                                ? 'text-text-muted/60'
                                : 'text-text-muted'
                        }
                      >
                        {e.level.toUpperCase()}
                      </span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-primary">
                      {e.message}
                    </pre>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { logStore, type LogLevel } from './logStore'

type ConsoleMethod = (...args: unknown[]) => void

function installConsoleMethod(level: LogLevel, source: string) {
  const c = console as unknown as Record<string, ConsoleMethod>
  const original = c[level] as ConsoleMethod | undefined
  if (!original) return

  c[level] = (...args: unknown[]) => {
    try {
      logStore.add(level, source, ...args)
    } catch {
      // Never break console usage
    }
    try {
      original(...args)
    } catch {
      // ignore
    }
  }
}

export function installConsoleCapture(options?: { source?: string }) {
  const source = options?.source ?? 'main'

  // Avoid double-install
  if ((window as unknown as { __consoleCaptureInstalled?: boolean }).__consoleCaptureInstalled) return
  ;(window as unknown as { __consoleCaptureInstalled?: boolean }).__consoleCaptureInstalled = true

  installConsoleMethod('debug', source)
  installConsoleMethod('log', source)
  installConsoleMethod('info', source)
  installConsoleMethod('warn', source)
  installConsoleMethod('error', source)

  window.addEventListener('error', (e) => {
    logStore.add('error', source, '[window.error]', e.message, e.error instanceof Error ? e.error.stack : e.error)
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reason = (e as PromiseRejectionEvent).reason
    logStore.add('error', source, '[unhandledrejection]', reason instanceof Error ? reason.stack : reason)
  })

  logStore.add('info', source, '[log] console capture installed')
}



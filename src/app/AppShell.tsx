import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { MiniPlayer } from '@/features/player/MiniPlayer'
import { usePlayerStore } from '@/features/player/playerStore'
import { ttsManager } from '@/services/tts'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { createLogger } from '@/services/logging'

const log = createLogger('app')

export function AppShell() {
  const location = useLocation()
  const currentBook = usePlayerStore((s) => s.currentBook)
  const [ttsPreloadStatus, setTtsPreloadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  // Eager TTS preloading - start model download as soon as app shell mounts
  // This eliminates the 10+ second wait when user first presses play
  useEffect(() => {
    const checkAndPreloadTTS = async () => {
      try {
        const settings = await settingsRepository.getAll()
        const engine = settings.ttsEngine
        const capabilities = ttsManager.getEngineCapabilities(engine)

        // Only preload if engine requires initialization (Supertonic, Kokoro, Piper)
        // Browser TTS is instant and doesn't need preloading
        if (!capabilities.requiresInit) {
          log.debug('TTS engine does not require preloading', { engine })
          setTtsPreloadStatus('ready')
          return
        }

        // If already ready, we're done
        if (ttsManager.getIsReady()) {
          log.debug('TTS already ready')
          setTtsPreloadStatus('ready')
          return
        }
        
        // If loading (e.g., started by onboarding), just track the status
        if (ttsManager.getIsLoading()) {
          log.debug('TTS already loading, tracking status')
          setTtsPreloadStatus('loading')
          // Wait for it to complete
          try {
            await ttsManager.initialize() // Will return existing promise
            setTtsPreloadStatus('ready')
          } catch {
            setTtsPreloadStatus('error')
          }
          return
        }

        // Start preloading
        log.info('Preloading TTS engine', { engine })
        setTtsPreloadStatus('loading')

        await ttsManager.initialize()

        log.info('TTS preload complete', { engine })
        setTtsPreloadStatus('ready')
      } catch (err) {
        log.error('TTS preload failed', err)
        setTtsPreloadStatus('error')
        // Don't throw - preload failure shouldn't break the app
        // User will see loading when they try to play
      }
    }

    checkAndPreloadTTS()
    
    // Also poll briefly to catch loading started by onboarding
    // (onboarding starts preload after settings saved, before navigation completes)
    const pollInterval = setInterval(() => {
      if (ttsManager.getIsLoading() && ttsPreloadStatus !== 'loading') {
        setTtsPreloadStatus('loading')
        // Wait for completion
        ttsManager.initialize()
          .then(() => setTtsPreloadStatus('ready'))
          .catch(() => setTtsPreloadStatus('error'))
        clearInterval(pollInterval)
      } else if (ttsManager.getIsReady() && ttsPreloadStatus === 'loading') {
        setTtsPreloadStatus('ready')
        clearInterval(pollInterval)
      }
    }, 500)
    
    // Stop polling after 30 seconds (model should be loaded by then)
    const timeout = setTimeout(() => clearInterval(pollInterval), 30000)
    
    return () => {
      clearInterval(pollInterval)
      clearTimeout(timeout)
    }
  }, [ttsPreloadStatus])

  // Hide mini-player on the full Now Playing screen
  const showMiniPlayer = currentBook && location.pathname !== '/app/playing'

  // Now Playing page needs full-bleed layout
  const isFullBleed = location.pathname === '/app/playing'

  return (
    <div className="flex h-full flex-col bg-surface-0">
      {/* TTS preload indicator - subtle, non-blocking */}
      {ttsPreloadStatus === 'loading' && (
        <div className="flex items-center justify-center gap-2 bg-surface-1 px-3 py-1.5 text-xs text-text-muted">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span>Loading TTS engine...</span>
        </div>
      )}

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className={isFullBleed ? 'h-full' : 'mx-auto h-full max-w-6xl'}>
          <Outlet />
        </div>
      </main>

      {/* Mini player (shows when a book is active and not on Now Playing page) */}
      {showMiniPlayer && <MiniPlayer />}
    </div>
  )
}

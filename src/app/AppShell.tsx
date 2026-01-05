import { useEffect, useState, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { MiniPlayer } from '@/features/player/MiniPlayer'
import { usePlayerStore } from '@/features/player/playerStore'
import { playbackController } from '@/features/player/PlaybackController'
import { ttsManager } from '@/services/tts'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { bookRepository } from '@/services/storage'
import { createLogger } from '@/services/logging'

const log = createLogger('app')

export function AppShell() {
  const location = useLocation()
  const currentBook = usePlayerStore((s) => s.currentBook)
  const setCurrentBook = usePlayerStore((s) => s.setCurrentBook)
  const [ttsPreloadStatus, setTtsPreloadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const rehydrationAttempted = useRef(false)

  // Rehydrate playback state after page refresh
  // When the store has a persisted currentBook but the controller isn't loaded,
  // we need to reload the book from IndexedDB to restore full playback capability
  useEffect(() => {
    const rehydratePlayback = async () => {
      // Only attempt once per app load
      if (rehydrationAttempted.current) return
      rehydrationAttempted.current = true

      // If no persisted book, nothing to rehydrate
      if (!currentBook?.id) return

      try {
        // Fetch the full book from IndexedDB (includes coverUrl from blob)
        const fullBook = await bookRepository.get(currentBook.id)
        
        if (!fullBook) {
          // Book was deleted - clear the stale state
          log.warn('Persisted book not found in IndexedDB, clearing state', { id: currentBook.id })
          setCurrentBook(null)
          return
        }

        // Build the book object for the player (with fresh coverUrl from IndexedDB)
        const bookForPlayer = {
          id: fullBook.id,
          title: fullBook.title,
          author: fullBook.author,
          coverUrl: fullBook.coverUrl, // Fresh blob URL from IndexedDB
        }

        log.info('Rehydrating playback state', { title: fullBook.title })
        
        // Load the book into the playback controller
        // This restores sections, chunks, saved position, etc.
        await playbackController.loadBook(bookForPlayer)
        
        log.info('Playback state rehydrated successfully')
      } catch (err) {
        log.error('Failed to rehydrate playback state', err)
        // Don't clear the state - user can still navigate to the book manually
      }
    }

    rehydratePlayback()
  }, []) // Run once on mount - currentBook comes from persisted zustand state

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
      <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className={isFullBleed ? 'h-full' : 'mx-auto h-full max-w-6xl'}>
          <Outlet />
        </div>
      </main>

      {/* Mini player (shows when a book is active and not on Now Playing page) */}
      {showMiniPlayer && <MiniPlayer />}
    </div>
  )
}

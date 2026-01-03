/**
 * Playback Controller
 * 
 * Clean, reliable playback coordination using:
 * - PlaybackStateMachine for state management
 * - AudioBackend interface for audio playback
 * - ChunkManager for text chunking
 * 
 * This replaces the old PlaybackManager with a simpler, more reliable design.
 */

import { createLogger } from '@/services/logging'
import { playbackStateMachine, type PlaybackState } from './PlaybackStateMachine'
import { chunkManager, type ChunkInfo } from './ChunkManager'
import { BrowserTTSBackend, AudioBlobBackend, type AudioBackend } from './audioBackends'
import { usePlayerStore, type Book } from './playerStore'
import {
  playbackRepository,
  sectionRepository,
  bookRepository,
  audioChunkRepository,
} from '@/services/storage'
import type { Section } from '@/services/storage'
import { ttsManager, type TTSEngine } from '@/services/tts'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { ttsBufferManager } from './TTSBufferManager'
import { mediaSessionManager } from './MediaSessionManager'

const log = createLogger('playback')

// ============================================================================
// Playback Controller
// ============================================================================

class PlaybackController {
  private sections: Section[] = []
  private audioBackend: AudioBackend
  private currentEngine: TTSEngine = 'browser'
  private voiceId = 'default'
  private modelConfig = 'q4'
  
  // Debounced save
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  // Pending seek time (for resuming mid-chunk)
  // Set when loading a book with saved timeInChunk, consumed when playback starts
  private pendingSeekTime: number = 0

  constructor() {
    // Default to browser TTS backend
    this.audioBackend = new BrowserTTSBackend({
      onStart: () => this.onPlaybackStart(),
      onEnd: () => this.onPlaybackEnd(),
      onError: (error) => this.onPlaybackError(error),
      onProgress: (currentTime, duration) => this.onPlaybackProgress(currentTime, duration),
    })

    // Subscribe to state changes for side effects
    playbackStateMachine.subscribe((state, prevState) => {
      this.onStateChange(state, prevState)
    })

    // Initialize Media Session API for lock screen controls & background playback
    mediaSessionManager.init({
      onPlay: () => this.play(),
      onPause: () => this.pause(),
      onSeekForward: () => this.skipForward(),
      onSeekBackward: () => this.skipBack(),
      onNextTrack: () => this.nextSection(),
      onPreviousTrack: () => this.previousSection(),
      onStop: () => this.stop(),
    })
  }

  // ============================================================================
  // Pending Seek Time Management
  // ============================================================================

  /**
   * Consume and clear the pending seek time.
   * Returns the time to seek to (0 if none pending).
   * This ensures the seek time is only used once.
   */
  private consumePendingSeekTime(): number {
    const time = this.pendingSeekTime
    this.pendingSeekTime = 0
    return time
  }

  /**
   * Clear pending seek time (e.g., when user navigates manually).
   * Called when user explicitly changes position, so we don't
   * accidentally seek to a stale position.
   */
  private clearPendingSeekTime(): void {
    this.pendingSeekTime = 0
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Load a book for playback
   */
  async loadBook(book: Book): Promise<void> {
    const currentBookId = playbackStateMachine.getCurrentBookId()
    const state = playbackStateMachine.getState()
    
    // Same book already loaded? Just ensure we're in a playable state
    if (currentBookId === book.id && state.status !== 'idle' && state.status !== 'loading') {
      log.debug('Book already loaded, skipping', { bookId: book.id })
      return
    }

    // Switching to a DIFFERENT book - need to properly unload the current one
    if (state.status !== 'idle') {
      const switchingFrom = currentBookId
      log.info('Switching books', { from: switchingFrom, to: book.id, fromStatus: state.status })
      
      // Save position for current book before switching
      if (currentBookId) {
        await this.savePosition()
      }
      
      // Stop audio playback
      this.audioBackend.stop()
      
      // Stop background buffering
      ttsBufferManager.stop()
      
      // Unload current book to return to idle state
      // This allows LOAD_BOOK to succeed (only valid from idle)
      if (!playbackStateMachine.dispatch({ type: 'UNLOAD' })) {
        log.error('Failed to unload current book', { status: state.status })
        return
      }
    }

    // Start loading the new book (now we're in 'idle' state)
    if (!playbackStateMachine.dispatch({ type: 'LOAD_BOOK', bookId: book.id })) {
      log.error('Failed to start loading book', { bookId: book.id, status: playbackStateMachine.getStatus() })
      return
    }

    try {
      // Load settings
      const settings = await settingsRepository.getAll()
      this.currentEngine = settings.ttsEngine as TTSEngine
      // Get voice ID based on engine (each engine has its own voice setting)
      this.voiceId = this.getVoiceForEngine(settings)
      this.modelConfig = settings.modelConfig

      // Switch audio backend based on engine
      this.switchAudioBackend(this.currentEngine)

      // Load sections from DB
      this.sections = await sectionRepository.getForBook(book.id)

      // Load saved playback state
      const savedState = await playbackRepository.get(book.id)

      // Update store with book info
      const store = usePlayerStore.getState()
      store.setCurrentBook(book)

      // Set Media Session metadata for lock screen / background playback
      mediaSessionManager.setBook(book)

      // Load global playback speed (not per-book)
      const globalSpeed = settings.defaultSpeed
      store.setSpeed(globalSpeed)
      
      if (savedState) {
        playbackStateMachine.setState({
          sectionIndex: savedState.sectionIndex,
          chunkIndex: savedState.chunkIndex,
        })
        // Note: We DON'T restore voiceId or speed from savedState anymore
        // - Voice setting is engine-specific and should come from current settings
        // - Speed is now a global preference, not per-book
        this.modelConfig = savedState.modelConfig
        // Store pending seek time for when playback starts
        this.pendingSeekTime = savedState.timeInChunk || 0
        if (this.pendingSeekTime > 0) {
          log.debug('Will resume mid-chunk', { seekTime: this.pendingSeekTime })
        }
      } else {
        this.pendingSeekTime = 0
      }

      // Load chunks for current section
      const state = playbackStateMachine.getState()
      await this.loadSectionChunks(state.sectionIndex)

      // For engines that pre-generate audio blobs: initialize TTS engine EARLY
      // This eliminates the lag when user first presses play
      const capabilities = ttsManager.getEngineCapabilities(this.currentEngine)
      if (capabilities.generatesBlobs) {
        // Start TTS initialization immediately (non-blocking)
        // The buffer manager will wait for it to be ready before generating
        if (capabilities.requiresInit && !ttsManager.getIsReady() && !ttsManager.getIsLoading()) {
          log.debug('Pre-initializing TTS engine')
          ttsManager.initialize().catch((err) => {
            log.error('TTS pre-initialization failed', err)
          })
        }

        // Start background buffering
        // IMPORTANT: Start AFTER restoring saved position and loading section chunks
        // to avoid race condition where buffer manager starts at (0,0)
        ttsBufferManager.start({
          bookId: book.id,
          voiceId: this.voiceId,
          modelConfig: this.modelConfig,
          sections: this.sections,
          engine: this.currentEngine,
        })
        // Explicitly tell buffer manager where to start buffering
        ttsBufferManager.setBufferTarget(state.sectionIndex, state.chunkIndex)
      } else {
        ttsBufferManager.stop()
      }

      // Update section title
      const currentSection = this.sections[state.sectionIndex]
      if (currentSection) {
        store.setCurrentSectionTitle(currentSection.title)
        mediaSessionManager.setChapterTitle(currentSection.title)
      }

      // Mark book as played
      await bookRepository.markPlayed(book.id)

      // Mark loaded
      playbackStateMachine.dispatch({ type: 'LOADED' })

      log.info('Book loaded', { title: book.title, id: book.id })
    } catch (error) {
      log.error('Book load failed', error)
      playbackStateMachine.dispatch({ 
        type: 'ERROR', 
        error: error instanceof Error ? error.message : 'Failed to load book' 
      })
    }
  }

  /**
   * Start or resume playback
   */
  async play(): Promise<void> {
    const state = playbackStateMachine.getState()
    log.debug('play() called', { currentState: state.status })

    // Can we play?
    if (state.status === 'paused') {
      // Try to resume - but if audio backend has nothing to resume, start fresh
      log.debug('Attempting resume from pause')
      
      // Check if audio backend can actually resume
      const isPaused = this.audioBackend.isPaused?.() ?? false
      const canResume = this.audioBackend.isPlaying() || isPaused
      
      if (canResume) {
        if (playbackStateMachine.dispatch({ type: 'RESUME' })) {
          this.audioBackend.resume()
        }
        return
      }
      
      // Nothing to resume - transition to ready and start fresh
      log.debug('Nothing to resume, starting fresh')
      this.audioBackend.stop()
      playbackStateMachine.dispatch({ type: 'STOP' })
      await this.playCurrentChunk()
      return
    }

    if (state.status === 'idle') {
      log.warn('No book loaded - cannot play')
      return
    }

    if (state.status === 'loading') {
      log.warn('Book is loading - please wait')
      return
    }

    if (state.status === 'buffering') {
      log.debug('Already buffering - waiting for audio')
      return
    }

    if (state.status === 'playing') {
      log.debug('Already playing')
      return
    }

    if (state.status !== 'ready') {
      log.warn('Cannot play from state', { state: state.status })
      return
    }

    // Start fresh playback
    log.debug('Starting playCurrentChunk')
    await this.playCurrentChunk()
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (playbackStateMachine.dispatch({ type: 'PAUSE' })) {
      this.audioBackend.pause()
      this.savePosition()
      mediaSessionManager.setPlaybackState('paused')
    }
  }

  /**
   * Toggle play/pause
   */
  async togglePlayback(): Promise<void> {
    if (playbackStateMachine.isPlaying()) {
      this.pause()
    } else {
      await this.play()
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (playbackStateMachine.dispatch({ type: 'STOP' })) {
      this.audioBackend.stop()
      this.savePosition()
      mediaSessionManager.setPlaybackState('paused')
      mediaSessionManager.clearPositionState()
    }
    // Keep buffering while stopped (book still loaded)
    ttsBufferManager.kick()
  }

  /**
   * Go to next section
   */
  async nextSection(): Promise<void> {
    const state = playbackStateMachine.getState()
    const nextIndex = state.sectionIndex + 1

    if (nextIndex >= this.sections.length) {
      return
    }

    const wasPlaying = playbackStateMachine.isPlaying()
    
    // Stop current playback
    this.audioBackend.stop()
    this.clearPendingSeekTime() // User is navigating manually
    
    // Seek to new position
    playbackStateMachine.dispatch({
      type: 'SEEK_CHUNK',
      sectionIndex: nextIndex,
      chunkIndex: 0,
    })

    await this.loadSectionChunks(nextIndex)
    
    // Update buffer target to new position
    ttsBufferManager.setBufferTarget(nextIndex, 0)
    
    await this.savePosition()

    if (wasPlaying) {
      await this.playCurrentChunk()
    }
  }

  /**
   * Go to previous section (or restart current)
   */
  async previousSection(): Promise<void> {
    const state = playbackStateMachine.getState()
    const wasPlaying = playbackStateMachine.isPlaying()

    this.audioBackend.stop()
    this.clearPendingSeekTime() // User is navigating manually

    let targetSection = state.sectionIndex
    if (state.chunkIndex > 0) {
      // Restart current section
      playbackStateMachine.dispatch({
        type: 'SEEK_CHUNK',
        sectionIndex: state.sectionIndex,
        chunkIndex: 0,
      })
    } else if (state.sectionIndex > 0) {
      // Go to previous section
      targetSection = state.sectionIndex - 1
      playbackStateMachine.dispatch({
        type: 'SEEK_CHUNK',
        sectionIndex: targetSection,
        chunkIndex: 0,
      })
      await this.loadSectionChunks(targetSection)
    }

    // Update buffer target to new position
    ttsBufferManager.setBufferTarget(targetSection, 0)

    await this.savePosition()

    if (wasPlaying) {
      await this.playCurrentChunk()
    }
  }

  /**
   * Go to specific section
   */
  async goToSection(sectionIndex: number): Promise<void> {
    if (sectionIndex < 0 || sectionIndex >= this.sections.length) {
      return
    }

    const wasPlaying = playbackStateMachine.isPlaying()
    
    this.audioBackend.stop()
    this.clearPendingSeekTime() // User is navigating manually
    
    playbackStateMachine.dispatch({
      type: 'SEEK_CHUNK',
      sectionIndex,
      chunkIndex: 0,
    })

    await this.loadSectionChunks(sectionIndex)
    
    // Update buffer target to new position
    ttsBufferManager.setBufferTarget(sectionIndex, 0)
    
    await this.savePosition()

    if (wasPlaying) {
      await this.playCurrentChunk()
    }
  }

  /**
   * Go to specific chunk in current section
   */
  async goToChunk(chunkIndex: number): Promise<void> {
    // Validate chunk index
    if (isNaN(chunkIndex) || !Number.isFinite(chunkIndex)) {
      log.error('goToChunk with invalid index', { chunkIndex })
      return
    }
    
    chunkIndex = Math.floor(chunkIndex) // Ensure integer
    
    const state = playbackStateMachine.getState()
    const sectionChunks = chunkManager.getSectionChunkCount(state.sectionIndex)

    if (chunkIndex < 0 || chunkIndex >= sectionChunks) {
      log.warn('goToChunk out of range', { chunkIndex, max: sectionChunks })
      return
    }

    const wasPlaying = playbackStateMachine.isPlaying()
    
    this.audioBackend.stop()
    this.clearPendingSeekTime() // User is navigating manually
    
    playbackStateMachine.dispatch({
      type: 'SEEK_CHUNK',
      sectionIndex: state.sectionIndex,
      chunkIndex,
    })

    // Update buffer target to new position
    ttsBufferManager.setBufferTarget(state.sectionIndex, chunkIndex)

    await this.savePosition()

    if (wasPlaying) {
      await this.playCurrentChunk()
    }
  }

  /**
   * Skip forward (next chunk for browser TTS, seek for audio blob)
   */
  async skipForward(): Promise<void> {
    if (this.currentEngine === 'browser') {
      await this.advanceToNextChunk()
    } else if (this.audioBackend instanceof AudioBlobBackend) {
      this.audioBackend.seekRelative(30)
    }
  }

  /**
   * Skip backward (restart chunk for browser TTS, seek for audio blob)
   * 
   * For audio blob backends (Kokoro/Piper/Supertonic):
   * - If current position > threshold, seek back 30 seconds within current chunk
   * - If current position <= threshold (or would seek past start), go to previous chunk
   * This matches standard audiobook behavior where tapping back near the start
   * goes to the previous track.
   */
  async skipBack(): Promise<void> {
    const state = playbackStateMachine.getState()
    const wasPlaying = state.status === 'playing' || state.status === 'buffering'

    if (this.currentEngine === 'browser') {
      // Browser TTS: restart current chunk (can't seek within synthesized speech)
      this.audioBackend.stop()
      
      // Reset state to ready by dispatching SEEK_CHUNK to current position
      playbackStateMachine.dispatch({
        type: 'SEEK_CHUNK',
        sectionIndex: state.sectionIndex,
        chunkIndex: state.chunkIndex,
      })
      
      if (wasPlaying) {
        await this.playCurrentChunk()
      }
    } else if (this.audioBackend instanceof AudioBlobBackend) {
      const currentTime = this.audioBackend.getCurrentTime()
      const THRESHOLD_SECONDS = 3 // If within 3 seconds of start, go to previous chunk
      
      // Check if we should go to previous chunk instead of just seeking within current
      if (currentTime <= THRESHOLD_SECONDS) {
        // Go to previous chunk
        const prevPos = chunkManager.getPreviousPosition({
          sectionIndex: state.sectionIndex,
          chunkIndex: state.chunkIndex,
        })
        
        if (prevPos) {
          log.debug('Skip back to previous chunk', { 
            from: `s${state.sectionIndex}c${state.chunkIndex}`, 
            to: `s${prevPos.sectionIndex}c${prevPos.chunkIndex}` 
          })
          
          this.audioBackend.stop()
          this.clearPendingSeekTime()
          
          // Check if we need to load the previous section
          if (prevPos.sectionIndex !== state.sectionIndex) {
            await this.loadSectionChunks(prevPos.sectionIndex)
          }
          
          playbackStateMachine.dispatch({
            type: 'SEEK_CHUNK',
            sectionIndex: prevPos.sectionIndex,
            chunkIndex: prevPos.chunkIndex,
          })
          
          ttsBufferManager.setBufferTarget(prevPos.sectionIndex, prevPos.chunkIndex)
          await this.savePosition()
          
          if (wasPlaying) {
            await this.playCurrentChunk()
          }
        } else {
          // At the beginning of the book - just seek to start of current chunk
          this.audioBackend.seekTo(0)
        }
      } else {
        // Seek back 30 seconds within current chunk
        this.audioBackend.seekRelative(-30)
      }
    }
  }

  /**
   * Set playback speed (global setting, applies to all books)
   */
  async setSpeed(speed: number): Promise<void> {
    const state = playbackStateMachine.getState()
    const wasPlaying = state.status === 'playing' || state.status === 'buffering'
    
    // Update backend and store
    this.audioBackend.setSpeed(speed)
    usePlayerStore.getState().setSpeed(speed)

    // For browser TTS, restart chunk with new speed
    if (this.currentEngine === 'browser' && wasPlaying) {
      this.audioBackend.stop()
      ttsBufferManager.kick()
      // Reset state to ready
      playbackStateMachine.dispatch({
        type: 'SEEK_CHUNK',
        sectionIndex: state.sectionIndex,
        chunkIndex: state.chunkIndex,
      })
      await this.playCurrentChunk()
    }

    // Save to global settings (speed is a user preference, not per-book)
    await settingsRepository.set('defaultSpeed', speed)
  }

  /**
   * Reload TTS settings and hot-swap engine if changed.
   * Called when user changes TTS settings while a book is loaded.
   * This avoids requiring an app refresh for settings to take effect.
   */
  async reloadTTSSettings(): Promise<void> {
    const state = playbackStateMachine.getState()
    
    // Only relevant if a book is loaded
    if (state.status === 'idle') {
      log.debug('reloadTTSSettings: no book loaded, skipping')
      return
    }

    const wasPlaying = state.status === 'playing' || state.status === 'buffering'
    const bookId = state.bookId

    log.info('Reloading TTS settings', { wasPlaying, bookId })

    // Stop current playback
    if (wasPlaying) {
      this.audioBackend.stop()
    }

    // Stop buffer manager (it will be restarted with new context)
    ttsBufferManager.stop()

    // Re-read settings from repository
    const settings = await settingsRepository.getAll()
    const newEngine = settings.ttsEngine as TTSEngine
    const newVoiceId = this.getVoiceForEngine(settings)
    const newModelConfig = settings.modelConfig

    const engineChanged = newEngine !== this.currentEngine
    const voiceChanged = newVoiceId !== this.voiceId
    const modelChanged = newModelConfig !== this.modelConfig

    log.info('TTS settings comparison', {
      engineChanged,
      voiceChanged,
      modelChanged,
      oldEngine: this.currentEngine,
      newEngine,
    })

    // Update cached values
    this.currentEngine = newEngine
    this.voiceId = newVoiceId
    this.modelConfig = newModelConfig

    // Switch audio backend if engine type changed (browser vs blob-based)
    if (engineChanged) {
      this.switchAudioBackend(newEngine)
    }

    // Restart buffer manager for blob-based engines
    const capabilities = ttsManager.getEngineCapabilities(newEngine)
    if (capabilities.generatesBlobs && bookId) {
      // Pre-initialize the TTS engine
      if (capabilities.requiresInit && !ttsManager.getIsReady() && !ttsManager.getIsLoading()) {
        log.debug('Pre-initializing new TTS engine')
        ttsManager.initialize().catch((err) => {
          log.error('TTS pre-initialization failed after settings change', err)
        })
      }

      // Restart buffer manager with new context
      ttsBufferManager.start({
        bookId,
        voiceId: this.voiceId,
        modelConfig: this.modelConfig,
        sections: this.sections,
        engine: this.currentEngine,
      })
      ttsBufferManager.setBufferTarget(state.sectionIndex, state.chunkIndex)
    }

    // If was playing, we need to transition state machine back to ready
    // so the user can press play again (we don't auto-resume to avoid surprises)
    if (wasPlaying) {
      playbackStateMachine.dispatch({
        type: 'SEEK_CHUNK',
        sectionIndex: state.sectionIndex,
        chunkIndex: state.chunkIndex,
      })
    }

    log.info('TTS settings reloaded', { engine: newEngine, voice: this.voiceId })
  }

  /**
   * Get chunk info for UI
   */
  getChunkInfo(): { current: number; total: number; progress: number } {
    const state = playbackStateMachine.getState()
    return chunkManager.getStats({
      sectionIndex: state.sectionIndex,
      chunkIndex: state.chunkIndex,
    })
  }

  /**
   * Get sections
   */
  getSections(): Section[] {
    return this.sections
  }

  /**
   * Get current section
   */
  getCurrentSection(): Section | undefined {
    const state = playbackStateMachine.getState()
    return this.sections[state.sectionIndex]
  }

  /**
   * Calculate total book progress (0-1)
   */
  getProgress(): number {
    if (this.sections.length === 0) return 0

    const state = playbackStateMachine.getState()
    const totalChars = this.sections.reduce((sum, s) => sum + s.charCount, 0)
    const completedChars = this.sections
      .slice(0, state.sectionIndex)
      .reduce((sum, s) => sum + s.charCount, 0)

    const currentSection = this.sections[state.sectionIndex]
    const sectionChunks = chunkManager.getSectionChunkCount(state.sectionIndex)
    const sectionProgress = sectionChunks > 0 ? state.chunkIndex / sectionChunks : 0
    const currentChars = currentSection ? currentSection.charCount * sectionProgress : 0

    return (completedChars + currentChars) / totalChars
  }

  /**
   * Get the audio backend (for lyrics view word tracking)
   */
  getAudioBackend(): AudioBackend {
    return this.audioBackend
  }

  /**
   * Get current chunk text (for lyrics view)
   */
  getCurrentChunkText(): string {
    const state = playbackStateMachine.getState()
    const chunk = chunkManager.getChunk({
      sectionIndex: state.sectionIndex,
      chunkIndex: state.chunkIndex,
    })
    return chunk?.text ?? ''
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private switchAudioBackend(engine: TTSEngine): void {
    // Destroy old backend
    this.audioBackend.destroy()

    // Create new backend
    const events = {
      onStart: () => this.onPlaybackStart(),
      onEnd: () => this.onPlaybackEnd(),
      onError: (error: string) => this.onPlaybackError(error),
    }

    if (engine === 'browser') {
      this.audioBackend = new BrowserTTSBackend(events)
    } else {
      this.audioBackend = new AudioBlobBackend(events)
    }

    log.info('Switched audio backend', { engine })
  }

  /**
   * Get the correct voice ID for the current engine.
   * Each engine has its own voice setting:
   * - browser/kokoro: voiceId
   * - piper: piperModel
   * - supertonic: supertonicVoice
   */
  private getVoiceForEngine(settings: {
    voiceId: string
    piperModel: string
    supertonicVoice: string
  }): string {
    switch (this.currentEngine) {
      case 'supertonic':
        return settings.supertonicVoice
      case 'piper':
        return settings.piperModel
      default:
        return settings.voiceId
    }
  }

  private async loadSectionChunks(sectionIndex: number): Promise<void> {
    const section = this.sections[sectionIndex]
    if (!section) return

    // Check if already loaded
    if (chunkManager.isSectionLoaded(sectionIndex)) {
      return
    }

    // Load section text and create chunks
    await chunkManager.loadSection(sectionIndex, section.textContent)

    // Update section title in store and Media Session
    usePlayerStore.getState().setCurrentSectionTitle(section.title)
    mediaSessionManager.setChapterTitle(section.title)
  }

  private async playCurrentChunk(): Promise<void> {
    const state = playbackStateMachine.getState()
    const pos = `s${state.sectionIndex}c${state.chunkIndex}`
    
    const signal = playbackStateMachine.resetAbortController()

    // Get current chunk
    const chunk = chunkManager.getChunk({
      sectionIndex: state.sectionIndex,
      chunkIndex: state.chunkIndex,
    })

    if (!chunk) {
      log.error('Chunk not found', { pos, available: chunkManager.getSectionChunkCount(state.sectionIndex) })
      playbackStateMachine.dispatch({ type: 'ERROR', error: 'Chunk not found' })
      return
    }

    log.debug('Playing chunk', { pos, textPreview: chunk.text.substring(0, 40), length: chunk.text.length })

    // Transition to playing
    if (!playbackStateMachine.dispatch({ type: 'PLAY' })) {
      log.error('Failed to dispatch PLAY - invalid state', { 
        pos, 
        currentStatus: playbackStateMachine.getStatus(),
        expectedStatus: 'ready'
      })
      return
    }

    try {
      if (this.currentEngine === 'browser') {
        // Browser TTS - play text directly
        const speed = usePlayerStore.getState().speed
        await this.audioBackend.play(chunk.text, {
          voiceId: this.voiceId,
          speed,
          signal,
        })
      } else {
        // Kokoro/Piper - check cache or generate (both use AudioBlobBackend)
        // Uses two-tier cache: position-specific first, then global text-hash fallback
        const cacheStart = Date.now()
        const { chunk: cached, source: cacheSource } = await audioChunkRepository.getWithFallback(
          state.bookId!,
          chunk.sectionIndex,
          chunk.chunkIndex,
          this.voiceId,
          this.modelConfig,
          chunk.textHash
        )

        if (cached) {
          const sourceLabel = cacheSource === 'textHash' ? 'GLOBAL_CACHE' : 'CACHE_HIT'
          log.debug('Cache hit', { pos, source: sourceLabel, lookupMs: Date.now() - cacheStart, duration: cached.duration })
          // Nudge background buffering
          ttsBufferManager.kick()
          const blobBackend = this.audioBackend as AudioBlobBackend
          
          // Get and consume pending seek time (for resuming mid-chunk)
          const startTime = this.consumePendingSeekTime()
          if (startTime > 0) {
            log.debug('Resuming mid-chunk', { pos, startTime })
          }
          
          // Get current speed from store
          const speed = usePlayerStore.getState().speed
          
          // Play with optional startTime for resuming mid-chunk
          await blobBackend.playBlob(cached.audioBlob, { signal, startTime, speed })
        } else {
          // Need to generate - show buffering
          log.debug('Cache miss, generating', { pos })
          playbackStateMachine.dispatch({ type: 'BUFFER_NEEDED' })
          
          // Generate audio (works with both Kokoro and Piper via ttsBufferManager)
          await this.generateAndPlayChunk(chunk, signal)
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.debug('Playback aborted', { pos })
        return
      }
      
      log.error('Playback error', { pos, error })
      playbackStateMachine.dispatch({
        type: 'ERROR',
        error: error instanceof Error ? error.message : 'Playback failed',
      })
    }
  }

  private async generateAndPlayChunk(chunk: ChunkInfo, signal: AbortSignal): Promise<void> {
    const pos = `s${chunk.sectionIndex}c${chunk.chunkIndex}`
    const genStart = Date.now()
    
    // Ensure TTS engine is initialized with latest settings
    if (!ttsManager.getIsReady()) {
      log.debug('Waiting for TTS init', { pos })
      await ttsManager.initialize()
      log.debug('TTS ready', { pos, initMs: Date.now() - genStart })
    }

    const abortError = new DOMException('Aborted', 'AbortError')
    
    // Track whether generation has completed to prevent stale abort listeners
    // from cancelling the buffer manager's work when the next chunk starts
    let generationComplete = false
    
    const abortHandler = () => {
      // Only cancel if we haven't completed yet
      // This prevents the abort listener from firing when resetAbortController()
      // is called for the NEXT chunk, which would kill buffer manager's in-flight work
      if (!generationComplete) {
        ttsManager.cancelAll()
      }
    }
    
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        abortHandler()
        reject(abortError)
        return
      }
      signal.addEventListener('abort', () => {
        abortHandler()
        reject(abortError)
      }, { once: true })
    })

    const audio = await Promise.race([ttsBufferManager.getOrGenerateChunk(chunk, 'playback'), abortPromise])
    
    // Mark generation as complete BEFORE playing audio
    // This prevents the abort listener from firing cancelAll() when the next chunk starts
    generationComplete = true
    const genMs = Date.now() - genStart
    log.debug('Generated audio', { pos, genMs, duration: audio.duration })

    // Play the audio - transition from buffering to playing
    const bufferReadyOk = playbackStateMachine.dispatch({ type: 'BUFFER_READY' })
    if (!bufferReadyOk) {
      log.error('Failed to dispatch BUFFER_READY', { 
        pos, 
        currentStatus: playbackStateMachine.getStatus(),
        expectedStatus: 'buffering'
      })
      // Continue anyway - the audio was generated, try to play it
    }
    const blobBackend = this.audioBackend as AudioBlobBackend
    // Nudge background buffering while audio is playing
    ttsBufferManager.kick()
    
    // Get and consume pending seek time (for resuming mid-chunk)
    const startTime = this.consumePendingSeekTime()
    if (startTime > 0) {
      log.debug('Resuming after generation', { pos, startTime })
    }
    
    // Get current speed from store
    const speed = usePlayerStore.getState().speed
    
    // Play with optional startTime for resuming mid-chunk
    await blobBackend.playBlob(audio.blob, { signal, startTime, speed })
  }

  private async advanceToNextChunk(): Promise<void> {
    const state = playbackStateMachine.getState()
    const pos = `s${state.sectionIndex}c${state.chunkIndex}`
    
    const nextPos = chunkManager.getNextPosition(
      { sectionIndex: state.sectionIndex, chunkIndex: state.chunkIndex },
      this.sections.length
    )

    if (!nextPos) {
      // End of book
      log.info('End of book', { lastPos: pos })
      playbackStateMachine.dispatch({ type: 'STOP' })
      mediaSessionManager.setPlaybackState('paused')
      return
    }

    const nextPosStr = `s${nextPos.sectionIndex}c${nextPos.chunkIndex}`
    const isNewSection = nextPos.sectionIndex !== state.sectionIndex
    
    if (isNewSection) {
      log.info('Transitioning to new section', { 
        from: state.sectionIndex, 
        to: nextPos.sectionIndex 
      })
    } else {
      log.debug('Advancing chunk', { from: pos, to: nextPosStr })
    }

    // Check if we need to load a new section
    if (isNewSection) {
      log.debug('Loading new section', { section: nextPos.sectionIndex })
      await this.loadSectionChunks(nextPos.sectionIndex)
    }

    // Advance position - check return value
    const advanceOk = playbackStateMachine.dispatch({
      type: 'ADVANCE_CHUNK',
      sectionIndex: nextPos.sectionIndex,
      chunkIndex: nextPos.chunkIndex,
    })
    
    if (!advanceOk) {
      log.error('Failed to dispatch ADVANCE_CHUNK', { 
        nextPos: nextPosStr, 
        currentStatus: playbackStateMachine.getStatus() 
      })
      return
    }

    // Update buffer target to new position so it can buffer ahead
    ttsBufferManager.setBufferTarget(nextPos.sectionIndex, nextPos.chunkIndex)

    // Play next chunk
    await this.playCurrentChunk()
    
    // PRE-LOAD: While playing, proactively load the NEXT section's chunks
    // if we're within a few chunks of the end. This ensures ChunkManager
    // has the section data ready before we need it.
    const currentSectionChunkCount = chunkManager.getSectionChunkCount(nextPos.sectionIndex)
    const chunksRemainingInSection = currentSectionChunkCount - nextPos.chunkIndex
    const PRELOAD_THRESHOLD = 3
    
    if (chunksRemainingInSection <= PRELOAD_THRESHOLD) {
      const nextSection = nextPos.sectionIndex + 1
      if (nextSection < this.sections.length && !chunkManager.isSectionLoaded(nextSection)) {
        log.debug('Pre-loading next section', { nextSection })
        // Load in background - don't await
        this.loadSectionChunks(nextSection).catch(err => {
          log.warn('Failed to pre-load next section', err)
        })
      }
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private onPlaybackStart(): void {
    const state = playbackStateMachine.getState()
    log.debug('Audio started', { section: state.sectionIndex, chunk: state.chunkIndex })
    
    // Update Media Session state for lock screen / background playback
    mediaSessionManager.setPlaybackState('playing')
  }

  private onPlaybackEnd(): void {
    const state = playbackStateMachine.getState()
    log.debug('Audio ended', { section: state.sectionIndex, chunk: state.chunkIndex, status: state.status })
    
    // Only advance if we're still supposed to be playing
    if (playbackStateMachine.isPlaying()) {
      playbackStateMachine.dispatch({ type: 'CHUNK_ENDED' })
      
      // CRITICAL: advanceToNextChunk is async - we must catch errors or they're silently swallowed
      // and playback just stops with the user needing to press play manually
      this.advanceToNextChunk().catch((error) => {
        // Check if this was just an abort (user paused/seeked)
        if (error instanceof DOMException && error.name === 'AbortError') {
          log.debug('Advance aborted (user action)')
          return
        }
        
        log.error('Failed to advance to next chunk', error)
        
        // Try to recover by putting us in a state where the user can press play
        const currentStatus = playbackStateMachine.getStatus()
        if (currentStatus === 'buffering') {
          // If we're stuck in buffering, transition to ready so user can retry
          playbackStateMachine.dispatch({ type: 'ERROR', error: 'Playback failed - tap play to retry' })
        }
        // If we're in 'ready' state, user can just press play to retry
      })
    }
  }

  private onPlaybackError(error: string): void {
    log.error('Audio playback error', { error })
    playbackStateMachine.dispatch({ type: 'ERROR', error })
    mediaSessionManager.setPlaybackState('none')
  }

  private onPlaybackProgress(currentTime: number, duration: number): void {
    // Update Media Session position state for lock screen seek bar
    const store = usePlayerStore.getState()
    mediaSessionManager.setPositionState({
      duration,
      position: currentTime,
      playbackRate: store.speed,
    })
  }

  private onStateChange(state: PlaybackState, prevState: PlaybackState): void {
    // Only log significant state transitions (not position-only changes)
    if (state.status !== prevState.status) {
      // Logged by state machine already
    }

    // Auto-save on position changes
    if (
      state.sectionIndex !== prevState.sectionIndex ||
      state.chunkIndex !== prevState.chunkIndex
    ) {
      this.debouncedSave()
    }
  }

  private debouncedSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.savePosition()
    }, 1000)
  }

  private async savePosition(): Promise<void> {
    const bookId = playbackStateMachine.getCurrentBookId()
    if (!bookId) return

    const state = playbackStateMachine.getState()
    const store = usePlayerStore.getState()

    // Get current time within chunk for audio blob backends (Kokoro/Piper)
    let timeInChunk = 0
    if (this.audioBackend instanceof AudioBlobBackend) {
      timeInChunk = this.audioBackend.getCurrentTime()
    }

    try {
      // Note: speed is NOT saved per-book anymore - it's a global setting
      await playbackRepository.save({
        bookId,
        sectionIndex: state.sectionIndex,
        chunkIndex: state.chunkIndex,
        timeInChunk,
        speed: store.speed, // Still included for DB schema compatibility
        voiceId: this.voiceId,
        modelConfig: this.modelConfig,
      })
    } catch (error) {
      log.error('Save position failed', error)
    }
  }
}

// Singleton instance
export const playbackController = new PlaybackController()


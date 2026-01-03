/**
 * TTSBufferManager
 *
 * Background buffering for audio-blob TTS engines (Kokoro and Piper).
 * Runs independently of playback so it can keep generating ahead while paused.
 *
 * Design goals:
 * - Reliable: single source of truth for in-flight generation per chunk key
 * - Modular: playback can ask for a chunk, buffering can run in background
 * - Safe cancellation: stops on unload/book switch/engine switch
 * - Engine-agnostic: works with both Kokoro and Piper
 * - Explicit position: PlaybackController sets buffer target, avoiding race conditions
 */
import { createLogger } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { audioChunkRepository } from '@/services/storage'
import { ttsManager, type GeneratedAudioResult, type TTSEngine } from '@/services/tts'
import { chunkManager, type ChunkInfo } from './ChunkManager'
import type { Section } from '@/services/storage'
import { usePlayerStore } from './playerStore'

const log = createLogger('buffer')

type BufferContext = {
  bookId: string
  voiceId: string
  modelConfig: string
  sections: Section[]
  engine: TTSEngine
}

type ChunkKey = string

function makeChunkKey(ctx: BufferContext, chunk: ChunkInfo): ChunkKey {
  // Include engine in the key to avoid conflicts between Kokoro and Piper cached audio
  return `${ctx.bookId}:${chunk.sectionIndex}:${chunk.chunkIndex}:${ctx.voiceId}:${ctx.modelConfig}:${ctx.engine}:${chunk.textHash}`
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : false
}

function estimateDurationSeconds(text: string): number {
  // Heuristic: ~13 chars/sec ~= 780 chars/min (rough English TTS pacing)
  return Math.max(2, text.length / 13)
}

export class TTSBufferManager {
  private ctx: BufferContext | null = null
  private isRunning = false
  private abortController: AbortController = new AbortController()

  // Explicit buffer target - set by PlaybackController to avoid race conditions
  // Buffer manager will generate chunks starting from this position
  private targetSection: number = 0
  private targetChunk: number = 0

  // In-flight generation dedupe (used by both background buffering and foreground playback)
  private inFlight = new Map<ChunkKey, Promise<GeneratedAudioResult>>()

  // Telemetry / debugging
  private lastError: string | null = null
  private lastBuffered: { sectionIndex: number; chunkIndex: number } | null = null
  private lastTickAt: number | null = null
  private pausedDueToStorage: boolean = false
  private lastStorage: { usage?: number; quota?: number; percent?: number } | null = null

  // Wake mechanism
  private wakeResolve: (() => void) | null = null
  private wakePromise: Promise<void> | null = null

  start(ctx: BufferContext): void {
    // Restart if context changes
    const same =
      this.ctx?.bookId === ctx.bookId &&
      this.ctx?.voiceId === ctx.voiceId &&
      this.ctx?.modelConfig === ctx.modelConfig &&
      this.ctx?.engine === ctx.engine
    if (same && this.isRunning) {
      log.debug('Buffer already running for same context')
      return
    }

    this.stop()
    this.ctx = ctx
    this.isRunning = true
    this.abortController = new AbortController()
    // Reset target position - will be set by PlaybackController via setBufferTarget()
    this.targetSection = 0
    this.targetChunk = 0
    // Reset UI buffer indicator when starting a new context
    usePlayerStore.getState().setBufferProgress(0)
    log.info('Buffer started', { bookId: ctx.bookId.slice(-20), engine: ctx.engine, voice: ctx.voiceId })
    // Note: runLoop will wait for setBufferTarget() before buffering anything useful
    void this.runLoop()
  }

  stop(): void {
    if (this.isRunning) {
      log.info('Buffer stopped')
    }
    this.isRunning = false
    this.ctx = null
    this.abortController.abort()
    this.inFlight.clear()
    this.lastError = null
    this.lastBuffered = null
    this.lastTickAt = null
    this.pausedDueToStorage = false
    this.lastStorage = null
    this.targetSection = 0
    this.targetChunk = 0
    usePlayerStore.getState().setBufferProgress(0)
    this.wakeResolve?.()
    this.wakeResolve = null
    this.wakePromise = null
  }

  /**
   * Set the buffer target position explicitly.
   * Called by PlaybackController when:
   * - Book is loaded (after restoring saved position)
   * - Position changes (seek, advance to next chunk/section)
   * 
   * This replaces the old polling approach that read from PlaybackStateMachine,
   * which caused race conditions during book load.
   */
  setBufferTarget(sectionIndex: number, chunkIndex: number): void {
    const changed = sectionIndex !== this.targetSection || chunkIndex !== this.targetChunk
    log.debug('Buffer target set', { section: sectionIndex, chunk: chunkIndex, changed })
    this.targetSection = sectionIndex
    this.targetChunk = chunkIndex
    this.kick() // Wake the loop to start buffering from new position
  }

  /**
   * "Nudge" the background loop to recompute targets (settings changed, etc.)
   */
  kick(): void {
    this.wakeResolve?.()
    this.wakeResolve = null
    this.wakePromise = null
  }

  getStatus(): {
    running: boolean
    context: BufferContext | null
    inFlight: number
    lastBuffered: { sectionIndex: number; chunkIndex: number } | null
    lastError: string | null
    lastTickAt: number | null
    pausedDueToStorage: boolean
    storage: { usage?: number; quota?: number; percent?: number } | null
    target: { sectionIndex: number; chunkIndex: number }
  } {
    return {
      running: this.isRunning,
      context: this.ctx,
      inFlight: this.inFlight.size,
      lastBuffered: this.lastBuffered,
      lastError: this.lastError,
      lastTickAt: this.lastTickAt,
      pausedDueToStorage: this.pausedDueToStorage,
      storage: this.lastStorage,
      target: { sectionIndex: this.targetSection, chunkIndex: this.targetChunk },
    }
  }

  /**
   * Foreground helper: get (or generate) the audio for a specific chunk.
   * Ensures we never run duplicate generation for the same chunk key.
   * Works with both Kokoro and Piper engines.
   * 
   * Uses two-tier cache lookup:
   * 1. Position-specific (book + section + chunk + voice + model + textHash)
   * 2. Global text hash (textHash + voice + model) - for deduplication across positions
   */
  async getOrGenerateChunk(chunk: ChunkInfo, source: 'playback' | 'buffer' = 'playback'): Promise<GeneratedAudioResult> {
    if (!this.ctx) {
      throw new Error('TTSBufferManager not started')
    }

    const pos = `s${chunk.sectionIndex}c${chunk.chunkIndex}`
    const key = makeChunkKey(this.ctx, chunk)

    // Check cache with fallback to global text-hash lookup
    const { chunk: cached, source: cacheSource } = await audioChunkRepository.getWithFallback(
      this.ctx.bookId,
      chunk.sectionIndex,
      chunk.chunkIndex,
      this.ctx.voiceId,
      this.ctx.modelConfig,
      chunk.textHash
    )
    
    if (cached) {
      const sourceLabel = cacheSource === 'textHash' ? 'GLOBAL_CACHE' : 'CACHE_HIT'
      log.debug('Cache hit', { pos, source, cacheSource: sourceLabel, duration: cached.duration })
      return {
        requestId: `cached_${Date.now()}`,
        blob: cached.audioBlob,
        duration: cached.duration,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
      }
    }

    // Check if already generating
    const existing = this.inFlight.get(key)
    if (existing) {
      log.debug('Waiting for in-flight generation', { pos, source })
      return existing
    }

    // Generate using the appropriate engine via ttsManager
    const genStart = Date.now()
    log.debug('Starting generation', { pos, source, chars: chunk.text.length })
    
    const p = ttsManager.generateChunk(chunk.text, chunk.chunkIndex, this.ctx.voiceId)
    this.inFlight.set(key, p)

    try {
      const audio = await p
      const genMs = Date.now() - genStart
      log.debug('Generation complete', { pos, source, genMs, duration: audio.duration })
      
      // Save to cache (position-specific, but also findable by textHash via index)
      await audioChunkRepository.save(
        this.ctx.bookId,
        chunk.sectionIndex,
        chunk.chunkIndex,
        this.ctx.voiceId,
        this.ctx.modelConfig,
        chunk.textHash,
        audio.blob,
        audio.duration
      )
      return audio
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async waitForWakeOrTimeout(ms: number): Promise<void> {
    if (!this.wakePromise) {
      this.wakePromise = new Promise<void>((resolve) => {
        this.wakeResolve = resolve
      })
    }

    await Promise.race([
      this.wakePromise,
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ])

    this.wakeResolve = null
    this.wakePromise = null
  }

  private async getStoragePercentUsed(): Promise<{ usage?: number; quota?: number; percent?: number }> {
    try {
      const nav = navigator as unknown as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }
      const estimate = await nav.storage?.estimate?.()
      const usage = estimate?.usage
      const quota = estimate?.quota
      const percent =
        typeof usage === 'number' && typeof quota === 'number' && quota > 0 ? (usage / quota) * 100 : undefined
      return { usage, quota, percent }
    } catch {
      return {}
    }
  }

  private async ensureSectionLoaded(sectionIndex: number): Promise<void> {
    if (chunkManager.isSectionLoaded(sectionIndex)) return
    const section = this.ctx?.sections?.[sectionIndex]
    if (!section) return
    await chunkManager.loadSection(sectionIndex, section.textContent)
  }

  private async computeTargetChunks(): Promise<ChunkInfo[]> {
    if (!this.ctx) return []

    // NOTE: We intentionally keep this tolerant to older stored settings.
    // (If a user has an older DB without bufferAheadMode, we fall back.)
    const settings = await settingsRepository.getAll()
    const mode = (settings as { bufferAheadMode?: 'minutes' | 'chapter' | 'book' }).bufferAheadMode ?? 'minutes'
    const minutes = settings.bufferAheadMinutes

    // Use explicit target position set by PlaybackController (not state machine)
    const startSection = this.targetSection
    const startChunk = this.targetChunk

    // Always ensure at least current section is loaded
    await this.ensureSectionLoaded(startSection)

    const chunks: ChunkInfo[] = []
    const allSections = this.ctx.sections
    if (allSections.length === 0) return []

    const pushFrom = async (sectionIndex: number, fromChunkIndex: number, limit?: number) => {
      await this.ensureSectionLoaded(sectionIndex)
      const count = chunkManager.getSectionChunkCount(sectionIndex)
      let added = 0
      for (let i = fromChunkIndex; i < count; i++) {
        if (limit !== undefined && added >= limit) break
        const c = chunkManager.getChunk({ sectionIndex, chunkIndex: i })
        if (c) {
          chunks.push(c)
          added++
        }
      }
    }

    if (mode === 'chapter') {
      // Buffer current chapter
      await pushFrom(startSection, startChunk)
      
      // CROSS-CHAPTER LOOKAHEAD: Always buffer first few chunks of next section
      // to ensure smooth chapter transitions. This prevents lag when rolling
      // over to a new chapter.
      const LOOKAHEAD_CHUNKS = 5 // Buffer first 5 chunks of next chapter
      const nextSection = startSection + 1
      if (nextSection < allSections.length) {
        await pushFrom(nextSection, 0, LOOKAHEAD_CHUNKS)
      }
      
      return chunks
    }

    if (mode === 'book') {
      await pushFrom(startSection, startChunk)
      for (let s = startSection + 1; s < allSections.length; s++) {
        await pushFrom(s, 0)
      }
      return chunks
    }

    // mode === 'minutes'
    // Accumulate until target seconds is reached (heuristic; avoids per-chunk IndexedDB reads).
    const targetSeconds = Math.max(0, minutes) * 60
    let acc = 0

    const addChunk = (c: ChunkInfo) => {
      chunks.push(c)
      acc += estimateDurationSeconds(c.text)
    }

    // Walk forward until we hit the time target or end-of-book
    for (let s = startSection; s < allSections.length; s++) {
      const from = s === startSection ? startChunk : 0
      await this.ensureSectionLoaded(s)
      const count = chunkManager.getSectionChunkCount(s)
      for (let i = from; i < count; i++) {
        const c = chunkManager.getChunk({ sectionIndex: s, chunkIndex: i })
        if (!c) continue
        addChunk(c)
        if (acc >= targetSeconds) return chunks
      }
    }

    // Even in minutes mode, ensure we have cross-chapter lookahead
    // if we're near the end of current section
    const currentSectionChunkCount = chunkManager.getSectionChunkCount(startSection)
    const chunksRemainingInSection = currentSectionChunkCount - startChunk
    const NEAR_END_THRESHOLD = 5
    const nextSection = startSection + 1
    
    if (chunksRemainingInSection <= NEAR_END_THRESHOLD && nextSection < allSections.length) {
      // Check if we already have chunks from next section
      const hasNextSection = chunks.some(c => c.sectionIndex === nextSection)
      if (!hasNextSection) {
        await pushFrom(nextSection, 0, NEAR_END_THRESHOLD)
      }
    }

    return chunks
  }

  private async runLoop(): Promise<void> {
    log.debug('Buffer loop started')
    let loopCount = 0
    
    try {
      while (this.isRunning && this.ctx && !this.abortController.signal.aborted) {
        try {
          loopCount++
          this.lastTickAt = Date.now()

          // Check if TTS is ready - if not, wait
          if (!ttsManager.getIsReady()) {
            if (ttsManager.getIsLoading()) {
              log.debug('Waiting for TTS to initialize', { loopCount })
            }
            await this.waitForWakeOrTimeout(500)
            continue
          }

          // Storage-aware backoff: if we're near quota, pause buffering to avoid blowing up storage.
          // (We keep playback working; it will still generate on-demand if needed.)
          const storage = await this.getStoragePercentUsed()
          this.lastStorage = storage
          const percent = storage.percent
          // Conservative threshold; we can make this configurable later.
          if (typeof percent === 'number' && percent >= 92) {
            this.pausedDueToStorage = true
            log.debug('Storage full, pausing buffer', { loopCount, storagePercent: percent })
            await this.waitForWakeOrTimeout(10_000)
            continue
          }
          this.pausedDueToStorage = false

          const target = await this.computeTargetChunks()
          if (!this.ctx || this.abortController.signal.aborted) {
            log.debug('Buffer loop aborted - context lost')
            return
          }

          // Find first missing chunk within target (efficient: per-section cache snapshot)
          let nextMissing: ChunkInfo | null = null
          let cachedCount = 0
          const cachedBySection = new Map<
            number,
            Promise<Map<number, { textHash: string; duration: number }>>
          >()

          const getCachedMap = async (sectionIndex: number) => {
            const existing = cachedBySection.get(sectionIndex)
            if (existing) return existing
            const p = audioChunkRepository
              .getForSection(this.ctx!.bookId, sectionIndex, this.ctx!.voiceId, this.ctx!.modelConfig)
              .then((chunks) => {
                const map = new Map<number, { textHash: string; duration: number }>()
                for (const c of chunks) {
                  map.set(c.chunkIndex, { textHash: c.textHash, duration: c.duration })
                }
                return map
              })
            cachedBySection.set(sectionIndex, p)
            return p
          }

          for (const c of target) {
            const m = await getCachedMap(c.sectionIndex)
            const hit = m.get(c.chunkIndex)
            if (hit && hit.textHash === c.textHash) {
              cachedCount++
              continue
            }
            nextMissing = c
            break
          }

          if (!nextMissing) {
            // Nothing to do; sleep until kicked or periodic wake
            if (loopCount === 1 || loopCount % 10 === 0) {
              log.debug('Buffer caught up', { loopCount, targetSection: this.targetSection, targetChunk: this.targetChunk, cached: cachedCount, total: target.length })
            }
            await this.waitForWakeOrTimeout(2000)
            continue
          }

          // Log what we're buffering vs what playback needs
          log.debug('Buffering next chunk', { loopCount, targetSection: this.targetSection, targetChunk: this.targetChunk, nextSection: nextMissing.sectionIndex, nextChunk: nextMissing.chunkIndex, cached: cachedCount, total: target.length })
          
          // Generate sequentially (worker already queues inference)
          await this.getOrGenerateChunk(nextMissing, 'buffer')
          this.lastBuffered = { sectionIndex: nextMissing.sectionIndex, chunkIndex: nextMissing.chunkIndex }
          this.lastError = null
          void this.updateBufferIndicator()

          // Yield between chunks to keep UI responsive
          await this.waitForWakeOrTimeout(0)
        } catch (e) {
          if (isAbortError(e)) {
            log.debug('Buffer loop aborted')
            return
          }
          this.lastError = e instanceof Error ? e.message : String(e)
          log.error('Buffer loop error', { error: this.lastError })
          await this.waitForWakeOrTimeout(1500)
        }
      }
      log.debug('Buffer loop ended')
    } finally {
      // CRITICAL: Always mark as not running when loop exits for ANY reason
      // This ensures start() will properly restart the loop if called again.
      // Without this, if the loop exits due to AbortError (e.g., from cancelAll()),
      // isRunning stays true and start() returns early without restarting.
      this.isRunning = false
    }
  }

  /**
   * Update the UI indicator for how far ahead we have contiguous cached audio
   * from the current position within the current section.
   */
  private async updateBufferIndicator(): Promise<void> {
    if (!this.ctx) return

    // Use explicit target position
    const sectionIndex = this.targetSection
    const startChunk = this.targetChunk

    await this.ensureSectionLoaded(sectionIndex)
    const total = chunkManager.getSectionChunkCount(sectionIndex)
    if (total <= 0) {
      usePlayerStore.getState().setBufferProgress(0)
      return
    }

    const cached = await audioChunkRepository.getForSection(
      this.ctx.bookId,
      sectionIndex,
      this.ctx.voiceId,
      this.ctx.modelConfig
    )
    const cachedMap = new Map<number, string>()
    for (const c of cached) cachedMap.set(c.chunkIndex, c.textHash)

    let lastContiguous = startChunk - 1
    for (let i = startChunk; i < total; i++) {
      const chunk = chunkManager.getChunk({ sectionIndex, chunkIndex: i })
      if (!chunk) break
      const hitHash = cachedMap.get(i)
      if (hitHash && hitHash === chunk.textHash) {
        lastContiguous = i
      } else {
        break
      }
    }

    const bufferedPercent = Math.max(0, Math.min(100, ((lastContiguous + 1) / total) * 100))
    usePlayerStore.getState().setBufferProgress(bufferedPercent)
  }
}

export const ttsBufferManager = new TTSBufferManager()



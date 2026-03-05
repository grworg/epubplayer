/**
 * TTS Manager
 * 
 * Unified interface for all TTS engines. Abstracts engine-specific details
 * behind a capability-based model (see ADR-0010).
 * 
 * Consumers should use capability queries (e.g., `currentEngineGeneratesBlobs()`)
 * instead of checking engine names directly.
 */

import { createLogger } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { ttsService as kokoroTTS } from './ttsService'
import { piperService } from './piperService'
import { supertonicService } from './supertonicService'
import { sherpaService } from './sherpaService'
import { kittenService } from './kittenService'
import type {
  TTSEngine,
  TTSEngineInfo,
  TTSEngineCapabilities,
  TTSAudioResult,
  GeneratedAudioResult,
} from './types'

const log = createLogger('tts')

// Re-export types for convenience
export type { TTSEngine, TTSEngineInfo, TTSEngineCapabilities, TTSAudioResult, GeneratedAudioResult }

// ============================================================================
// Engine Registry (Single Source of Truth)
// ============================================================================

/**
 * Registry of all TTS engines with their metadata and capabilities.
 * 
 * To add a new engine:
 * 1. Add to TTSEngine type in types.ts
 * 2. Add entry here with capabilities
 * 3. Add initialization case in doInitialize()
 * 4. Add generation case in generateChunk()
 */
const ENGINE_REGISTRY: Record<TTSEngine, TTSEngineInfo> = {
  browser: {
    id: 'browser',
    name: 'Browser (Instant)',
    description: "Uses your browser's built-in voices. Instant, no loading.",
    available: typeof window !== 'undefined' && 'speechSynthesis' in window,
    capabilities: {
      generatesBlobs: false,  // Streams directly via Web Speech API
      requiresInit: false,    // Ready immediately
      slowOnCPU: false,
    },
  },
  supertonic: {
    id: 'supertonic',
    name: 'Supertonic (Fast & Quality)',
    description: 'Fast neural TTS. Great quality, works well on all devices. ~260MB download.',
    available: true,
    capabilities: {
      generatesBlobs: true,   // Pre-generates WAV blobs
      requiresInit: true,     // Needs model loading
      slowOnCPU: false,       // Fast on both WebGPU and WASM
    },
  },
  piper: {
    id: 'piper',
    name: 'Piper (Experimental)',
    description: 'Fast neural TTS. Good quality, works well on CPU. ~20MB download.',
    available: true,
    capabilities: {
      generatesBlobs: true,
      requiresInit: true,
      slowOnCPU: false,
    },
  },
  kokoro: {
    id: 'kokoro',
    name: 'Kokoro (Best Quality)',
    description: 'Highest quality. Fast with WebGPU, slow on CPU. ~80MB download.',
    available: true,
    capabilities: {
      generatesBlobs: true,
      requiresInit: true,
      slowOnCPU: true,        // WASM fallback is very slow
    },
  },
  sherpa: {
    id: 'sherpa',
    name: 'Sherpa (Multi-Speaker)',
    description: 'Neural TTS with proper phonemization. 900+ voices. ~100MB download.',
    available: true,
    capabilities: {
      generatesBlobs: true,
      requiresInit: true,
      slowOnCPU: false,       // WASM-only but optimized
    },
  },
  kitten: {
    id: 'kitten',
    name: 'Kitten (Light)',
    description: 'Lightweight neural TTS. Fast on any device, no GPU needed. ~24MB download.',
    available: true,
    capabilities: {
      generatesBlobs: true,
      requiresInit: true,
      slowOnCPU: false,       // Designed for CPU inference
    },
  },
}

// ============================================================================
// Callback Types
// ============================================================================

type AudioCallback = (audio: TTSAudioResult & { chunkIndex: number; text: string }) => void
type ProgressCallback = (status: string, progress?: number) => void
type ErrorCallback = (error: string) => void
type ReadyCallback = () => void

// ============================================================================
// TTS Manager Class
// ============================================================================

class TTSManager {
  private currentEngine: TTSEngine = 'browser'
  private isInitialized = false
  private isInitializing = false
  private initPromise: Promise<void> | null = null

  // Callbacks
  private onAudioCallback?: AudioCallback
  private onProgressCallback?: ProgressCallback
  private onErrorCallback?: ErrorCallback
  private onReadyCallback?: ReadyCallback

  // ============================================================================
  // Capability Queries (Use these instead of checking engine names!)
  // ============================================================================

  /**
   * Get full info about an engine including capabilities.
   */
  getEngineInfo(engine: TTSEngine): TTSEngineInfo {
    return ENGINE_REGISTRY[engine]
  }

  /**
   * Get capabilities of an engine.
   */
  getEngineCapabilities(engine: TTSEngine): TTSEngineCapabilities {
    return ENGINE_REGISTRY[engine].capabilities
  }

  /**
   * Get capabilities of the current engine.
   */
  getCurrentCapabilities(): TTSEngineCapabilities {
    return ENGINE_REGISTRY[this.currentEngine].capabilities
  }

  /**
   * Does the current engine pre-generate audio blobs?
   * Use this to decide whether to use AudioBlobBackend vs BrowserTTSBackend,
   * and whether to start the TTSBufferManager.
   */
  currentEngineGeneratesBlobs(): boolean {
    return this.getCurrentCapabilities().generatesBlobs
  }

  /**
   * Does the current engine need async initialization?
   * Use this to decide whether to pre-initialize on book load.
   */
  currentEngineRequiresInit(): boolean {
    return this.getCurrentCapabilities().requiresInit
  }

  /**
   * Is the current engine slow on CPU?
   * Use this to show warnings or recommend alternatives.
   */
  currentEngineSlowOnCPU(): boolean {
    return this.getCurrentCapabilities().slowOnCPU
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize TTS with the configured engine.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return
    
    if (this.isInitializing && this.initPromise) {
      return this.initPromise
    }

    this.isInitializing = true
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    try {
      const engine = await settingsRepository.get('ttsEngine')
      this.currentEngine = engine

      log.info('Initializing engine', { engine })
      this.onProgressCallback?.('Initializing TTS...', 0)

      // Engines that don't require init are ready immediately
      if (!this.getCurrentCapabilities().requiresInit) {
        log.debug('No initialization needed', { engine })
        this.markReady()
        return
      }

      // Initialize the appropriate service
      switch (engine) {
        case 'piper':
          this.wireUpService(piperService, 'piper')
          await piperService.initialize()
          break

        case 'kokoro':
          this.wireUpService(kokoroTTS, 'kokoro')
          await kokoroTTS.initialize()
          break

        case 'supertonic':
          this.wireUpService(supertonicService, 'supertonic')
          await supertonicService.initialize()
          break

        case 'sherpa':
          this.wireUpService(sherpaService, 'sherpa')
          await sherpaService.initialize()
          break

        case 'kitten':
          this.wireUpService(kittenService, 'kitten')
          await kittenService.initialize()
          break

        case 'browser':
          // Browser TTS doesn't need initialization
          break
      }

      this.markReady()
    } catch (error) {
      this.isInitializing = false
      this.initPromise = null
      throw error
    }
  }

  private wireUpService(
    service: {
      onProgress: (cb: (status: string, progress?: number) => void) => void
      onError: (cb: (error: string) => void) => void
      onReady: (cb: () => void) => void
      onAudio: (cb: (audio: { blob: Blob; duration: number; chunkIndex: number; text: string }) => void) => void
    },
    engineId: TTSEngine
  ): void {
    service.onProgress((status, progress) => {
      this.onProgressCallback?.(status, progress)
    })
    service.onError((error) => {
      this.onErrorCallback?.(error)
    })
    service.onReady(() => {
      this.onReadyCallback?.()
    })
    service.onAudio((audio) => {
      this.onAudioCallback?.({
        blob: audio.blob,
        duration: audio.duration,
        engine: engineId,
        chunkIndex: audio.chunkIndex,
        text: audio.text,
      })
    })
  }

  private markReady(): void {
    this.isInitialized = true
    this.isInitializing = false
    this.initPromise = null
    this.onReadyCallback?.()
  }

  // ============================================================================
  // Audio Generation
  // ============================================================================

  /**
   * Generate audio for a chunk of text.
   * Only works for engines where generatesBlobs is true.
   */
  async generateChunk(text: string, chunkIndex: number, voiceId?: string): Promise<GeneratedAudioResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (!this.currentEngineGeneratesBlobs()) {
      throw new Error(`${this.currentEngine} does not generate blobs - use BrowserTTSBackend directly`)
    }

    log.debug('Generating chunk', { chunkIndex, engine: this.currentEngine, textPreview: text.substring(0, 50) })

    try {
      switch (this.currentEngine) {
        case 'piper': {
          const result = await piperService.generateChunk(text, chunkIndex)
          return {
            requestId: result.requestId,
            blob: result.blob,
            duration: result.duration,
            chunkIndex: result.chunkIndex,
            text: result.text,
          }
        }

        case 'kokoro': {
          const result = await kokoroTTS.generateChunk(text, chunkIndex, voiceId)
          return {
            requestId: result.requestId,
            blob: result.blob,
            duration: result.duration,
            chunkIndex: result.chunkIndex,
            text: result.text,
          }
        }

        case 'supertonic': {
          const result = await supertonicService.generateChunk(text, chunkIndex, voiceId)
          return {
            requestId: result.requestId,
            blob: result.blob,
            duration: result.duration,
            chunkIndex: result.chunkIndex,
            text: result.text,
          }
        }

        case 'sherpa': {
          const result = await sherpaService.generateChunk(text, chunkIndex, voiceId)
          return {
            requestId: result.requestId,
            blob: result.blob,
            duration: result.duration,
            chunkIndex: result.chunkIndex,
            text: result.text,
          }
        }

        case 'kitten': {
          const result = await kittenService.generateChunk(text, chunkIndex, voiceId)
          return {
            requestId: result.requestId,
            blob: result.blob,
            duration: result.duration,
            chunkIndex: result.chunkIndex,
            text: result.text,
          }
        }

        default:
          throw new Error(`Unknown TTS engine: ${this.currentEngine}`)
      }
    } catch (error) {
      this.onErrorCallback?.(error instanceof Error ? error.message : 'Generation failed')
      throw error
    }
  }

  /**
   * Split text into TTS-friendly chunks.
   */
  splitIntoChunks(text: string): string[] {
    switch (this.currentEngine) {
      case 'piper':
        return piperService.splitIntoChunks(text)
      case 'supertonic':
        return supertonicService.splitIntoChunks(text)
      case 'sherpa':
        return sherpaService.splitIntoChunks(text)
      case 'kitten':
        return kittenService.splitIntoChunks(text)
      default:
        return kokoroTTS.splitIntoChunks(text)
    }
  }

  // ============================================================================
  // State Queries
  // ============================================================================

  getEngine(): TTSEngine {
    return this.currentEngine
  }

  getIsReady(): boolean {
    return this.isInitialized
  }

  getIsLoading(): boolean {
    return this.isInitializing
  }

  /**
   * @deprecated Use currentEngineSlowOnCPU() instead
   */
  isSlowMode(): boolean {
    return this.currentEngine === 'kokoro' && kokoroTTS.isUsingWasm()
  }

  // ============================================================================
  // Engine Control
  // ============================================================================

  cancelAll(): void {
    switch (this.currentEngine) {
      case 'kokoro':
        kokoroTTS.cancelAll()
        break
      case 'piper':
        piperService.cancelAll()
        break
      case 'supertonic':
        supertonicService.cancelAll()
        break
      case 'sherpa':
        sherpaService.cancelAll()
        break
      case 'kitten':
        kittenService.cancelAll()
        break
    }
  }

  destroy(): void {
    switch (this.currentEngine) {
      case 'kokoro':
        kokoroTTS.destroy()
        break
      case 'piper':
        piperService.destroy()
        break
      case 'supertonic':
        supertonicService.destroy()
        break
      case 'sherpa':
        sherpaService.destroy()
        break
      case 'kitten':
        kittenService.destroy()
        break
    }
    this.isInitialized = false
  }

  async setEngine(engine: TTSEngine): Promise<void> {
    if (engine === this.currentEngine && this.isInitialized) return

    this.cancelAll()
    this.destroy()

    this.isInitialized = false
    this.currentEngine = engine

    await settingsRepository.set('ttsEngine', engine)
    await this.initialize()
  }

  // ============================================================================
  // Engine Listing (for UI)
  // ============================================================================

  /**
   * Get list of all available engines for UI display.
   */
  getAvailableEngines(): TTSEngineInfo[] {
    return Object.values(ENGINE_REGISTRY)
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  onAudio(callback: AudioCallback): void {
    this.onAudioCallback = callback
  }

  onProgress(callback: ProgressCallback): void {
    this.onProgressCallback = callback
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallback = callback
  }

  onReady(callback: ReadyCallback): void {
    this.onReadyCallback = callback
  }
}

export const ttsManager = new TTSManager()

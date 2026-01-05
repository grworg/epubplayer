/**
 * TTS Types
 * 
 * Single source of truth for TTS engine types and capabilities.
 * Import these types throughout the codebase instead of defining locally.
 * 
 * See ADR-0010 for the rationale behind this abstraction.
 */

// ============================================================================
// Engine Types
// ============================================================================

/**
 * Available TTS engines.
 * Add new engines here - this is the ONLY place engine IDs should be defined.
 */
export type TTSEngine = 'browser' | 'piper' | 'kokoro' | 'supertonic' | 'sherpa'

// ============================================================================
// Engine Capabilities
// ============================================================================

/**
 * Capabilities that describe what a TTS engine can do.
 * Used by consumers to make decisions without knowing specific engine names.
 */
export interface TTSEngineCapabilities {
  /**
   * Does this engine pre-generate audio blobs?
   * - true: Generates WAV/audio blobs (Kokoro, Piper, Supertonic)
   * - false: Streams audio in real-time (Browser TTS)
   * 
   * Affects: Whether to use AudioBlobBackend vs BrowserTTSBackend,
   * whether to start TTSBufferManager, etc.
   */
  generatesBlobs: boolean

  /**
   * Does this engine need async initialization (model loading)?
   * - true: Needs to download/load models before first use
   * - false: Ready immediately
   * 
   * Affects: Whether to pre-initialize on book load, loading indicators
   */
  requiresInit: boolean

  /**
   * Is this engine notably slow on CPU/WASM?
   * - true: Should warn users or recommend alternatives
   * - false: Performs well on all devices
   * 
   * Affects: User warnings, engine recommendations
   */
  slowOnCPU: boolean
}

// ============================================================================
// Engine Info
// ============================================================================

/**
 * Full information about a TTS engine, including metadata and capabilities.
 */
export interface TTSEngineInfo {
  /** Unique identifier for the engine */
  id: TTSEngine
  
  /** Human-readable name for UI display */
  name: string
  
  /** Description explaining the engine's tradeoffs */
  description: string
  
  /** Whether this engine is available on the current device */
  available: boolean
  
  /** What this engine can do */
  capabilities: TTSEngineCapabilities
}

// ============================================================================
// Audio Result Types
// ============================================================================

/**
 * Result from generating audio for a text chunk.
 */
export interface TTSAudioResult {
  blob: Blob
  duration: number
  engine: TTSEngine
}

/**
 * Extended result including chunk metadata.
 */
export interface GeneratedAudioResult {
  requestId: string
  blob: Blob
  duration: number
  chunkIndex: number
  text: string
}


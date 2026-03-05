// Canonical types (single source of truth - import from here!)
export type {
  TTSEngine,
  TTSEngineInfo,
  TTSEngineCapabilities,
  TTSAudioResult,
  GeneratedAudioResult,
} from './types'

// Main TTS manager (unified interface)
export { ttsManager } from './ttsManager'

// Kokoro TTS service
export { ttsService } from './ttsService'
export type { TTSConfig, GeneratedAudio } from './ttsService'

// Piper TTS service
export { piperService, PIPER_MODELS } from './piperService'
export type { PiperConfig, PiperGeneratedAudio, PiperModelId } from './piperService'

// Supertonic TTS service
export { supertonicService, SUPERTONIC_VOICES } from './supertonicService'
export type { SupertonicConfig, SupertonicGeneratedAudio, SupertonicVoiceId } from './supertonicService'

// Sherpa-ONNX TTS service
export { sherpaService, SHERPA_VOICES } from './sherpaService'
export type { SherpaConfig, SherpaGeneratedAudio, SherpaVoiceId } from './sherpaService'

// KittenTTS service
export { kittenService, KITTEN_VOICES } from './kittenService'
export type { KittenConfig, KittenGeneratedAudio, KittenVoiceId } from './kittenService'

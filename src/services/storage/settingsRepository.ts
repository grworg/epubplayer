import { db } from './db'
import type { TTSEngine } from '@/services/tts/types'

// ============================================================================
// Default Settings
// ============================================================================

// Settings types - string literals for enums, numbers for numeric settings
interface Settings {
  // Locale
  locale: string // e.g., 'en', 'es', 'fr', 'de', 'pt', 'zh'
  
  // Onboarding
  hasCompletedOnboarding: boolean
  hasDismissedPWAPrompt: boolean
  
  // TTS Engine (uses canonical TTSEngine type from types.ts)
  ttsEngine: TTSEngine
  
  // Voice settings (engine-specific)
  voiceId: string
  modelConfig: string // 'q4' | 'q8' | 'fp16' | 'fp32'
  processingDevice: 'auto' | 'wasm' | 'webgpu'

  // Piper settings
  piperModel: string

  // Supertonic settings
  supertonicVoice: string
  supertonicDevice: 'wasm' | 'webgpu'

  // Playback settings
  defaultSpeed: number
  skipForwardSeconds: number
  skipBackSeconds: number
  autoRewindSeconds: number

  // Buffer settings
  bufferAheadMode: 'minutes' | 'chapter' | 'book'
  bufferAheadMinutes: number
  maxChunkChars: number

  // Sleep timer
  sleepTimerMinutes: number
}

export const DEFAULT_SETTINGS: Settings = {
  locale: '', // Empty = auto-detect from navigator
  hasCompletedOnboarding: false,
  hasDismissedPWAPrompt: false,
  ttsEngine: 'browser',
  voiceId: 'default',
  modelConfig: 'q4',
  processingDevice: 'auto',
  piperModel: 'en_US-amy-medium',
  supertonicVoice: 'F1',
  supertonicDevice: 'webgpu', // Default to WebGPU for best performance; WASM is fallback
  defaultSpeed: 1.0,
  skipForwardSeconds: 30,
  skipBackSeconds: 30,
  autoRewindSeconds: 10,
  // Buffer aggressively by default for smooth playback
  bufferAheadMode: 'chapter',
  bufferAheadMinutes: 3,
  maxChunkChars: 300,
  sleepTimerMinutes: 0,
}

export type SettingKey = keyof Settings
export type SettingValue<K extends SettingKey> = Settings[K]

// ============================================================================
// Settings Repository
// ============================================================================

export const settingsRepository = {
  /**
   * Get a setting value
   */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const setting = await db.settings.get(key)
    if (setting) {
      return setting.value as SettingValue<K>
    }
    return DEFAULT_SETTINGS[key]
  },

  /**
   * Set a setting value
   */
  async set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    await db.settings.put({ key, value })
  },

  /**
   * Get all settings (merged with defaults)
   */
  async getAll(): Promise<typeof DEFAULT_SETTINGS> {
    const stored = await db.settings.toArray()
    const settings = { ...DEFAULT_SETTINGS }

    for (const setting of stored) {
      const key = setting.key as SettingKey
      if (key in settings) {
        // @ts-expect-error - We know the types match
        settings[key] = setting.value
      }
    }

    return settings
  },

  /**
   * Reset all settings to defaults
   */
  async resetAll(): Promise<void> {
    await db.settings.clear()
  },

  /**
   * Reset a specific setting to default
   */
  async reset(key: SettingKey): Promise<void> {
    await db.settings.delete(key)
  },
}

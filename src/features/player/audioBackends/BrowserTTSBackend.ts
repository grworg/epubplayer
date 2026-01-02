/**
 * Browser TTS Backend
 * 
 * Uses Web Speech API for text-to-speech.
 * Instant playback, no loading, but quality varies by browser/OS.
 * 
 * Uses a silent audio keepalive to enable Media Session API support
 * (lock screen controls, background playback) which Web Speech API
 * doesn't natively provide.
 */

import type { AudioBackend, PlayOptions, AudioBackendEvents } from './AudioBackend'
import { silentAudioKeepalive } from './SilentAudioKeepalive'

// Extended events for browser TTS
export interface BrowserTTSEvents extends AudioBackendEvents {
  onBoundary?: (charIndex: number, charLength: number) => void
}

export class BrowserTTSBackend implements AudioBackend {
  private synth: SpeechSynthesis | null = null
  private voices: SpeechSynthesisVoice[] = []
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private _isPlaying = false
  private _isPaused = false
  private _speed = 1.0
  private events: BrowserTTSEvents = {}

  constructor(events?: BrowserTTSEvents) {
    if (events) this.events = events
    
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis
      this.loadVoices()
      
      // Voices may load asynchronously
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoices()
      }
    }
  }

  private loadVoices(): void {
    if (!this.synth) return
    this.voices = this.synth.getVoices()
    console.log(`[BrowserTTSBackend] Loaded ${this.voices.length} voices`)
    
    // Log English voices for debugging
    const englishVoices = this.voices.filter(v => v.lang.startsWith('en'))
    if (englishVoices.length > 0) {
      console.log('[BrowserTTSBackend] English voices:', 
        englishVoices.map(v => `${v.name} (${v.lang}, ${v.localService ? 'local' : 'network'})`))
    }
  }

  /**
   * Check if browser TTS is available
   */
  isAvailable(): boolean {
    return this.synth !== null && this.voices.length > 0
  }

  /**
   * Get available voices
   */
  getVoices(): SpeechSynthesisVoice[] {
    return this.voices
  }

  /**
   * Get English voices
   */
  getEnglishVoices(): SpeechSynthesisVoice[] {
    return this.voices.filter((v) => v.lang.startsWith('en'))
  }

  /**
   * Get the best quality English voice available
   * Prefers neural/premium voices over basic ones
   */
  getBestEnglishVoice(): SpeechSynthesisVoice | undefined {
    const englishVoices = this.getEnglishVoices()
    if (englishVoices.length === 0) return undefined

    // Score voices based on quality indicators
    const scored = englishVoices.map(voice => {
      let score = 0
      const name = voice.name.toLowerCase()
      
      // Prefer neural/natural voices (highest quality)
      if (name.includes('neural') || name.includes('natural') || name.includes('wavenet')) {
        score += 100
      }
      
      // Prefer Google voices on Android (usually high quality)
      if (name.includes('google')) {
        score += 50
      }
      
      // Microsoft neural voices are great
      if (name.includes('microsoft') && name.includes('online')) {
        score += 80
      }
      
      // Prefer 'enhanced' or 'premium' voices
      if (name.includes('enhanced') || name.includes('premium')) {
        score += 40
      }
      
      // Local voices are faster (no network latency)
      if (voice.localService) {
        score += 10
      }
      
      // Prefer US English for consistency
      if (voice.lang === 'en-US') {
        score += 5
      }
      
      // Slight preference for female voices (often clearer for audiobooks)
      if (name.includes('female') || name.includes('samantha') || 
          name.includes('karen') || name.includes('allison') ||
          name.includes('moira') || name.includes('tessa')) {
        score += 3
      }
      
      return { voice, score }
    })

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)
    
    // Log top 3 for debugging
    if (scored.length > 0) {
      console.log('[BrowserTTSBackend] Top voices:', 
        scored.slice(0, 3).map(s => `${s.voice.name} (score: ${s.score})`))
    }

    return scored[0]?.voice
  }

  async play(text: string, options?: PlayOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.synth) {
        reject(new Error('Speech synthesis not available'))
        return
      }

      // Check abort signal
      if (options?.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      // Cancel any ongoing speech
      this.synth.cancel()
      this._isPaused = false

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = options?.speed ?? this._speed

      // Set voice
      const voiceId = options?.voiceId
      if (voiceId && voiceId !== 'default') {
        const voice = this.voices.find((v) => v.voiceURI === voiceId)
        if (voice) {
          utterance.voice = voice
        }
      } else {
        // Use best available English voice
        const voice = this.getBestEnglishVoice()
        if (voice) {
          utterance.voice = voice
          console.log(`[BrowserTTSBackend] Using voice: ${voice.name} (${voice.lang})`)
        }
      }

      // Set up abort handling
      const abortHandler = () => {
        this.stop()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      options?.signal?.addEventListener('abort', abortHandler)

      utterance.onstart = () => {
        this._isPlaying = true
        this._isPaused = false
        // Start silent audio to claim Media Session (lock screen controls)
        silentAudioKeepalive.start()
        this.events.onStart?.()
      }

      // Word boundary events for lyrics-style highlighting
      utterance.onboundary = (e) => {
        if (e.name === 'word') {
          this.events.onBoundary?.(e.charIndex, e.charLength ?? 0)
        }
      }

      utterance.onend = () => {
        this._isPlaying = false
        this._isPaused = false
        this.currentUtterance = null
        options?.signal?.removeEventListener('abort', abortHandler)
        // Note: Don't stop keepalive here - let PlaybackController manage it
        // so it persists between chunks for continuous playback
        this.events.onEnd?.()
        resolve()
      }

      utterance.onerror = (e) => {
        this._isPlaying = false
        this._isPaused = false
        this.currentUtterance = null
        options?.signal?.removeEventListener('abort', abortHandler)
        
        // 'interrupted' and 'canceled' are expected when we stop/pause
        if (e.error === 'interrupted' || e.error === 'canceled') {
          resolve()
        } else {
          this.events.onError?.(e.error)
          reject(new Error(e.error))
        }
      }

      this.currentUtterance = utterance
      this.synth.speak(utterance)

      // Chrome sometimes needs a nudge to start speaking
      setTimeout(() => {
        if (this.synth && !this.synth.speaking && this.currentUtterance === utterance) {
          console.log('[BrowserTTSBackend] Speech not started, retrying...')
          this.synth.cancel()
          this.synth.speak(utterance)
        }
      }, 100)
    })
  }

  pause(): void {
    if (this.synth && this._isPlaying && !this._isPaused) {
      this.synth.pause()
      this._isPaused = true
      silentAudioKeepalive.pause()
      this.events.onPause?.()
    }
  }

  resume(): void {
    if (this.synth && this._isPaused) {
      this.synth.resume()
      this._isPaused = false
      this._isPlaying = true
      silentAudioKeepalive.resume()
      this.events.onResume?.()
    }
  }

  stop(): void {
    if (this.synth) {
      this.synth.cancel()
    }
    this._isPlaying = false
    this._isPaused = false
    this.currentUtterance = null
    silentAudioKeepalive.stop()
  }

  isPlaying(): boolean {
    return this._isPlaying && !this._isPaused
  }

  isPaused(): boolean {
    return this._isPaused
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.1, Math.min(10, speed))
  }

  getSpeed(): number {
    return this._speed
  }

  destroy(): void {
    this.stop()
    silentAudioKeepalive.destroy()
  }

  /**
   * Set boundary callback for lyrics-style word highlighting
   */
  setBoundaryCallback(callback: ((charIndex: number, charLength: number) => void) | undefined): void {
    this.events.onBoundary = callback
  }
}


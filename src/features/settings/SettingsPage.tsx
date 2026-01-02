import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStorageStats } from './useStorageStats'
import { settingsRepository, DEFAULT_SETTINGS, type SettingKey } from '@/services/storage/settingsRepository'
import { ttsManager, type TTSEngine } from '@/services/tts'
import { PIPER_MODELS } from '@/services/tts/piperService'
import { SUPERTONIC_VOICES } from '@/services/tts/supertonicService'
import { playbackController } from '@/features/player/PlaybackController'
import { ChevronLeftIcon, ChevronRightIcon, VolumeIcon, HeadphonesIcon, TrashIcon, LoaderIcon, CheckIcon, SmartphoneIcon } from '@/ui/icons'

// Helper to get browser voices
function getBrowserVoices(): { id: string; name: string }[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return []
  }
  const voices = window.speechSynthesis.getVoices()
  return voices
    .filter((v) => v.lang.startsWith('en'))
    .map((v) => ({ id: v.voiceURI, name: `${v.name} (${v.lang})` }))
}

// TTS Engine options - derived from registry for UI customization
// (we could use ttsManager.getAvailableEngines() but we want custom descriptions for UI)
const TTS_ENGINES: { id: TTSEngine; name: string; description: string }[] = [
  { id: 'browser', name: 'Browser (Instant)', description: 'Uses your device\'s best voices. Fast and reliable.' },
  { id: 'supertonic', name: 'Supertonic (Fast & Quality)', description: 'Fast AI voice. Great quality on all devices. ~260MB download.' },
  { id: 'piper', name: 'Piper (Experimental)', description: '⚠️ Under development - may not work yet.' },
  { id: 'kokoro', name: 'Kokoro (Best Quality)', description: 'AI voice. Best quality but needs GPU for good speed.' },
]

// Kokoro voice options
const KOKORO_VOICES = [
  { id: 'af_bella', name: 'Bella (Female, American)' },
  { id: 'af_nicole', name: 'Nicole (Female, American)' },
  { id: 'af_sarah', name: 'Sarah (Female, American)' },
  { id: 'af_sky', name: 'Sky (Female, American)' },
  { id: 'am_adam', name: 'Adam (Male, American)' },
  { id: 'am_michael', name: 'Michael (Male, American)' },
  { id: 'bf_emma', name: 'Emma (Female, British)' },
  { id: 'bf_isabella', name: 'Isabella (Female, British)' },
  { id: 'bm_george', name: 'George (Male, British)' },
  { id: 'bm_lewis', name: 'Lewis (Male, British)' },
]

// Piper voice/model options (each model is a different voice)
const PIPER_VOICES = PIPER_MODELS.map((m: typeof PIPER_MODELS[number]) => ({
  id: m.id,
  name: m.name,
  description: `${m.quality} quality, ${m.size}`,
}))

// Supertonic voice options
const SUPERTONIC_VOICE_OPTIONS = SUPERTONIC_VOICES.map((v) => ({
  id: v.id,
  name: v.name,
  description: v.description,
}))

// Model quality options (for Kokoro)
// Note: WebGPU forces fp32 for compatibility, so these only affect WASM mode
const MODEL_CONFIGS = [
  { id: 'q4', name: 'Fast (q4)', description: 'Fastest, smallest (WASM only)' },
  { id: 'q8', name: 'Balanced (q8)', description: 'Good balance (WASM only)' },
  { id: 'fp16', name: 'High (fp16)', description: 'Higher quality (WASM only)' },
  { id: 'fp32', name: 'Full (fp32)', description: 'Best quality, required for WebGPU' },
]

// Processing device options (for Kokoro)
const PROCESSING_DEVICES = [
  { id: 'auto', name: 'Auto', description: 'Use WebGPU if available, otherwise CPU (WASM)' },
  { id: 'webgpu', name: 'WebGPU (GPU)', description: 'Fast but uses fp32 model (~80MB)' },
  { id: 'wasm', name: 'CPU (WASM)', description: 'Slow but supports smaller quantized models' },
]

// Processing device options (for Supertonic)
const SUPERTONIC_DEVICES = [
  { id: 'webgpu', name: 'WebGPU (GPU)', description: 'Best performance — fast and smooth playback' },
  { id: 'wasm', name: 'CPU (WASM)', description: 'Fallback if WebGPU is unavailable' },
]

// Speed options
const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

// Skip interval options
const SKIP_INTERVALS = [5, 10, 15, 30, 45, 60]

const BUFFER_AHEAD_CHOICES: { id: string; label: string; description: string }[] = [
  { id: 'minutes:3', label: '3 minutes', description: 'Good balance (less storage)' },
  { id: 'minutes:10', label: '10 minutes', description: 'Smoother playback' },
  { id: 'minutes:30', label: '30 minutes', description: 'Very smooth, uses more storage' },
  { id: 'chapter', label: 'Entire chapter', description: 'Keep generating until the chapter is fully cached' },
  { id: 'book', label: 'Entire book (∞)', description: 'Maximum caching; may use lots of storage' },
]

export function SettingsPage() {
  const navigate = useNavigate()
  const { stats, isLoading, clearAllAudio, clearBookAudio, clearAllData } = useStorageStats()
  const [showStorageDetails, setShowStorageDetails] = useState(false)
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  
  // Settings state
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [browserVoices, setBrowserVoices] = useState<{ id: string; name: string }[]>([])

  // Load settings on mount
  useEffect(() => {
    settingsRepository.getAll().then((s) => {
      setSettings(s)
      setSettingsLoaded(true)
    })
    
    // Load browser voices
    const loadVoices = () => {
      const voices = getBrowserVoices()
      setBrowserVoices([
        { id: 'default', name: 'System Default' },
        ...voices
      ])
    }
    loadVoices()
    // Voices may load async in some browsers
    window.speechSynthesis?.addEventListener?.('voiceschanged', loadVoices)
    setTimeout(loadVoices, 500)
  }, [])

  const updateSetting = async <K extends SettingKey>(key: K, value: typeof DEFAULT_SETTINGS[K]) => {
    await settingsRepository.set(key, value)
    setSettings((prev) => ({ ...prev, [key]: value }))
    setActiveSheet(null)

    // Proactively apply TTS engine runtime changes.
    // This hot-swaps the TTS engine without requiring an app refresh.
    if (key === 'processingDevice' || key === 'modelConfig' || key === 'ttsEngine' || key === 'piperModel' || key === 'supertonicVoice' || key === 'supertonicDevice') {
      try {
        // Destroy the old TTS engine (terminates worker)
        ttsManager.destroy()
        
        // Tell PlaybackController to reload settings and hot-swap engine
        // This handles audio backend switching, buffer manager restart, etc.
        void playbackController.reloadTTSSettings().catch((e) => {
          console.warn('[Settings] Failed to reload TTS settings in PlaybackController:', e)
        })
      } catch (e) {
        console.warn('[Settings] Failed to apply TTS setting change:', e)
      }
    }
  }

  const handleClearAllAudio = async () => {
    if (confirm('Delete all generated audio? Books will be kept but audio will need to be regenerated.')) {
      await clearAllAudio()
    }
  }

  const handleClearAllData = async () => {
    if (confirm('Delete ALL data including books, audio, and settings? This cannot be undone.')) {
      await clearAllData()
    }
  }

  const handleClearBookAudio = async (bookId: string, title: string) => {
    if (confirm(`Delete cached audio for "${title}"?`)) {
      await clearBookAudio(bookId)
    }
  }

  const getVoiceName = (id: string) => {
    if (settings.ttsEngine === 'browser') {
      return browserVoices.find((v) => v.id === id)?.name || 'System Default'
    }
    if (settings.ttsEngine === 'piper') {
      return PIPER_VOICES.find((v: { id: string; name: string }) => v.id === id)?.name || id
    }
    if (settings.ttsEngine === 'supertonic') {
      return SUPERTONIC_VOICE_OPTIONS.find((v) => v.id === id)?.name || id
    }
    return KOKORO_VOICES.find((v: { id: string; name: string }) => v.id === id)?.name || id
  }
  const getSupertonicVoiceName = (id: string) => SUPERTONIC_VOICE_OPTIONS.find((v) => v.id === id)?.name || id
  const getPiperModelName = (id: string) => PIPER_VOICES.find((v: { id: string; name: string }) => v.id === id)?.name || id
  const getModelName = (id: string) => MODEL_CONFIGS.find((m) => m.id === id)?.name || id
  const getEngineName = (id: string) => TTS_ENGINES.find((e) => e.id === id)?.name || id
  const getDeviceName = (id: string) => PROCESSING_DEVICES.find((d) => d.id === id)?.name || id
  const getSupertonicDeviceName = (id: string) => SUPERTONIC_DEVICES.find((d) => d.id === id)?.name || id
  const getBufferAheadLabel = () => {
    if (settings.bufferAheadMode === 'chapter') return 'Entire chapter'
    if (settings.bufferAheadMode === 'book') return 'Entire book (∞)'
    return `${settings.bufferAheadMinutes} min`
  }

  if (!settingsLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderIcon className="h-8 w-8 text-accent" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={() => navigate(-1)}
          className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary"
          aria-label="Back"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
      </header>

      {/* Settings groups - constrained width on desktop */}
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-y-auto px-5 pb-8">
        {/* Playback settings */}
        <SettingsGroup title="Playback">
          <SettingsItem
            label="Default Speed"
            value={`${settings.defaultSpeed}×`}
            onClick={() => setActiveSheet('speed')}
          />
          <SettingsItem
            label="Skip Forward"
            value={`${settings.skipForwardSeconds}s`}
            onClick={() => setActiveSheet('skipForward')}
          />
          <SettingsItem
            label="Skip Back"
            value={`${settings.skipBackSeconds}s`}
            onClick={() => setActiveSheet('skipBack')}
          />
          <SettingsItem
            label="Auto-rewind on Resume"
            value={`${settings.autoRewindSeconds}s`}
            onClick={() => setActiveSheet('autoRewind')}
          />
        </SettingsGroup>

        {/* TTS settings */}
        <SettingsGroup title="Text-to-Speech">
          <SettingsItem
            icon={<HeadphonesIcon className="h-5 w-5" />}
            label="TTS Engine"
            value={getEngineName(settings.ttsEngine)}
            description="Choose speed vs quality"
            onClick={() => setActiveSheet('ttsEngine')}
          />
          {/* Voice selection - different for each engine */}
          {settings.ttsEngine === 'browser' && (
            <SettingsItem
              icon={<VolumeIcon className="h-5 w-5" />}
              label="Voice"
              value={getVoiceName(settings.voiceId)}
              onClick={() => setActiveSheet('voice')}
            />
          )}
          {settings.ttsEngine === 'supertonic' && (
            <>
              <SettingsItem
                icon={<VolumeIcon className="h-5 w-5" />}
                label="Voice"
                value={getSupertonicVoiceName(settings.supertonicVoice)}
                description="10 high-quality AI voices"
                onClick={() => setActiveSheet('supertonicVoice')}
              />
              <SettingsItem
                label="Processing Device"
                value={getSupertonicDeviceName(settings.supertonicDevice)}
                description="WebGPU is fastest; WASM is fallback for older devices"
                onClick={() => setActiveSheet('supertonicDevice')}
              />
              <SettingsItem
                label="Buffer Ahead"
                value={getBufferAheadLabel()}
                description="Keeps generating ahead even while paused"
                onClick={() => setActiveSheet('bufferAhead')}
              />
            </>
          )}
          {settings.ttsEngine === 'piper' && (
            <>
              <SettingsItem
                icon={<VolumeIcon className="h-5 w-5" />}
                label="Voice"
                value={getPiperModelName(settings.piperModel)}
                description="Each voice is a different neural model"
                onClick={() => setActiveSheet('piperModel')}
              />
              <SettingsItem
                label="Buffer Ahead"
                value={getBufferAheadLabel()}
                description="Keeps generating ahead even while paused"
                onClick={() => setActiveSheet('bufferAhead')}
              />
            </>
          )}
          {settings.ttsEngine === 'kokoro' && (
            <>
              <SettingsItem
                icon={<VolumeIcon className="h-5 w-5" />}
                label="Voice"
                value={getVoiceName(settings.voiceId)}
                onClick={() => setActiveSheet('voice')}
              />
              <SettingsItem
                label="Model Quality"
                value={getModelName(settings.modelConfig)}
                description="WebGPU always uses fp32; quantized models are WASM-only"
                onClick={() => setActiveSheet('modelConfig')}
              />
              <SettingsItem
                label="Processing Device"
                value={getDeviceName(settings.processingDevice)}
                description="WebGPU is fastest when supported"
                onClick={() => setActiveSheet('processingDevice')}
              />
              <SettingsItem
                label="Buffer Ahead"
                value={getBufferAheadLabel()}
                description="Keeps generating ahead even while paused"
                onClick={() => setActiveSheet('bufferAhead')}
              />
            </>
          )}
        </SettingsGroup>

        {/* Storage section */}
        <SettingsGroup title="Storage">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoaderIcon className="h-6 w-6 text-accent" />
            </div>
          ) : stats ? (
            <>
              {/* Storage overview */}
              <div className="border-b border-border-muted px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-text-primary">Storage Used</span>
                  <span className="text-text-secondary">
                    {stats.quotaUsedMB} MB / {stats.quotaTotalMB} MB
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full transition-all ${
                      stats.quotaPercentUsed > 80 ? 'bg-warning' : 'bg-accent'
                    }`}
                    style={{ width: `${Math.min(100, stats.quotaPercentUsed)}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-text-muted">
                  {stats.totalAudioSizeMB} MB audio • {stats.totalChunkCount} chunks • {stats.bookCount} books
                </div>
              </div>

              {/* Per-book storage toggle */}
              <button
                onClick={() => setShowStorageDetails(!showStorageDetails)}
                className="flex w-full items-center justify-between border-b border-border-muted px-4 py-3"
              >
                <span className="text-text-primary">Per-Book Storage</span>
                <ChevronRightIcon
                  className={`h-5 w-5 text-text-muted transition-transform ${
                    showStorageDetails ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {/* Per-book storage details */}
              {showStorageDetails && stats.books.length > 0 && (
                <div className="border-b border-border-muted">
                  {stats.books.map((book) => (
                    <div
                      key={book.id}
                      className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text-primary">{book.title}</p>
                        <p className="text-xs text-text-muted">
                          {book.audioSizeMB} MB • {book.chunkCount} chunks
                        </p>
                      </div>
                      {book.audioSizeMB > 0 && (
                        <button
                          onClick={() => handleClearBookAudio(book.id, book.title)}
                          className="pressable ml-3 flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-warning"
                          aria-label={`Clear audio for ${book.title}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {showStorageDetails && stats.books.length === 0 && (
                <div className="border-b border-border-muted px-4 py-4 text-center text-sm text-text-muted">
                  No books in library
                </div>
              )}

              {/* Clear actions */}
              <SettingsItem
                icon={<TrashIcon className="h-5 w-5 text-warning" />}
                label="Clear All Audio"
                description="Remove all generated audio to free up space"
                onClick={handleClearAllAudio}
                danger
              />
              <SettingsItem
                icon={<TrashIcon className="h-5 w-5 text-error" />}
                label="Clear All Data"
                description="Remove all books, audio, and settings"
                onClick={handleClearAllData}
                danger
              />
            </>
          ) : (
            <div className="px-4 py-4 text-center text-text-muted">Failed to load storage info</div>
          )}
        </SettingsGroup>

        {/* Device Sync */}
        <SettingsGroup title="Device Sync">
          <SettingsItem
            icon={<SmartphoneIcon className="h-5 w-5" />}
            label="Share Library"
            description="Send your books to another device"
            onClick={() => navigate('/app/share-library')}
          />
          <SettingsItem
            icon={<SmartphoneIcon className="h-5 w-5" />}
            label="Import Library"
            description="Receive books from another device"
            onClick={() => navigate('/app/receive-library')}
          />
        </SettingsGroup>

        {/* About */}
        <SettingsGroup title="About">
          <SettingsItem label="Version" value="1.0.0" />
          <SettingsItem 
            label="TTS Engine" 
            value={
              settings.ttsEngine === 'browser' ? 'Web Speech API' :
              settings.ttsEngine === 'piper' ? 'Piper VITS' :
              settings.ttsEngine === 'supertonic' ? 'Supertonic 66M' :
              'Kokoro.js 82M'
            } 
          />
          <SettingsItem label="Debug Logs" description="View/copy logs on mobile (including TTS worker)" onClick={() => navigate('/app/debug-logs')} />
          <SettingsItem label="Help & How it works" onClick={() => navigate('/app/help')} />
          <SettingsItem label="Terms & Privacy" onClick={() => navigate('/app/terms')} />
          <SettingsItem label="License" value="MIT" />
        </SettingsGroup>
      </div>

      {/* Selection Sheets */}
      <SelectionSheet
        isOpen={activeSheet === 'ttsEngine'}
        onClose={() => setActiveSheet(null)}
        title="TTS Engine"
        options={TTS_ENGINES.map((e) => ({ id: e.id, label: e.name, description: e.description }))}
        value={settings.ttsEngine}
        onChange={async (v) => {
          const engine = v as TTSEngine
          
          // IMPORTANT: Set the voice for the new engine FIRST (without triggering reload)
          // so that when reloadTTSSettings runs, it reads the correct voice.
          // This prevents errors like "Voice 'F1' not found" when switching from Supertonic to Kokoro.
          if (engine === 'browser') {
            await settingsRepository.set('voiceId', 'default')
            setSettings((prev) => ({ ...prev, voiceId: 'default' }))
          } else if (engine === 'piper') {
            await settingsRepository.set('piperModel', 'en_US-amy-medium')
            setSettings((prev) => ({ ...prev, piperModel: 'en_US-amy-medium' }))
          } else if (engine === 'supertonic') {
            await settingsRepository.set('supertonicVoice', 'F1')
            setSettings((prev) => ({ ...prev, supertonicVoice: 'F1' }))
          } else if (engine === 'kokoro') {
            await settingsRepository.set('voiceId', 'af_bella')
            setSettings((prev) => ({ ...prev, voiceId: 'af_bella' }))
          }
          
          // Now update the engine (which triggers reloadTTSSettings with correct voice)
          await updateSetting('ttsEngine', engine)
        }}
      />

      <SelectionSheet
        isOpen={activeSheet === 'voice'}
        onClose={() => setActiveSheet(null)}
        title="Select Voice"
        options={settings.ttsEngine === 'browser' 
          ? browserVoices.map((v) => ({ id: v.id, label: v.name }))
          : KOKORO_VOICES.map((v) => ({ id: v.id, label: v.name }))
        }
        value={settings.voiceId}
        onChange={(v) => updateSetting('voiceId', v as typeof settings.voiceId)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'piperModel'}
        onClose={() => setActiveSheet(null)}
        title="Select Piper Voice"
        options={PIPER_VOICES.map((v: { id: string; name: string; description: string }) => ({ id: v.id, label: v.name, description: v.description }))}
        value={settings.piperModel}
        onChange={(v) => updateSetting('piperModel', v as typeof settings.piperModel)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'supertonicVoice'}
        onClose={() => setActiveSheet(null)}
        title="Select Supertonic Voice"
        options={SUPERTONIC_VOICE_OPTIONS.map((v) => ({ id: v.id, label: v.name, description: v.description }))}
        value={settings.supertonicVoice}
        onChange={(v) => updateSetting('supertonicVoice', v as typeof settings.supertonicVoice)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'supertonicDevice'}
        onClose={() => setActiveSheet(null)}
        title="Supertonic Processing Device"
        options={SUPERTONIC_DEVICES.map((d) => ({ id: d.id, label: d.name, description: d.description }))}
        value={settings.supertonicDevice}
        onChange={(v) => updateSetting('supertonicDevice', v as typeof settings.supertonicDevice)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'modelConfig'}
        onClose={() => setActiveSheet(null)}
        title="Model Quality"
        options={MODEL_CONFIGS.map((m) => ({ id: m.id, label: m.name, description: m.description }))}
        value={settings.modelConfig}
        onChange={(v) => updateSetting('modelConfig', v as typeof settings.modelConfig)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'processingDevice'}
        onClose={() => setActiveSheet(null)}
        title="Processing Device"
        options={PROCESSING_DEVICES.map((d) => ({ id: d.id, label: d.name, description: d.description }))}
        value={settings.processingDevice}
        onChange={(v) => updateSetting('processingDevice', v as typeof settings.processingDevice)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'speed'}
        onClose={() => setActiveSheet(null)}
        title="Default Speed"
        options={SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))}
        value={String(settings.defaultSpeed)}
        onChange={(v) => updateSetting('defaultSpeed', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'skipForward'}
        onClose={() => setActiveSheet(null)}
        title="Skip Forward Interval"
        options={SKIP_INTERVALS.map((s) => ({ id: String(s), label: `${s} seconds` }))}
        value={String(settings.skipForwardSeconds)}
        onChange={(v) => updateSetting('skipForwardSeconds', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'skipBack'}
        onClose={() => setActiveSheet(null)}
        title="Skip Back Interval"
        options={SKIP_INTERVALS.map((s) => ({ id: String(s), label: `${s} seconds` }))}
        value={String(settings.skipBackSeconds)}
        onChange={(v) => updateSetting('skipBackSeconds', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'autoRewind'}
        onClose={() => setActiveSheet(null)}
        title="Auto-rewind on Resume"
        options={[0, 5, 10, 15, 30].map((s) => ({ id: String(s), label: s === 0 ? 'Disabled' : `${s} seconds` }))}
        value={String(settings.autoRewindSeconds)}
        onChange={(v) => updateSetting('autoRewindSeconds', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'bufferAhead'}
        onClose={() => setActiveSheet(null)}
        title="Buffer Ahead"
        options={BUFFER_AHEAD_CHOICES.map((c) => ({ id: c.id, label: c.label, description: c.description }))}
        value={
          settings.bufferAheadMode === 'minutes'
            ? `minutes:${settings.bufferAheadMinutes}`
            : settings.bufferAheadMode
        }
        onChange={async (v) => {
          if (v.startsWith('minutes:')) {
            const minutes = Number(v.split(':')[1])
            await updateSetting('bufferAheadMode', 'minutes')
            await updateSetting('bufferAheadMinutes', minutes)
          } else if (v === 'chapter') {
            await updateSetting('bufferAheadMode', 'chapter')
          } else if (v === 'book') {
            await updateSetting('bufferAheadMode', 'book')
          }
        }}
      />
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl bg-surface-1">{children}</div>
    </div>
  )
}

function SettingsItem({
  icon,
  label,
  value,
  description,
  danger,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  value?: string
  description?: string
  danger?: boolean
  onClick?: () => void
}) {
  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-border-muted px-4 py-3 text-left last:border-0 ${
        onClick ? 'pressable active:bg-surface-2' : ''
      }`}
    >
      {icon && <span className={danger ? '' : 'text-accent'}>{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${danger ? 'text-error' : 'text-text-primary'}`}>{label}</p>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>
      {value && <span className="text-sm text-text-secondary">{value}</span>}
      {onClick && !danger && <ChevronRightIcon className="h-5 w-5 flex-shrink-0 text-text-muted" />}
    </Component>
  )
}

function SelectionSheet({
  isOpen,
  onClose,
  title,
  options,
  value,
  onChange,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  options: { id: string; label: string; description?: string }[]
  value: string
  onChange: (value: string) => void
}) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>
        
        {/* Title */}
        <h3 className="border-b border-border-muted px-5 pb-3 text-lg font-semibold text-text-primary md:pt-4">
          {title}
        </h3>
        
        {/* Options */}
        <div className="max-h-[50vh] overflow-y-auto py-2 md:max-h-[60vh]">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => onChange(option.id)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-surface-2 md:hover:bg-surface-2"
            >
              <div className="flex-1">
                <p className="font-medium text-text-primary">{option.label}</p>
                {option.description && (
                  <p className="mt-0.5 text-xs text-text-muted">{option.description}</p>
                )}
              </div>
              {value === option.id && (
                <CheckIcon className="h-5 w-5 text-accent" />
              )}
            </button>
          ))}
        </div>
        
        {/* Safe area padding - mobile only */}
        <div className="h-safe-bottom bg-surface-1 md:hidden" />
      </div>
    </>
  )
}

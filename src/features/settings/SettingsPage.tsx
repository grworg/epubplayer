import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { useStorageStats } from './useStorageStats'
import { settingsRepository, DEFAULT_SETTINGS, type SettingKey } from '@/services/storage/settingsRepository'
import { ttsManager, type TTSEngine } from '@/services/tts'
import { PIPER_MODELS } from '@/services/tts/piperService'
import { SUPERTONIC_VOICES } from '@/services/tts/supertonicService'
import { playbackController } from '@/features/player/PlaybackController'
import { ChevronLeftIcon, ChevronRightIcon, VolumeIcon, HeadphonesIcon, TrashIcon, LoaderIcon, CheckIcon, SmartphoneIcon, GlobeIcon } from '@/ui/icons'
import { useFocusTrap } from '@/ui/accessibility'
import { locales, changeLocale, getActiveLocale, type Locale } from '@/i18n'

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
// Note: These are defined as a function to support i18n translations
function getTTSEngines() {
  return [
    { id: 'browser' as TTSEngine, name: t`Browser (Instant)`, description: t`Uses your device's built-in voices. Fast and reliable.` },
    { id: 'supertonic' as TTSEngine, name: t`Supertonic (Recommended)`, description: t`AI voice with great quality and speed. Works on most devices. ~260MB download.` },
    { id: 'kokoro' as TTSEngine, name: t`Kokoro (Premium)`, description: t`Highest quality AI voice. Requires powerful GPU for smooth playback.` },
    { id: 'piper' as TTSEngine, name: t`Piper (Experimental)`, description: t`⚠️ Under development - may not work yet.` },
  ]
}

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
function getModelConfigs() {
  return [
    { id: 'q4', name: t`Fast (q4)`, description: t`Fastest, smallest (WASM only)` },
    { id: 'q8', name: t`Balanced (q8)`, description: t`Good balance (WASM only)` },
    { id: 'fp16', name: t`High (fp16)`, description: t`Higher quality (WASM only)` },
    { id: 'fp32', name: t`Full (fp32)`, description: t`Best quality, required for WebGPU` },
  ]
}

// Processing device options (for Kokoro)
function getProcessingDevices() {
  return [
    { id: 'auto', name: t`Auto`, description: t`Use WebGPU if available, otherwise CPU (WASM)` },
    { id: 'webgpu', name: t`WebGPU (GPU)`, description: t`Fast but uses fp32 model (~80MB)` },
    { id: 'wasm', name: t`CPU (WASM)`, description: t`Slow but supports smaller quantized models` },
  ]
}

// Processing device options (for Supertonic)
function getSupertonicDevices() {
  return [
    { id: 'webgpu', name: t`WebGPU (GPU)`, description: t`Best performance — fast and smooth playback` },
    { id: 'wasm', name: t`CPU (WASM)`, description: t`Fallback if WebGPU is unavailable` },
  ]
}

// Speed options
const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

// Skip interval options
const SKIP_INTERVALS = [5, 10, 15, 30, 45, 60]

function getBufferAheadChoices() {
  return [
    { id: 'minutes:3', label: t`3 minutes`, description: t`Good balance (less storage)` },
    { id: 'minutes:10', label: t`10 minutes`, description: t`Smoother playback` },
    { id: 'minutes:30', label: t`30 minutes`, description: t`Very smooth, uses more storage` },
    { id: 'chapter', label: t`Entire chapter`, description: t`Keep generating until the chapter is fully cached` },
    { id: 'book', label: t`Entire book (∞)`, description: t`Maximum caching; may use lots of storage` },
  ]
}

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
      return browserVoices.find((v) => v.id === id)?.name || t`System Default`
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
  const getModelName = (id: string) => getModelConfigs().find((m) => m.id === id)?.name || id
  const getEngineName = (id: string) => getTTSEngines().find((e) => e.id === id)?.name || id
  const getDeviceName = (id: string) => getProcessingDevices().find((d) => d.id === id)?.name || id
  const getSupertonicDeviceName = (id: string) => getSupertonicDevices().find((d) => d.id === id)?.name || id
  const getBufferAheadLabel = () => {
    if (settings.bufferAheadMode === 'chapter') return t`Entire chapter`
    if (settings.bufferAheadMode === 'book') return t`Entire book (∞)`
    return t`${settings.bufferAheadMinutes} min`
  }
  const getLocaleName = () => {
    const active = getActiveLocale()
    return locales[active] || active
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
          aria-label={t`Back`}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold text-text-primary"><Trans>Settings</Trans></h1>
      </header>

      {/* Settings groups - constrained width on desktop */}
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-y-auto px-5 pb-8">
        {/* Playback settings */}
        <SettingsGroup title={t`Playback`}>
          <SettingsItem
            label={t`Default Speed`}
            value={`${settings.defaultSpeed}×`}
            onClick={() => setActiveSheet('speed')}
          />
          <SettingsItem
            label={t`Skip Forward`}
            value={`${settings.skipForwardSeconds}s`}
            onClick={() => setActiveSheet('skipForward')}
          />
          <SettingsItem
            label={t`Skip Back`}
            value={`${settings.skipBackSeconds}s`}
            onClick={() => setActiveSheet('skipBack')}
          />
          <SettingsItem
            label={t`Auto-rewind on Resume`}
            value={`${settings.autoRewindSeconds}s`}
            onClick={() => setActiveSheet('autoRewind')}
          />
        </SettingsGroup>

        {/* TTS settings */}
        <SettingsGroup title={t`Text-to-Speech`}>
          <SettingsItem
            icon={<HeadphonesIcon className="h-5 w-5" />}
            label={t`TTS Engine`}
            value={getEngineName(settings.ttsEngine)}
            description={t`Choose speed vs quality`}
            onClick={() => setActiveSheet('ttsEngine')}
          />
          {/* Voice selection - different for each engine */}
          {settings.ttsEngine === 'browser' && (
            <SettingsItem
              icon={<VolumeIcon className="h-5 w-5" />}
              label={t`Voice`}
              value={getVoiceName(settings.voiceId)}
              onClick={() => setActiveSheet('voice')}
            />
          )}
          {settings.ttsEngine === 'supertonic' && (
            <>
              <SettingsItem
                icon={<VolumeIcon className="h-5 w-5" />}
                label={t`Voice`}
                value={getSupertonicVoiceName(settings.supertonicVoice)}
                description={t`10 high-quality AI voices`}
                onClick={() => setActiveSheet('supertonicVoice')}
              />
              <SettingsItem
                label={t`Processing Device`}
                value={getSupertonicDeviceName(settings.supertonicDevice)}
                description={t`WebGPU is fastest; WASM is fallback for older devices`}
                onClick={() => setActiveSheet('supertonicDevice')}
              />
              <SettingsItem
                label={t`Buffer Ahead`}
                value={getBufferAheadLabel()}
                description={t`Keeps generating ahead even while paused`}
                onClick={() => setActiveSheet('bufferAhead')}
              />
            </>
          )}
          {settings.ttsEngine === 'piper' && (
            <>
              <SettingsItem
                icon={<VolumeIcon className="h-5 w-5" />}
                label={t`Voice`}
                value={getPiperModelName(settings.piperModel)}
                description={t`Each voice is a different neural model`}
                onClick={() => setActiveSheet('piperModel')}
              />
              <SettingsItem
                label={t`Buffer Ahead`}
                value={getBufferAheadLabel()}
                description={t`Keeps generating ahead even while paused`}
                onClick={() => setActiveSheet('bufferAhead')}
              />
            </>
          )}
          {settings.ttsEngine === 'kokoro' && (
            <>
              <SettingsItem
                icon={<VolumeIcon className="h-5 w-5" />}
                label={t`Voice`}
                value={getVoiceName(settings.voiceId)}
                onClick={() => setActiveSheet('voice')}
              />
              <SettingsItem
                label={t`Model Quality`}
                value={getModelName(settings.modelConfig)}
                description={t`WebGPU always uses fp32; quantized models are WASM-only`}
                onClick={() => setActiveSheet('modelConfig')}
              />
              <SettingsItem
                label={t`Processing Device`}
                value={getDeviceName(settings.processingDevice)}
                description={t`WebGPU is fastest when supported`}
                onClick={() => setActiveSheet('processingDevice')}
              />
              <SettingsItem
                label={t`Buffer Ahead`}
                value={getBufferAheadLabel()}
                description={t`Keeps generating ahead even while paused`}
                onClick={() => setActiveSheet('bufferAhead')}
              />
            </>
          )}
        </SettingsGroup>

        {/* Storage section */}
        <SettingsGroup title={t`Storage`}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoaderIcon className="h-6 w-6 text-accent" />
            </div>
          ) : stats ? (
            <>
              {/* Storage overview */}
              <div className="border-b border-border-muted px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-text-primary"><Trans>Storage Used</Trans></span>
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
                  <Trans>{stats.totalAudioSizeMB} MB audio • {stats.totalChunkCount} chunks • {stats.bookCount} books</Trans>
                </div>
              </div>

              {/* Per-book storage toggle */}
              <button
                onClick={() => setShowStorageDetails(!showStorageDetails)}
                className="flex w-full items-center justify-between border-b border-border-muted px-4 py-3"
              >
                <span className="text-text-primary"><Trans>Per-Book Storage</Trans></span>
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
                          {book.audioSizeMB} MB • {book.chunkCount} {t`chunks`}
                        </p>
                      </div>
                      {book.audioSizeMB > 0 && (
                        <button
                          onClick={() => handleClearBookAudio(book.id, book.title)}
                          className="pressable ml-3 flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-warning"
                          aria-label={t`Clear audio for ${book.title}`}
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
                  <Trans>No books in library</Trans>
                </div>
              )}

              {/* Clear actions */}
              <SettingsItem
                icon={<TrashIcon className="h-5 w-5 text-warning" />}
                label={t`Clear All Audio`}
                description={t`Remove all generated audio to free up space`}
                onClick={handleClearAllAudio}
                danger
              />
              <SettingsItem
                icon={<TrashIcon className="h-5 w-5 text-error" />}
                label={t`Clear All Data`}
                description={t`Remove all books, audio, and settings`}
                onClick={handleClearAllData}
                danger
              />
            </>
          ) : (
            <div className="px-4 py-4 text-center text-text-muted"><Trans>Failed to load storage info</Trans></div>
          )}
        </SettingsGroup>

        {/* Device Sync */}
        <SettingsGroup title={t`Device Sync`}>
          <SettingsItem
            icon={<SmartphoneIcon className="h-5 w-5" />}
            label={t`Share Library`}
            description={t`Send your books to another device`}
            onClick={() => navigate('/app/share-library')}
          />
          <SettingsItem
            icon={<SmartphoneIcon className="h-5 w-5" />}
            label={t`Import Library`}
            description={t`Receive books from another device`}
            onClick={() => navigate('/app/receive-library')}
          />
        </SettingsGroup>

        {/* About */}
        <SettingsGroup title={t`About`}>
          <SettingsItem
            icon={<GlobeIcon className="h-5 w-5" />}
            label={t`Language`}
            value={getLocaleName()}
            onClick={() => setActiveSheet('language')}
          />
          <SettingsItem label={t`Version`} value="1.0.0" />
          <SettingsItem 
            label={t`TTS Engine`}
            value={
              settings.ttsEngine === 'browser' ? 'Web Speech API' :
              settings.ttsEngine === 'piper' ? 'Piper VITS' :
              settings.ttsEngine === 'supertonic' ? 'Supertonic 66M' :
              'Kokoro.js 82M'
            } 
          />
          <SettingsItem label={t`Debug Logs`} description={t`View/copy logs on mobile (including TTS worker)`} onClick={() => navigate('/app/debug-logs')} />
          <SettingsItem label={t`Accessibility`} description={t`Keyboard shortcuts, screen reader support`} onClick={() => navigate('/app/accessibility')} />
          <SettingsItem label={t`Help & How it works`} onClick={() => navigate('/app/help')} />
          <SettingsItem label={t`Terms & Privacy`} onClick={() => navigate('/app/terms')} />
          <SettingsItem label={t`License`} value="MIT" />
        </SettingsGroup>
      </div>

      {/* Selection Sheets */}
      <SelectionSheet
        isOpen={activeSheet === 'language'}
        onClose={() => setActiveSheet(null)}
        title={t`Language`}
        options={Object.entries(locales).map(([id, name]) => ({ id, label: name }))}
        value={getActiveLocale()}
        onChange={async (v) => {
          await changeLocale(v as Locale)
          // Force re-render to update all translations
          setSettings((prev) => ({ ...prev }))
        }}
      />

      <SelectionSheet
        isOpen={activeSheet === 'ttsEngine'}
        onClose={() => setActiveSheet(null)}
        title={t`TTS Engine`}
        options={getTTSEngines().map((e) => ({ id: e.id, label: e.name, description: e.description }))}
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
        title={t`Select Voice`}
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
        title={t`Select Piper Voice`}
        options={PIPER_VOICES.map((v: { id: string; name: string; description: string }) => ({ id: v.id, label: v.name, description: v.description }))}
        value={settings.piperModel}
        onChange={(v) => updateSetting('piperModel', v as typeof settings.piperModel)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'supertonicVoice'}
        onClose={() => setActiveSheet(null)}
        title={t`Select Supertonic Voice`}
        options={SUPERTONIC_VOICE_OPTIONS.map((v) => ({ id: v.id, label: v.name, description: v.description }))}
        value={settings.supertonicVoice}
        onChange={(v) => updateSetting('supertonicVoice', v as typeof settings.supertonicVoice)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'supertonicDevice'}
        onClose={() => setActiveSheet(null)}
        title={t`Supertonic Processing Device`}
        options={getSupertonicDevices().map((d) => ({ id: d.id, label: d.name, description: d.description }))}
        value={settings.supertonicDevice}
        onChange={(v) => updateSetting('supertonicDevice', v as typeof settings.supertonicDevice)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'modelConfig'}
        onClose={() => setActiveSheet(null)}
        title={t`Model Quality`}
        options={getModelConfigs().map((m) => ({ id: m.id, label: m.name, description: m.description }))}
        value={settings.modelConfig}
        onChange={(v) => updateSetting('modelConfig', v as typeof settings.modelConfig)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'processingDevice'}
        onClose={() => setActiveSheet(null)}
        title={t`Processing Device`}
        options={getProcessingDevices().map((d) => ({ id: d.id, label: d.name, description: d.description }))}
        value={settings.processingDevice}
        onChange={(v) => updateSetting('processingDevice', v as typeof settings.processingDevice)}
      />

      <SelectionSheet
        isOpen={activeSheet === 'speed'}
        onClose={() => setActiveSheet(null)}
        title={t`Default Speed`}
        options={SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))}
        value={String(settings.defaultSpeed)}
        onChange={(v) => updateSetting('defaultSpeed', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'skipForward'}
        onClose={() => setActiveSheet(null)}
        title={t`Skip Forward Interval`}
        options={SKIP_INTERVALS.map((s) => ({ id: String(s), label: t`${s} seconds` }))}
        value={String(settings.skipForwardSeconds)}
        onChange={(v) => updateSetting('skipForwardSeconds', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'skipBack'}
        onClose={() => setActiveSheet(null)}
        title={t`Skip Back Interval`}
        options={SKIP_INTERVALS.map((s) => ({ id: String(s), label: t`${s} seconds` }))}
        value={String(settings.skipBackSeconds)}
        onChange={(v) => updateSetting('skipBackSeconds', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'autoRewind'}
        onClose={() => setActiveSheet(null)}
        title={t`Auto-rewind on Resume`}
        options={[0, 5, 10, 15, 30].map((s) => ({ id: String(s), label: s === 0 ? t`Disabled` : t`${s} seconds` }))}
        value={String(settings.autoRewindSeconds)}
        onChange={(v) => updateSetting('autoRewindSeconds', Number(v))}
      />

      <SelectionSheet
        isOpen={activeSheet === 'bufferAhead'}
        onClose={() => setActiveSheet(null)}
        title={t`Buffer Ahead`}
        options={getBufferAheadChoices().map((c) => ({ id: c.id, label: c.label, description: c.description }))}
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
  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
  })
  
  // Generate a unique ID for this sheet instance
  const titleId = `selection-sheet-${title.toLowerCase().replace(/\s+/g, '-')}`

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
      >
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>
        
        {/* Title */}
        <h3 id={titleId} className="border-b border-border-muted px-5 pb-3 text-lg font-semibold text-text-primary md:pt-4">
          {title}
        </h3>
        
        {/* Options */}
        <div role="listbox" aria-labelledby={titleId} className="max-h-[50vh] overflow-y-auto py-2 md:max-h-[60vh]">
          {options.map((option) => (
            <button
              key={option.id}
              role="option"
              aria-selected={value === option.id}
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
        <div className="h-safe-bottom bg-surface-1 md:hidden" aria-hidden="true" />
      </div>
    </>
  )
}

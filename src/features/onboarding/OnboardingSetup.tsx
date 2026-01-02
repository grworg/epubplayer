import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeadphonesIcon, CheckIcon, LoaderIcon, SmartphoneIcon } from '@/ui/icons'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { defaultBookService } from '@/services/defaultBooks'
import { ttsManager } from '@/services/tts'
import { createLogger } from '@/services/logging'
import type { TTSEngine } from '@/services/tts/types'

const log = createLogger('app')

// ============================================================================
// Device Detection Types
// ============================================================================

interface GPUInfo {
  available: boolean
  vendor?: string
  architecture?: string
  description?: string
  isHighPerformance: boolean
}

interface DeviceCapabilities {
  hasSpeechSynthesis: boolean
  isMobile: boolean
  gpu: GPUInfo
  isChecking: boolean
}

type RecommendedEngine = 'kokoro' | 'supertonic' | 'browser'

interface EngineRecommendation {
  engine: RecommendedEngine
  reason: string
}

// ============================================================================
// Device Detection Utilities
// ============================================================================

function detectIsMobile(): boolean {
  // Check for touch capability + small screen (more reliable than UA sniffing)
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const isSmallScreen = window.innerWidth < 768
  
  // Also check user agent for mobile keywords as backup
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
  
  return (hasTouch && isSmallScreen) || mobileUA
}

async function detectGPU(): Promise<GPUInfo> {
  const noGPU: GPUInfo = { available: false, isHighPerformance: false }
  
  try {
    // Check if WebGPU is available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpu = (navigator as any).gpu
    if (!gpu) return noGPU
    
    // Request a high-performance adapter
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return noGPU
    
    // Get adapter info
    const info = await adapter.requestAdapterInfo?.()
    
    // Determine if this is a "high performance" GPU
    // Desktop GPUs typically have more identifiable vendor/architecture info
    // and don't have "integrated" in their description
    const description = info?.description?.toLowerCase() || ''
    const vendor = info?.vendor?.toLowerCase() || ''
    const architecture = info?.architecture?.toLowerCase() || ''
    
    // High performance indicators:
    // - Discrete GPU (not integrated)
    // - Known desktop GPU vendors/architectures
    // - Larger memory (not easily detectable via API, so we use heuristics)
    const isIntegrated = description.includes('integrated') || 
                         description.includes('intel uhd') ||
                         description.includes('intel iris') ||
                         architecture.includes('gen')
    
    const isDiscreteGPU = vendor.includes('nvidia') || 
                          vendor.includes('amd') ||
                          description.includes('radeon') ||
                          description.includes('geforce') ||
                          description.includes('rtx') ||
                          description.includes('gtx')
    
    // Format a nice display description
    let displayDesc = info?.description || info?.vendor || 'WebGPU Available'
    if (displayDesc.length > 40) {
      displayDesc = displayDesc.substring(0, 37) + '...'
    }
    
    return {
      available: true,
      vendor: info?.vendor,
      architecture: info?.architecture,
      description: displayDesc,
      isHighPerformance: isDiscreteGPU && !isIntegrated,
    }
  } catch {
    return noGPU
  }
}

function getEngineRecommendation(capabilities: DeviceCapabilities): EngineRecommendation {
  const { gpu, isMobile, hasSpeechSynthesis } = capabilities
  
  // Desktop with WebGPU (especially with a good GPU) → Kokoro
  if (gpu.available && !isMobile) {
    return {
      engine: 'kokoro',
      reason: gpu.isHighPerformance 
        ? `Best quality — your ${gpu.description || 'GPU'} can handle it` 
        : 'Best quality — your device has WebGPU',
    }
  }
  
  // Mobile with WebGPU → Supertonic
  if (gpu.available && isMobile) {
    return {
      engine: 'supertonic',
      reason: 'Optimized for mobile — fast and great quality',
    }
  }
  
  // No WebGPU → Browser TTS
  if (hasSpeechSynthesis) {
    return {
      engine: 'browser',
      reason: 'Works instantly on your device — no download needed',
    }
  }
  
  // Fallback (should rarely happen)
  return {
    engine: 'browser',
    reason: 'Uses your device\'s built-in voices',
  }
}

// ============================================================================
// Component
// ============================================================================

interface OnboardingSetupProps {
  onComplete: (defaultBookId?: string) => void
}

export function OnboardingSetup({ onComplete }: OnboardingSetupProps) {
  const [step, setStep] = useState<'welcome' | 'engine' | 'installing'>('welcome')
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>({
    hasSpeechSynthesis: false,
    isMobile: false,
    gpu: { available: false, isHighPerformance: false },
    isChecking: true,
  })
  const [selectedEngine, setSelectedEngine] = useState<RecommendedEngine>('browser')
  const [recommendation, setRecommendation] = useState<EngineRecommendation | null>(null)

  // Check device capabilities on mount
  useEffect(() => {
    async function checkCapabilities() {
      const hasSpeechSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window
      const isMobile = detectIsMobile()
      const gpu = await detectGPU()

      const caps: DeviceCapabilities = {
        hasSpeechSynthesis,
        isMobile,
        gpu,
        isChecking: false,
      }

      setCapabilities(caps)
      
      // Set recommended engine based on capabilities
      const rec = getEngineRecommendation(caps)
      setRecommendation(rec)
      setSelectedEngine(rec.engine)
    }

    checkCapabilities()
  }, [])

  const handleFinishSetup = async () => {
    setStep('installing')
    
    // Save settings with sensible defaults based on engine
    await settingsRepository.set('ttsEngine', selectedEngine as TTSEngine)
    
    if (selectedEngine === 'kokoro') {
      // Use a nice default voice for Kokoro
      await settingsRepository.set('voiceId', 'af_bella')
      await settingsRepository.set('modelConfig', 'q4')
      await settingsRepository.set('processingDevice', 'auto')
    } else if (selectedEngine === 'supertonic') {
      // Use default voice (F1) for Supertonic
      await settingsRepository.set('supertonicVoice', 'F1')
      // WebGPU is the default and best option; explicitly set it when available
      // (WASM fallback happens automatically if WebGPU isn't supported)
      if (capabilities.gpu.available) {
        await settingsRepository.set('supertonicDevice', 'webgpu')
      }
    }
    
    // Start TTS model preloading immediately after saving engine settings
    // This gives us a head start while the default book is being installed
    // By the time the user lands on the library and clicks play, the model
    // should be mostly or fully loaded
    const caps = ttsManager.getEngineCapabilities(selectedEngine as TTSEngine)
    if (caps.requiresInit) {
      log.info('Starting TTS preload after onboarding', { engine: selectedEngine })
      // Fire-and-forget - don't await, let it load in background
      ttsManager.initialize().catch((err) => {
        log.error('TTS preload failed during onboarding', err)
        // Don't fail onboarding if preload fails - user can still use the app
      })
    }
    
    // Install the default sample book
    const bookId = await defaultBookService.installPrimaryDefault()
    
    // Go directly to library
    onComplete(bookId ?? undefined)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-md">
        {step === 'welcome' && (
          <WelcomeStep onContinue={() => setStep('engine')} />
        )}

        {step === 'engine' && (
          <EngineStep
            capabilities={capabilities}
            selectedEngine={selectedEngine}
            recommendation={recommendation}
            onSelectEngine={setSelectedEngine}
            onContinue={handleFinishSetup}
            onBack={() => setStep('welcome')}
          />
        )}

        {step === 'installing' && (
          <InstallingStep />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  const navigate = useNavigate()
  
  return (
    <div className="animate-fade-in text-center">
      {/* Icon */}
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-500/20">
        <HeadphonesIcon className="h-10 w-10 text-accent" />
      </div>

      {/* Heading */}
      <h1 className="mb-3 text-2xl font-bold text-text-primary">
        Welcome to EPUB Player
      </h1>
      <p className="mb-8 text-text-secondary">
        Turn any ebook into an audiobook. Let's get you set up.
      </p>

      {/* Features preview */}
      <div className="mb-8 space-y-3 text-left">
        <FeaturePreview icon="🎧" text="Listen to any EPUB as an audiobook" />
        <FeaturePreview icon="🤖" text="AI-powered voices or your device's built-in TTS" />
        <FeaturePreview icon="📴" text="Everything runs locally — works offline" />
      </div>

      <button
        onClick={onContinue}
        className="pressable w-full rounded-full bg-accent px-6 py-4 text-lg font-semibold text-white shadow-lg shadow-accent/30"
      >
        Get Started
      </button>
      
      {/* Import from another device option */}
      <button
        onClick={() => navigate('/app/receive-library')}
        className="pressable mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-surface-1 px-6 py-3 font-medium text-text-primary hover:bg-surface-2"
      >
        <SmartphoneIcon className="h-5 w-5 text-accent" />
        Already have books on another device?
      </button>
    </div>
  )
}

function FeaturePreview({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-1 p-3">
      <span className="text-xl">{icon}</span>
      <span className="text-sm text-text-secondary">{text}</span>
    </div>
  )
}

function EngineStep({
  capabilities,
  selectedEngine,
  recommendation,
  onSelectEngine,
  onContinue,
  onBack,
}: {
  capabilities: DeviceCapabilities
  selectedEngine: RecommendedEngine
  recommendation: EngineRecommendation | null
  onSelectEngine: (engine: RecommendedEngine) => void
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div className="animate-fade-in">
      {/* Header */}
      <button
        onClick={onBack}
        className="mb-4 text-sm text-text-secondary hover:text-text-primary"
      >
        ← Back
      </button>

      <h2 className="mb-2 text-xl font-bold text-text-primary">
        Choose Your Voice
      </h2>
      <p className="mb-6 text-sm text-text-secondary">
        We picked the best option for your device. You can always change this in Settings.
      </p>

      {/* Device info pill */}
      {!capabilities.isChecking && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <DevicePill 
            label={capabilities.isMobile ? 'Mobile' : 'Desktop'} 
            icon={capabilities.isMobile ? '📱' : '💻'}
          />
          {capabilities.gpu.available ? (
            <DevicePill 
              label={capabilities.gpu.description || 'WebGPU'} 
              icon="⚡"
              highlight
            />
          ) : (
            <DevicePill label="No WebGPU" icon="💤" />
          )}
        </div>
      )}

      {capabilities.isChecking ? (
        <div className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-surface-1 p-6 text-text-secondary">
          <LoaderIcon className="h-5 w-5" />
          <span>Checking your device...</span>
        </div>
      ) : (
        <>
          {/* Engine options */}
          <div className="mb-6 space-y-3">
            {/* Kokoro - Desktop + WebGPU */}
            {capabilities.gpu.available && (
              <EngineOption
                name="Kokoro"
                quality="Best"
                qualityColor="text-emerald-400"
                description="Highest quality AI voice. Natural and expressive."
                downloadSize="~80MB"
                isSelected={selectedEngine === 'kokoro'}
                isRecommended={recommendation?.engine === 'kokoro'}
                recommendReason={recommendation?.engine === 'kokoro' ? recommendation.reason : undefined}
                onSelect={() => onSelectEngine('kokoro')}
              />
            )}
            
            {/* Supertonic - Mobile + WebGPU or as alternative */}
            {capabilities.gpu.available && (
              <EngineOption
                name="Supertonic"
                quality="Great"
                qualityColor="text-blue-400"
                description="Fast AI voice that works great on all devices."
                downloadSize="~260MB"
                isSelected={selectedEngine === 'supertonic'}
                isRecommended={recommendation?.engine === 'supertonic'}
                recommendReason={recommendation?.engine === 'supertonic' ? recommendation.reason : undefined}
                onSelect={() => onSelectEngine('supertonic')}
              />
            )}
            
            {/* Browser TTS - Always available */}
            <EngineOption
              name="Browser TTS"
              quality={capabilities.gpu.available ? 'Basic' : 'Default'}
              qualityColor={capabilities.gpu.available ? 'text-text-muted' : 'text-amber-400'}
              description="Uses your device's built-in voices. No download required."
              isSelected={selectedEngine === 'browser'}
              isRecommended={recommendation?.engine === 'browser'}
              recommendReason={recommendation?.engine === 'browser' ? recommendation.reason : undefined}
              onSelect={() => onSelectEngine('browser')}
            />
          </div>

          {/* Info callout based on selection */}
          <SelectionInfo 
            selectedEngine={selectedEngine} 
            gpu={capabilities.gpu}
            isMobile={capabilities.isMobile}
          />
        </>
      )}

      <button
        onClick={onContinue}
        disabled={capabilities.isChecking}
        className="pressable w-full rounded-full bg-accent px-6 py-4 font-semibold text-white shadow-lg shadow-accent/30 disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  )
}

function DevicePill({ 
  label, 
  icon, 
  highlight 
}: { 
  label: string
  icon: string
  highlight?: boolean 
}) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
      highlight 
        ? 'bg-emerald-500/20 text-emerald-400' 
        : 'bg-surface-2 text-text-secondary'
    }`}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  )
}

function EngineOption({
  name,
  quality,
  qualityColor,
  description,
  downloadSize,
  isSelected,
  isRecommended,
  recommendReason,
  onSelect,
}: {
  name: string
  quality: string
  qualityColor: string
  description: string
  downloadSize?: string
  isSelected: boolean
  isRecommended: boolean
  recommendReason?: string
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`pressable w-full rounded-xl p-4 text-left transition-all ${
        isSelected
          ? 'bg-accent/20 ring-2 ring-accent'
          : 'bg-surface-1 hover:bg-surface-2'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text-primary">{name}</span>
            <span className={`text-xs font-medium ${qualityColor}`}>
              {quality}
            </span>
            {isRecommended && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
          {isRecommended && recommendReason && (
            <p className="mt-1.5 text-xs text-accent">{recommendReason}</p>
          )}
          {downloadSize && (
            <p className="mt-1.5 text-xs text-text-muted">
              {downloadSize} one-time download
            </p>
          )}
        </div>
        <div className={`flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border-2 ${
          isSelected ? 'border-accent bg-accent' : 'border-surface-4'
        }`}>
          {isSelected && <CheckIcon className="h-3 w-3 text-white" />}
        </div>
      </div>
    </button>
  )
}

function SelectionInfo({ 
  selectedEngine, 
  gpu,
  isMobile,
}: { 
  selectedEngine: RecommendedEngine
  gpu: GPUInfo
  isMobile: boolean
}) {
  let message: string
  let icon: string
  let bgColor: string
  let textColor: string
  
  switch (selectedEngine) {
    case 'kokoro':
      message = 'Kokoro provides the most natural, expressive speech. Perfect for long listening sessions.'
      icon = '✨'
      bgColor = 'bg-emerald-500/10'
      textColor = 'text-emerald-400'
      break
    case 'supertonic':
      if (isMobile) {
        message = 'Supertonic is optimized for mobile — you\'ll get great quality with smooth performance.'
      } else {
        message = 'Supertonic offers great quality and fast generation on all devices.'
      }
      icon = '⚡'
      bgColor = 'bg-blue-500/10'
      textColor = 'text-blue-400'
      break
    case 'browser':
      if (!gpu.available) {
        message = 'Browser TTS uses your device\'s voices. AI voices require WebGPU, which isn\'t available on this device.'
      } else {
        message = 'Browser TTS is instant with no download, but quality varies by device.'
      }
      icon = '💬'
      bgColor = 'bg-amber-500/10'
      textColor = 'text-amber-400'
      break
  }
  
  return (
    <div className={`mb-6 rounded-xl p-4 ${bgColor}`}>
      <div className="flex gap-2">
        <span className="flex-shrink-0">{icon}</span>
        <p className={`text-sm ${textColor}`}>{message}</p>
      </div>
    </div>
  )
}

function InstallingStep() {
  return (
    <div className="animate-fade-in text-center">
      {/* Loading icon */}
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>

      <h2 className="mb-3 text-2xl font-bold text-text-primary">
        Setting Up Your Library
      </h2>
      <p className="text-text-secondary">
        Just a moment...
      </p>
    </div>
  )
}

import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { SpeedIcon, CheckIcon } from '@/ui/icons'
import { useFocusTrap } from '@/ui/accessibility'

interface SpeedSheetProps {
  isOpen: boolean
  onClose: () => void
  currentSpeed: number
  onSpeedChange: (speed: number) => void
}

function getSpeedOptions() {
  return [
    { value: 0.5, label: '0.5×', description: t`Half speed` },
    { value: 0.75, label: '0.75×', description: t`Slower` },
    { value: 1.0, label: '1×', description: t`Normal` },
    { value: 1.25, label: '1.25×', description: t`Slightly faster` },
    { value: 1.5, label: '1.5×', description: t`Faster` },
    { value: 1.75, label: '1.75×', description: t`Much faster` },
    { value: 2.0, label: '2×', description: t`Double speed` },
  ]
}

export function SpeedSheet({ isOpen, onClose, currentSpeed, onSpeedChange }: SpeedSheetProps) {
  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
  })

  if (!isOpen) return null

  const handleSelect = (speed: number) => {
    onSpeedChange(speed)
    onClose()
  }

  const speedOptions = getSpeedOptions()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="speed-sheet-title"
        className="relative w-full max-w-md rounded-t-3xl bg-surface-1 pb-[max(1.5rem,var(--safe-area-bottom))] md:rounded-2xl md:pb-6"
      >
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pb-4 md:pt-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
            <SpeedIcon className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 id="speed-sheet-title" className="text-lg font-semibold text-text-primary">
              <Trans>Playback Speed</Trans>
            </h2>
            <p className="text-sm text-text-secondary">
              <Trans>Currently {currentSpeed}×</Trans>
            </p>
          </div>
        </div>

        {/* Speed options grid */}
        <div className="grid grid-cols-3 gap-2 px-4 md:grid-cols-4">
          {speedOptions.map((option) => {
            const isSelected = currentSpeed === option.value
            return (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={`pressable relative flex flex-col items-center justify-center rounded-2xl px-3 py-4 transition-all ${
                  isSelected
                    ? 'bg-accent text-white shadow-lg shadow-accent/25'
                    : 'bg-surface-2 text-text-primary hover:bg-surface-3'
                }`}
              >
                <span className={`text-xl font-bold ${isSelected ? 'text-white' : 'text-text-primary'}`}>
                  {option.label}
                </span>
                <span className={`mt-1 text-xs ${isSelected ? 'text-white/80' : 'text-text-muted'}`}>
                  {option.description}
                </span>
                {isSelected && (
                  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow">
                    <CheckIcon className="h-3 w-3 text-accent" />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Tip */}
        <p className="mt-4 px-6 text-center text-xs text-text-muted">
          <Trans>Tip: Higher speeds work best with AI voices</Trans>
        </p>
      </div>
    </div>
  )
}

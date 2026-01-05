import { Trans, t } from '@lingui/macro'
import {
  useSleepTimer,
  SLEEP_TIMER_OPTIONS,
  type SleepTimerDuration,
} from '@/features/player/useSleepTimer'
import { MoonIcon } from '@/ui/icons'
import { useFocusTrap } from '@/ui/accessibility'

interface SleepTimerSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function SleepTimerSheet({ isOpen, onClose }: SleepTimerSheetProps) {
  const { remainingMinutes, isActive, setTimer } = useSleepTimer()
  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
  })

  if (!isOpen) return null

  const handleSelect = (minutes: SleepTimerDuration) => {
    setTimer(minutes)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sleep-timer-title"
        className="relative w-full max-w-lg rounded-t-3xl bg-surface-1 pb-[max(1.5rem,var(--safe-area-bottom))] md:rounded-2xl md:pb-4"
      >
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pb-4 md:pt-4">
          <MoonIcon className="h-6 w-6 text-accent" />
          <div>
            <h2 id="sleep-timer-title" className="text-lg font-semibold text-text-primary">
              <Trans>Sleep Timer</Trans>
            </h2>
            {isActive && (
              <p className="text-sm text-text-secondary">
                <Trans>{remainingMinutes} {remainingMinutes !== 1 ? 'minutes' : 'minute'} remaining</Trans>
              </p>
            )}
          </div>
        </div>

        {/* Options */}
        <div className="space-y-1 px-4">
          {SLEEP_TIMER_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={`pressable flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors ${
                isActive && option.value === 0
                  ? 'bg-error/10 text-error'
                  : 'text-text-primary hover:bg-surface-2'
              }`}
            >
              <span className="font-medium">
                {option.value === 0 && isActive ? t`Cancel Timer` : option.label}
              </span>
              {isActive && remainingMinutes === option.value && option.value !== 0 && (
                <span className="text-accent">✓</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

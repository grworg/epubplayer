import {
  useSleepTimer,
  SLEEP_TIMER_OPTIONS,
  type SleepTimerDuration,
} from '@/features/player/useSleepTimer'
import { MoonIcon } from '@/ui/icons'

interface SleepTimerSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function SleepTimerSheet({ isOpen, onClose }: SleepTimerSheetProps) {
  const { remainingMinutes, isActive, setTimer } = useSleepTimer()

  if (!isOpen) return null

  const handleSelect = (minutes: SleepTimerDuration) => {
    setTimer(minutes)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div className="relative w-full max-w-lg rounded-t-3xl bg-surface-1 pb-[max(1.5rem,var(--safe-area-bottom))] md:rounded-2xl md:pb-4">
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pb-4 md:pt-4">
          <MoonIcon className="h-6 w-6 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Sleep Timer</h2>
            {isActive && (
              <p className="text-sm text-text-secondary">
                {remainingMinutes} minute{remainingMinutes !== 1 ? 's' : ''} remaining
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
                {option.value === 0 && isActive ? 'Cancel Timer' : option.label}
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

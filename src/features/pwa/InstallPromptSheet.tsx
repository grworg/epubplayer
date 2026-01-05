import { InstallIcon, CheckIcon } from '@/ui/icons'
import { usePWAInstall, getInstallInstructions } from './usePWAInstall'
import { useFocusTrap } from '@/ui/accessibility'

interface InstallPromptSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function InstallPromptSheet({ isOpen, onClose }: InstallPromptSheetProps) {
  const { platform, canPromptNatively, triggerNativeInstall, dismissPrompt } = usePWAInstall()
  const instructions = getInstallInstructions(platform)
  
  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
  })

  if (!isOpen) return null

  const handleDismiss = async () => {
    await dismissPrompt()
    onClose()
  }

  const handleNativeInstall = async () => {
    await triggerNativeInstall()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Sheet/Modal */}
      <div 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-prompt-title"
        className="relative w-full max-w-lg animate-slide-up rounded-t-3xl bg-surface-1 pb-[max(1.5rem,var(--safe-area-bottom))] md:animate-fade-in md:rounded-xl"
      >
        {/* Handle */}
        <div className="flex justify-center py-3 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-4 px-6 pb-4 pt-2 md:pt-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20">
            <InstallIcon className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h2 id="install-prompt-title" className="text-xl font-bold text-text-primary">{instructions.title}</h2>
            <p className="text-sm text-text-secondary">Get the full app experience</p>
          </div>
        </div>

        {/* Benefits */}
        <div className="mx-6 mb-4 rounded-xl bg-surface-2 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">
            Why install?
          </p>
          <div className="space-y-2">
            <Benefit text="Works offline — listen anywhere" />
            <Benefit text="Launches from your home screen" />
            <Benefit text="Full-screen experience, no browser UI" />
            <Benefit text="Faster load times" />
          </div>
        </div>

        {/* Native install button (Chrome/Edge) */}
        {canPromptNatively && (
          <div className="px-6 pb-4">
            <button
              onClick={handleNativeInstall}
              className="pressable flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-4 font-semibold text-white shadow-lg shadow-accent/30"
            >
              <InstallIcon className="h-5 w-5" />
              Install Now
            </button>
          </div>
        )}

        {/* Manual instructions */}
        {!canPromptNatively && (
          <div className="px-6 pb-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">
              How to install
            </p>
            <ol className="space-y-3">
              {instructions.steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                    {index + 1}
                  </span>
                  <span className="text-sm text-text-secondary">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 px-6 pt-2">
          <button
            onClick={handleDismiss}
            className="pressable flex-1 rounded-xl bg-surface-2 py-3 text-sm font-medium text-text-secondary hover:bg-surface-3"
          >
            Don't show again
          </button>
          <button
            onClick={onClose}
            className="pressable flex-1 rounded-xl bg-surface-3 py-3 text-sm font-medium text-text-primary hover:bg-surface-4"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}

function Benefit({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <CheckIcon className="h-4 w-4 text-success" />
      <span>{text}</span>
    </div>
  )
}


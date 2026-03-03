import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { useLibrary } from './useLibrary'
import { PlusIcon, UploadIcon, HeadphonesIcon, LoaderIcon, SettingsIcon, BellIcon, SmartphoneIcon, GitHubIcon } from '@/ui/icons'
import { OnboardingSetup } from '@/features/onboarding/OnboardingSetup'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { usePWAInstall } from '@/features/pwa/usePWAInstall'
import { InstallPromptSheet } from '@/features/pwa/InstallPromptSheet'

export function LibraryPage() {
  const navigate = useNavigate()
  const { books, isLoading } = useLibrary()
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null)
  const [showInstallPrompt, setShowInstallPrompt] = useState(false)
  const { shouldShowPrompt: hasInstallNotification } = usePWAInstall()

  useEffect(() => {
    settingsRepository.get('hasCompletedOnboarding').then(setHasCompletedOnboarding)
  }, [])

  const handleOnboardingComplete = async (defaultBookId?: string) => {
    await settingsRepository.set('hasCompletedOnboarding', true)
    setHasCompletedOnboarding(true)
    if (defaultBookId) {
      navigate(`/app/book/${defaultBookId}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4">
        <h1 className="text-2xl font-bold text-text-primary"><Trans>Library</Trans></h1>
        <div className="flex items-center gap-2">
          {hasInstallNotification && (
            <button
              onClick={() => setShowInstallPrompt(true)}
              className="pressable relative flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary hover:bg-surface-2"
              aria-label={t`Notifications`}
              title={t`Install app`}
            >
              <BellIcon className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-accent shadow-lg shadow-accent/50" />
            </button>
          )}
          <a
            href="https://github.com/grworg/epubplayer"
            target="_blank"
            rel="noopener noreferrer"
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary hover:bg-surface-2"
            aria-label={t`View on GitHub`}
            title={t`View on GitHub`}
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          <button
            onClick={() => navigate('/app/share-library')}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary hover:bg-surface-2"
            aria-label={t`Send to device`}
            title={t`Send to another device`}
          >
            <SmartphoneIcon className="h-5 w-5" />
          </button>
          <button
            onClick={() => navigate('/app/settings')}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary hover:bg-surface-2"
            aria-label={t`Settings`}
            title={t`Settings`}
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
          <button
            onClick={() => navigate('/app/import')}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white"
            aria-label={t`Add book`}
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Book grid */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {isLoading || hasCompletedOnboarding === null ? (
          <div className="flex h-full items-center justify-center">
            <LoaderIcon className="h-8 w-8 text-accent" />
          </div>
        ) : books.length === 0 && !hasCompletedOnboarding ? (
          <OnboardingSetup onComplete={handleOnboardingComplete} />
        ) : books.length === 0 ? (
          <EmptyLibrary onAddBook={() => navigate('/app/import')} />
        ) : (
          <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 lg:grid-cols-3">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onClick={() => navigate(`/app/book/${book.id}`)} />
            ))}
            <AddBookCard onAddBook={() => navigate('/app/import')} />
          </div>
        )}
      </div>

      {/* Install prompt sheet */}
      <InstallPromptSheet isOpen={showInstallPrompt} onClose={() => setShowInstallPrompt(false)} />
    </div>
  )
}

function EmptyLibrary({ onAddBook }: { onAddBook: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-surface-2">
        <HeadphonesIcon className="h-12 w-12 text-accent" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-text-primary"><Trans>No books yet</Trans></h2>
      <p className="mb-6 text-text-secondary">
        <Trans>Import an EPUB, PDF, or web article to start listening. Your books, generated audio, and settings are stored locally on this device.</Trans>
      </p>
      <button
        onClick={onAddBook}
        className="pressable flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-white"
      >
        <UploadIcon className="h-5 w-5" />
        <Trans>Add Book</Trans>
      </button>
      
      <Link
        to="/app/receive-library"
        className="pressable mt-4 flex items-center gap-2 rounded-full bg-surface-1 px-6 py-3 font-medium text-text-primary hover:bg-surface-2"
      >
        <SmartphoneIcon className="h-5 w-5 text-accent" />
        <Trans>Import from another device</Trans>
      </Link>
      
      <div className="mt-6 space-y-2 text-sm text-text-muted">
        <p>
          <Trans>Don't have any EPUBs?</Trans> <Link className="text-accent underline" to="/app/find-ebooks"><Trans>Find free ebooks →</Trans></Link>
        </p>
        <p>
          <Trans>New here? Visit</Trans> <Link className="text-accent underline" to="/app/help"><Trans>Help &amp; How it works</Trans></Link>.
        </p>
      </div>
    </div>
  )
}

interface BookCardProps {
  book: {
    id: string
    title: string
    author: string
    coverUrl?: string
    progress?: number
  }
  onClick: () => void
}

function BookCard({ book, onClick }: BookCardProps) {
  return (
    <button
      onClick={onClick}
      className="pressable group flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-surface-1 p-3 text-left transition-colors hover:bg-surface-2 md:flex-col md:items-stretch md:p-4"
    >
      {/* Cover - horizontal on mobile, larger on desktop */}
      <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-surface-3 md:h-48 md:w-full">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-3 to-surface-4">
            <span className="text-2xl opacity-50 md:text-4xl">📖</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1 md:mt-3">
        <h3 className="mb-1 line-clamp-2 text-base font-semibold text-text-primary">{book.title}</h3>
        <p className="truncate text-sm text-text-secondary">{book.author}</p>

        {/* Progress bar */}
        {book.progress !== undefined && book.progress > 0 && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-accent" style={{ width: `${book.progress}%` }} />
          </div>
        )}
      </div>
    </button>
  )
}

function AddBookCard({ onAddBook }: { onAddBook: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onAddBook}
        className="pressable group flex w-full items-center gap-4 rounded-2xl border border-dashed border-border-muted bg-surface-0 p-4 text-left text-text-secondary transition-colors hover:bg-surface-1 md:flex-col md:items-center md:justify-center md:py-12"
        aria-label={t`Import book`}
      >
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-surface-1 text-accent md:h-16 md:w-16">
          <UploadIcon className="h-6 w-6 md:h-8 md:w-8" />
        </div>
        <div className="min-w-0 flex-1 md:mt-4 md:flex-initial md:text-center">
          <p className="text-base font-semibold text-text-primary"><Trans>Add Book</Trans></p>
          <p className="mt-0.5 text-sm text-text-secondary md:hidden">
            <Trans>Import EPUB, PDF, or web article</Trans>
          </p>
        </div>
      </button>
      <Link 
        to="/app/find-ebooks" 
        className="text-center text-sm text-text-muted hover:text-accent"
      >
        <Trans>Need EPUBs? Find free ebooks →</Trans>
      </Link>
    </div>
  )
}

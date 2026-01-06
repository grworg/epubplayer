/**
 * Share Library Page (Sender)
 * 
 * Displays QR code and waits for receiver to connect.
 * Uses the new transfer session architecture (ADR-0016).
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { getShortCode } from '@/services/transfer'
import { bookRepository } from '@/services/storage'
import { ChevronLeftIcon, LoaderIcon, CheckIcon, SmartphoneIcon, WifiIcon } from '@/ui/icons'
import { useSenderSession } from './useTransferSession'

export function ShareLibraryPage() {
  const navigate = useNavigate()
  const { state, cancel, reset } = useSenderSession()
  const [transferableCount, setTransferableCount] = useState(0)

  // Load book count on mount
  useEffect(() => {
    bookRepository.getAll().then((books) => {
      const withBlob = books.filter(b => b.epubBlob && b.epubBlob.size > 0)
      setTransferableCount(withBlob.length)
    })
  }, [])

  const handleBack = () => {
    cancel()
    navigate(-1)
  }

  const handleDone = () => {
    navigate('/app')
  }

  const handleRetry = () => {
    reset()
  }

  // Generate QR code URL
  const qrUrl = state.peerId
    ? `${window.location.origin}/app/receive-library?peer=${getShortCode(state.peerId)}`
    : ''

  return (
    <div className="flex min-h-full flex-col bg-surface-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={handleBack}
          className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary"
          aria-label="Back"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold text-text-primary">Share Library</h1>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8">
        {(state.status === 'idle' || state.status === 'initializing') && (
          <InitializingState />
        )}

        {state.status === 'awaiting-peer' && state.peerId && (
          <WaitingState 
            peerId={state.peerId} 
            qrUrl={qrUrl} 
            bookCount={transferableCount} 
          />
        )}

        {(state.status === 'handshaking' || state.status === 'comparing') && (
          <ConnectedState />
        )}

        {state.status === 'transferring' && state.plan && (
          <TransferringState
            currentBook={state.plan.books[state.currentBookIndex]?.title ?? ''}
            currentIndex={state.currentBookIndex + 1}
            totalBooks={state.plan.books.length}
            skippedBooks={state.plan.skippedCount}
          />
        )}

        {state.status === 'complete' && state.stats && (
          <CompleteState 
            bookCount={state.stats.booksTransferred} 
            skippedCount={state.stats.booksSkipped}
            onDone={handleDone} 
          />
        )}

        {state.status === 'error' && state.error && (
          <ErrorState 
            message={state.error.message} 
            onRetry={handleRetry} 
            onBack={handleBack} 
          />
        )}

        {state.status === 'cancelled' && (
          <ErrorState 
            message="Transfer was cancelled" 
            onRetry={handleRetry} 
            onBack={handleBack} 
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// State Components
// ============================================================================

function InitializingState() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">Setting up...</h2>
      <p className="mt-2 text-text-secondary">Preparing to share your library</p>
    </div>
  )
}

function WaitingState({ peerId, qrUrl, bookCount }: { peerId: string; qrUrl: string; bookCount: number }) {
  const shortCode = getShortCode(peerId)
  
  return (
    <div className="w-full max-w-sm text-center">
      {/* Explanation card */}
      <div className="mb-6 rounded-2xl bg-surface-1 p-4 text-left">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20">
            <WifiIcon className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">Direct Device Transfer</h3>
            <p className="text-xs text-text-muted">No cloud, no account needed</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          Your books will transfer directly between devices using a secure peer-to-peer connection. 
          No data goes through any server—it's like a private WiFi handshake! 🤝
        </p>
      </div>

      {/* QR Code */}
      <div className="mb-4 inline-block rounded-2xl bg-white p-4">
        <QRCodeSVG 
          value={qrUrl} 
          size={200}
          level="M"
          includeMargin={false}
        />
      </div>

      {/* Manual code */}
      <p className="mb-2 text-sm text-text-muted">Or enter this code on your other device:</p>
      <div className="mb-6 inline-block rounded-xl bg-surface-2 px-6 py-3">
        <span className="font-mono text-2xl font-bold tracking-widest text-accent">{shortCode}</span>
      </div>

      {/* Status */}
      <div className="flex items-center justify-center gap-2 text-text-secondary">
        <LoaderIcon className="h-4 w-4" />
        <span>Waiting for your other device...</span>
      </div>

      {/* Book count */}
      <p className="mt-4 text-sm text-text-muted">
        Ready to send {bookCount} {bookCount === 1 ? 'book' : 'books'}
      </p>

      {/* Instructions */}
      <div className="mt-6 rounded-xl bg-surface-1 p-4 text-left text-sm">
        <p className="mb-2 font-medium text-text-primary">On your other device:</p>
        <ol className="list-inside list-decimal space-y-1 text-text-secondary">
          <li>Open EPUB Player</li>
          <li>Tap "Import from another device"</li>
          <li>Scan this QR code or enter the code above</li>
        </ol>
      </div>
    </div>
  )
}

function ConnectedState() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">Connected!</h2>
      <p className="mt-2 text-text-secondary">Comparing libraries...</p>
    </div>
  )
}

function TransferringState({
  currentBook,
  currentIndex,
  totalBooks,
  skippedBooks,
}: {
  currentBook: string
  currentIndex: number
  totalBooks: number
  skippedBooks: number
}) {
  const progress = totalBooks > 0 ? (currentIndex / totalBooks) * 100 : 0

  return (
    <div className="w-full max-w-sm text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <SmartphoneIcon className="h-10 w-10 text-accent" />
      </div>
      
      <h2 className="text-xl font-semibold text-text-primary">Sending Books</h2>
      
      <p className="mt-2 text-text-secondary">
        {currentIndex} of {totalBooks} new books
      </p>
      
      {skippedBooks > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          ({skippedBooks} already on device, skipped)
        </p>
      )}
      
      {/* Progress bar */}
      <div className="my-6 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      
      {currentBook && (
        <p className="text-sm text-text-muted">
          Sending: <span className="text-text-secondary">{currentBook}</span>
        </p>
      )}
    </div>
  )
}

function CompleteState({ 
  bookCount, 
  skippedCount,
  onDone 
}: { 
  bookCount: number
  skippedCount: number
  onDone: () => void 
}) {
  const hasNewBooks = bookCount > 0
  const hasSkipped = skippedCount > 0
  const allSkipped = !hasNewBooks && hasSkipped
  
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/20">
        <CheckIcon className="h-10 w-10 text-success" />
      </div>
      
      <h2 className="text-xl font-semibold text-text-primary">
        {allSkipped ? 'All Synced! ✨' : 'Transfer Complete! 🎉'}
      </h2>
      
      <p className="mt-2 text-text-secondary">
        {allSkipped
          ? 'All your books are already on the other device'
          : hasNewBooks
            ? `Successfully sent ${bookCount} new ${bookCount === 1 ? 'book' : 'books'}`
            : 'No new books to transfer'}
      </p>
      
      {hasSkipped && hasNewBooks && (
        <p className="mt-1 text-sm text-text-muted">
          {skippedCount} {skippedCount === 1 ? 'book was' : 'books were'} already there
        </p>
      )}
      
      <p className="mt-4 text-sm text-text-muted">
        {allSkipped 
          ? 'Your libraries are in sync!'
          : 'Your books are now on your other device.'}
      </p>
      
      <button
        onClick={onDone}
        className="pressable mt-8 rounded-full bg-accent px-8 py-3 font-semibold text-white"
      >
        Done
      </button>
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
  onBack,
}: {
  message: string
  onRetry: () => void
  onBack: () => void
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-error/20">
        <span className="text-4xl">😕</span>
      </div>
      
      <h2 className="text-xl font-semibold text-text-primary">Connection Failed</h2>
      
      <p className="mt-2 text-text-secondary">{message}</p>
      
      <div className="mt-8 flex flex-col gap-3">
        <button
          onClick={onRetry}
          className="pressable rounded-full bg-accent px-8 py-3 font-semibold text-white"
        >
          Try Again
        </button>
        <button
          onClick={onBack}
          className="pressable rounded-full bg-surface-2 px-8 py-3 font-semibold text-text-primary"
        >
          Go Back
        </button>
      </div>
    </div>
  )
}

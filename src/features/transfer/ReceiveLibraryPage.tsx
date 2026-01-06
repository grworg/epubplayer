/**
 * Receive Library Page (Receiver)
 * 
 * Allows entering a code or scanning QR to connect and receive books.
 * Uses the new transfer session architecture (ADR-0016).
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeftIcon, LoaderIcon, CheckIcon, SmartphoneIcon, WifiIcon } from '@/ui/icons'
import { useReceiverSession } from './useTransferSession'

export function ReceiveLibraryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { state, start, cancel, reset } = useReceiverSession()
  const [code, setCode] = useState('')
  
  // Track if we've auto-started from URL params
  const hasAutoStartedRef = useRef(false)

  // Auto-connect if peer param is in URL (from QR code)
  useEffect(() => {
    const peerParam = searchParams.get('peer')
    if (peerParam && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true
      setCode(peerParam.toUpperCase())
      start(peerParam)
    }
  }, [searchParams, start])

  const handleConnect = () => {
    if (code.length === 6) {
      start(code)
    }
  }

  const handleBack = () => {
    cancel()
    // If there's no meaningful history (e.g., came directly from QR code scan),
    // navigate to landing page instead of trying to go back
    if (window.history.length <= 2) {
      navigate('/')
    } else {
      navigate(-1)
    }
  }

  const handleDone = () => {
    navigate('/app')
  }

  const handleRetry = () => {
    reset()
    hasAutoStartedRef.current = false
    setCode('')
  }

  // Handle code input - format as uppercase
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setCode(value)
  }

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
        <h1 className="text-xl font-bold text-text-primary">Import Library</h1>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8">
        {state.status === 'idle' && (
          <InputState
            code={code}
            onCodeChange={handleCodeChange}
            onConnect={handleConnect}
          />
        )}

        {state.status === 'connecting' && <ConnectingState />}

        {(state.status === 'handshaking' || state.status === 'comparing') && (
          <ConnectedState />
        )}

        {state.status === 'transferring' && state.plan && (
          <ReceivingState
            totalBooks={state.plan.books.length}
            completedBooks={state.completedBooks}
            skippedBooks={state.plan.skippedCount}
            currentBook={state.plan.books[state.currentBookIndex]?.title}
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

function InputState({
  code,
  onCodeChange,
  onConnect,
}: {
  code: string
  onCodeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onConnect: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length === 6) {
      onConnect()
    }
  }
  
  return (
    <div className="w-full max-w-sm text-center">
      {/* Icon */}
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <SmartphoneIcon className="h-10 w-10 text-accent" />
      </div>
      
      <h2 className="text-xl font-semibold text-text-primary">Import from Another Device</h2>
      
      <p className="mt-2 text-text-secondary">
        Enter the 6-character code shown on your other device, or scan the QR code.
      </p>
      
      {/* Code input */}
      <form onSubmit={handleSubmit} className="mt-8">
        <label htmlFor="transfer-code" className="sr-only">
          6-character transfer code
        </label>
        <input
          id="transfer-code"
          ref={inputRef}
          type="text"
          value={code}
          onChange={onCodeChange}
          placeholder="ABC123"
          aria-describedby="transfer-code-hint"
          className="w-full rounded-xl bg-surface-1 px-6 py-4 text-center font-mono text-2xl font-bold tracking-widest text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          maxLength={6}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <p id="transfer-code-hint" className="sr-only">
          Enter the 6-character code displayed on your other device
        </p>
        
        <button
          type="submit"
          disabled={code.length !== 6}
          className="pressable mt-6 w-full rounded-full bg-accent px-8 py-4 font-semibold text-white disabled:opacity-50"
        >
          Connect
        </button>
      </form>
      
      {/* Explanation */}
      <div className="mt-8 rounded-2xl bg-surface-1 p-4 text-left">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20">
            <WifiIcon className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">How it works</h3>
            <p className="text-xs text-text-muted">Secure, private transfer</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          On your other device, open EPUB Player and tap the phone icon or go to Settings → Share Library. 
          Then scan the QR code or enter the code here.
        </p>
        <p className="mt-3 text-sm text-text-secondary">
          Your books transfer directly between devices—no data goes through any server. 
          It's like Bluetooth but over WiFi! 📱↔️💻
        </p>
      </div>
    </div>
  )
}

function ConnectingState() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">Connecting...</h2>
      <p className="mt-2 text-text-secondary">Looking for your other device</p>
    </div>
  )
}

function ConnectedState() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/20">
        <CheckIcon className="h-10 w-10 text-success" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">Connected!</h2>
      <p className="mt-2 text-text-secondary">Comparing libraries...</p>
    </div>
  )
}

function ReceivingState({
  totalBooks,
  completedBooks,
  skippedBooks,
  currentBook,
}: {
  totalBooks: number
  completedBooks: number
  skippedBooks: number
  currentBook?: string
}) {
  const progress = totalBooks > 0 ? (completedBooks / totalBooks) * 100 : 0
  
  return (
    <div className="w-full max-w-sm text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>
      
      <h2 className="text-xl font-semibold text-text-primary">Receiving Books</h2>
      
      <p className="mt-2 text-text-secondary">
        {completedBooks} of {totalBooks} new books
      </p>
      
      {skippedBooks > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          ({skippedBooks} already here, skipped)
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
          Receiving: <span className="text-text-secondary">{currentBook}</span>
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
        {allSkipped ? 'All Synced! ✨' : 'All Done! 🎉'}
      </h2>
      
      <p className="mt-2 text-text-secondary">
        {allSkipped
          ? 'All books from the other device are already here'
          : hasNewBooks
            ? `Received ${bookCount} new ${bookCount === 1 ? 'book' : 'books'}`
            : 'No new books to receive'}
      </p>
      
      {hasSkipped && hasNewBooks && (
        <p className="mt-1 text-sm text-text-muted">
          {skippedCount} {skippedCount === 1 ? 'book was' : 'books were'} already here
        </p>
      )}
      
      <p className="mt-4 text-sm text-text-muted">
        {allSkipped 
          ? 'Your libraries are in sync!'
          : 'Your library is ready. Happy listening!'}
      </p>
      
      <button
        onClick={onDone}
        className="pressable mt-8 rounded-full bg-accent px-8 py-3 font-semibold text-white"
      >
        Go to Library
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
      
      <div className="mt-6 rounded-xl bg-surface-1 p-4 text-left text-sm">
        <p className="font-medium text-text-primary">Troubleshooting:</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-text-secondary">
          <li>Make sure the Share Library page is open on your other device</li>
          <li>Check that the code matches exactly</li>
          <li>Both devices need an internet connection</li>
        </ul>
      </div>
      
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

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { DataConnection } from 'peerjs'
import type Peer from 'peerjs'
import {
  connectToPeer,
  sendMessage,
  type PeerServiceState,
  type TransferMessage,
} from '@/services/p2p'
import { parseEPUB } from '@/services/epub'
import { bookRepository, sectionRepository, playbackRepository } from '@/services/storage'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { hashBlob } from '@/services/storage/db'
import { ChevronLeftIcon, LoaderIcon, CheckIcon, SmartphoneIcon, WifiIcon } from '@/ui/icons'

type ReceiveState =
  | { phase: 'input' }
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'receiving'; totalBooks: number; completedBooks: number; skippedBooks: number; currentBook?: string }
  | { phase: 'complete'; bookCount: number; skippedCount: number }
  | { phase: 'error'; message: string }

export function ReceiveLibraryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [state, setState] = useState<ReceiveState>({ phase: 'input' })
  const [code, setCode] = useState('')
  const peerRef = useRef<Peer | null>(null)
  const connectionRef = useRef<DataConnection | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  // Track incoming book data
  const pendingBookRef = useRef<{
    id: string
    title: string
    author: string
    size: number
    contentHash: string
  } | null>(null)
  const completedCountRef = useRef(0)
  const totalBooksRef = useRef(0)
  const skippedBooksRef = useRef(0)

  // Track if we've initiated connection to prevent double-connect (for QR code auto-connect)
  const hasInitiatedConnectionRef = useRef(false)

  const handleMessage = useCallback(async (message: TransferMessage) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
    const log = (msg: string, data?: unknown) => {
      if (data !== undefined) {
        console.log(`[${timestamp}] [Transfer:Receiver] ${msg}`, data)
      } else {
        console.log(`[${timestamp}] [Transfer:Receiver] ${msg}`)
      }
    }
    
    switch (message.type) {
      case 'book-count':
        log(`Expecting ${message.count} new books from sender (${message.skipped} already on this device)`)
        totalBooksRef.current = message.count
        skippedBooksRef.current = message.skipped
        completedCountRef.current = 0
        setState({
          phase: 'receiving',
          totalBooks: message.count,
          completedBooks: 0,
          skippedBooks: message.skipped,
        })
        break
        
      case 'book-start':
        log(`Starting to receive: "${message.title}" by ${message.author} (${(message.size / 1024).toFixed(1)} KB, hash: ${message.contentHash})`)
        pendingBookRef.current = {
          id: message.id,
          title: message.title,
          author: message.author,
          size: message.size,
          contentHash: message.contentHash,
        }
        setState((prev) =>
          prev.phase === 'receiving'
            ? { ...prev, currentBook: message.title }
            : prev
        )
        break
        
      case 'book-data':
        if (pendingBookRef.current) {
          const book = pendingBookRef.current
          log(`Received EPUB data for "${book.title}" (${(message.data.byteLength / 1024).toFixed(1)} KB)`)
          
          try {
            // Convert ArrayBuffer to Blob/File
            log(`Converting to File object...`)
            const blob = new Blob([message.data], { type: 'application/epub+zip' })
            const file = new File([blob], `${book.title}.epub`, {
              type: 'application/epub+zip',
            })
            
            // Verify content hash
            const computedHash = await hashBlob(file)
            if (computedHash !== book.contentHash) {
              console.warn(`[Transfer:Receiver] Hash mismatch for "${book.title}": expected ${book.contentHash}, got ${computedHash}`)
            }
            
            // Parse and save the EPUB using existing import logic
            log(`Parsing EPUB...`)
            const { book: parsedBook, sections } = await parseEPUB(file)
            log(`Parsed: "${parsedBook.title}" with ${sections.length} sections`)
            
            // Check if book already exists (by ID or hash)
            const existsById = await bookRepository.exists(parsedBook.id)
            const existsByHash = await bookRepository.existsByContentHash(book.contentHash)
            
            if (!existsById && !existsByHash) {
              log(`Saving book to IndexedDB...`)
              await bookRepository.add({
                ...parsedBook,
                epubBlob: file,
                contentHash: book.contentHash,
              })
              if (sections.length > 0) {
                await sectionRepository.addBulk(sections)
              }
              
              // Initialize playback state
              const voiceId = await settingsRepository.get('voiceId')
              const modelConfig = await settingsRepository.get('modelConfig')
              await playbackRepository.initialize(parsedBook.id, voiceId, modelConfig)
              
              log(`✓ Successfully imported: "${parsedBook.title}"`)
            } else {
              log(`⚠ Book already exists in library: "${parsedBook.title}" - skipping`)
            }
          } catch (err) {
            console.error(`[Transfer:Receiver] ✗ Failed to import "${book.title}":`, err)
          }
        } else {
          console.warn('[Transfer:Receiver] Received book-data without pending book metadata!')
        }
        break
        
      case 'book-complete':
        completedCountRef.current++
        log(`✓ Book ${completedCountRef.current}/${totalBooksRef.current} complete`)
        pendingBookRef.current = null
        setState((prev) =>
          prev.phase === 'receiving'
            ? {
                ...prev,
                completedBooks: completedCountRef.current,
                currentBook: undefined,
              }
            : prev
        )
        break
        
      case 'all-complete':
        log(`✓ Transfer complete! Received ${completedCountRef.current} new books (${skippedBooksRef.current} were already here)`)
        setState({
          phase: 'complete',
          bookCount: completedCountRef.current,
          skippedCount: skippedBooksRef.current,
        })
        break
        
      case 'error':
        console.error('[Transfer:Receiver] Error from sender:', message.message)
        setState({ phase: 'error', message: message.message })
        break
    }
  }, [])

  const handleConnect = useCallback(async (targetCode?: string) => {
    const codeToUse = targetCode || code
    if (!codeToUse.trim()) return
    
    console.log(`[Transfer:Receiver] User initiated connection with code: ${codeToUse}`)
    setState({ phase: 'connecting' })
    
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    
    const handleStateChange = (peerState: PeerServiceState) => {
      console.log(`[Transfer:Receiver] Connection state changed: ${peerState.status}`, peerState.error ? `(${peerState.error})` : '')
      if (peerState.status === 'connected') {
        console.log('[Transfer:Receiver] ✓ Connected to sender')
        setState({ phase: 'connected' })
      } else if (peerState.status === 'error') {
        console.error('[Transfer:Receiver] ✗ Connection failed:', peerState.error)
        setState({ phase: 'error', message: peerState.error || 'Connection failed' })
      }
    }
    
    const result = await connectToPeer(
      codeToUse,
      handleStateChange,
      handleMessage,
      abortController.signal
    )
    
    if (result) {
      console.log('[Transfer:Receiver] Connection established, peer and connection refs set')
      peerRef.current = result.peer
      connectionRef.current = result.connection
      
      // Send our book hashes for deduplication
      console.log('[Transfer:Receiver] Fetching local book hashes for deduplication...')
      const myHashes = await bookRepository.getAllContentHashes()
      console.log(`[Transfer:Receiver] Sending ${myHashes.length} book hashes to sender`)
      sendMessage(result.connection, { type: 'my-books', hashes: myHashes })
      console.log('[Transfer:Receiver] Waiting for books...')
    } else {
      console.log('[Transfer:Receiver] Connection attempt returned null (aborted or failed)')
    }
  }, [code, handleMessage])

  // Check for peer ID in URL params (from QR code) and auto-connect
  useEffect(() => {
    const peerParam = searchParams.get('peer')
    if (peerParam && !hasInitiatedConnectionRef.current) {
      hasInitiatedConnectionRef.current = true
      setCode(peerParam)
      // Auto-connect when coming from QR code
      handleConnect(peerParam)
    }
    
    // Cleanup: if component unmounts during connection, abort it
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [searchParams, handleConnect])

  const handleBack = () => {
    abortControllerRef.current?.abort()
    peerRef.current?.destroy()
    navigate(-1)
  }

  const handleDone = () => {
    peerRef.current?.destroy()
    navigate('/app')
  }

  const handleRetry = () => {
    peerRef.current?.destroy()
    setState({ phase: 'input' })
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
        {state.phase === 'input' && (
          <InputState
            code={code}
            onCodeChange={handleCodeChange}
            onConnect={() => handleConnect()}
          />
        )}
        
        {state.phase === 'connecting' && <ConnectingState />}
        
        {state.phase === 'connected' && <ConnectedState />}
        
        {state.phase === 'receiving' && (
          <ReceivingState
            totalBooks={state.totalBooks}
            completedBooks={state.completedBooks}
            skippedBooks={state.skippedBooks}
            currentBook={state.currentBook}
          />
        )}
        
        {state.phase === 'complete' && (
          <CompleteState 
            bookCount={state.bookCount} 
            skippedCount={state.skippedCount}
            onDone={handleDone} 
          />
        )}
        
        {state.phase === 'error' && (
          <ErrorState message={state.message} onRetry={handleRetry} onBack={handleBack} />
        )}
      </div>
    </div>
  )
}

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
      <p className="mt-2 text-text-secondary">Waiting for books...</p>
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


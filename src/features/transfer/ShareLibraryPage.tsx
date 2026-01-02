import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import type Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import {
  createPeerAndWait,
  sendMessage,
  sendBlob,
  getShortCode,
  type PeerServiceState,
  type TransferMessage,
} from '@/services/p2p'
import { bookRepository } from '@/services/storage'
import { db, type Book, hashBlob } from '@/services/storage/db'
import { ChevronLeftIcon, LoaderIcon, CheckIcon, SmartphoneIcon, WifiIcon } from '@/ui/icons'

type TransferState =
  | { phase: 'initializing' }
  | { phase: 'waiting'; peerId: string }
  | { phase: 'connected' }
  | { phase: 'comparing' } // New: comparing libraries
  | { phase: 'transferring'; currentBook: string; currentIndex: number; totalBooks: number; skippedBooks: number; progress: number }
  | { phase: 'complete'; bookCount: number; skippedCount: number }
  | { phase: 'error'; message: string }

export function ShareLibraryPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<TransferState>({ phase: 'initializing' })
  const [_books, setBooks] = useState<Book[]>([])
  const [transferableCount, setTransferableCount] = useState(0)
  const peerRef = useRef<Peer | null>(null)
  const connectionRef = useRef<DataConnection | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const receiverHashesRef = useRef<Set<string> | null>(null)

  // Load books on mount and check which ones can be transferred
  useEffect(() => {
    bookRepository.getAll().then((allBooks) => {
      setBooks(allBooks)
      const withBlob = allBooks.filter(b => b.epubBlob && b.epubBlob.size > 0)
      setTransferableCount(withBlob.length)
      console.log(`[Transfer:Sender] ${withBlob.length}/${allBooks.length} books have EPUB data`)
    })
  }, [])

  // Initialize peer connection
  useEffect(() => {
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const handleStateChange = (peerState: PeerServiceState) => {
      if (peerState.status === 'waiting' && peerState.peerId) {
        setState({ phase: 'waiting', peerId: peerState.peerId })
      } else if (peerState.status === 'connected') {
        setState({ phase: 'connected' })
      } else if (peerState.status === 'error') {
        setState({ phase: 'error', message: peerState.error || 'Connection failed' })
      }
    }

    const handleMessage = (message: TransferMessage) => {
      // Handle receiver's book hashes for deduplication
      if (message.type === 'my-books') {
        console.log(`[Transfer:Sender] Received ${message.hashes.length} hashes from receiver`)
        receiverHashesRef.current = new Set(message.hashes)
      }
    }

    createPeerAndWait(handleStateChange, handleMessage, abortController.signal).then(
      async (result) => {
        if (result) {
          peerRef.current = result.peer
          connectionRef.current = result.connection
          // Start transfer when connected
          await startTransfer(result.connection)
        }
      }
    )

    return () => {
      abortController.abort()
      peerRef.current?.destroy()
    }
  }, [])

  const startTransfer = useCallback(
    async (connection: DataConnection) => {
      console.log('[Transfer:Sender] Starting transfer process...')
      setState({ phase: 'comparing' })
      
      // Wait for receiver to send their book hashes (with timeout)
      console.log('[Transfer:Sender] Waiting for receiver to send their book hashes...')
      const startWait = Date.now()
      while (!receiverHashesRef.current && Date.now() - startWait < 10000) {
        await new Promise(r => setTimeout(r, 100))
      }
      
      const receiverHashes = receiverHashesRef.current || new Set<string>()
      console.log(`[Transfer:Sender] Receiver has ${receiverHashes.size} books`)
      
      // Get all books and compute their hashes
      const allBooks = await db.books.toArray()
      const booksWithData: Array<{ book: Book; hash: string }> = []
      
      for (const book of allBooks) {
        if (book.epubBlob && book.epubBlob.size > 0) {
          // Use existing contentHash or compute it
          const hash = book.contentHash || await hashBlob(book.epubBlob)
          booksWithData.push({ book, hash })
        }
      }
      
      // Filter out books that receiver already has
      const newBooks = booksWithData.filter(({ hash }) => !receiverHashes.has(hash))
      const skippedBooks = booksWithData.filter(({ hash }) => receiverHashes.has(hash))
      
      console.log(`[Transfer:Sender] ${newBooks.length} new books to transfer, ${skippedBooks.length} already on receiver`)
      if (skippedBooks.length > 0) {
        console.log('[Transfer:Sender] Skipping (already on receiver):')
        skippedBooks.forEach(({ book }) => console.log(`  - "${book.title}"`))
      }
      
      // Send book count (including skipped info)
      sendMessage(connection, { 
        type: 'book-count', 
        count: newBooks.length,
        skipped: skippedBooks.length 
      })
      
      if (newBooks.length === 0) {
        console.log('[Transfer:Sender] No new books to transfer')
        sendMessage(connection, { type: 'all-complete' })
        setState({ phase: 'complete', bookCount: 0, skippedCount: skippedBooks.length })
        return
      }

      // Transfer each new book
      let successCount = 0
      for (let i = 0; i < newBooks.length; i++) {
        const { book, hash } = newBooks[i]
        const epubBlob = book.epubBlob!
        
        console.log(`[Transfer:Sender] Starting book ${i + 1}/${newBooks.length}: "${book.title}"`)
        
        setState({
          phase: 'transferring',
          currentBook: book.title,
          currentIndex: i + 1,
          totalBooks: newBooks.length,
          skippedBooks: skippedBooks.length,
          progress: 0,
        })

        // Send book metadata with content hash
        const sizeKB = (epubBlob.size / 1024).toFixed(1)
        console.log(`[Transfer:Sender] Sending metadata for "${book.title}" (${sizeKB} KB, hash: ${hash})`)
        
        sendMessage(connection, {
          type: 'book-start',
          id: book.id,
          title: book.title,
          author: book.author,
          size: epubBlob.size,
          contentHash: hash,
        })

        // Send the EPUB blob
        console.log(`[Transfer:Sender] Sending EPUB data for "${book.title}"...`)
        await sendBlob(connection, epubBlob)
        console.log(`[Transfer:Sender] ✓ EPUB data sent for "${book.title}"`)

        // Signal book complete
        sendMessage(connection, { type: 'book-complete', id: book.id })
        successCount++

        setState({
          phase: 'transferring',
          currentBook: book.title,
          currentIndex: i + 1,
          totalBooks: newBooks.length,
          skippedBooks: skippedBooks.length,
          progress: 100,
        })

        // Small delay between books
        await new Promise((r) => setTimeout(r, 100))
      }

      // All done
      console.log(`[Transfer:Sender] ✓ ${successCount} books transferred, ${skippedBooks.length} skipped (already on device)`)
      sendMessage(connection, { type: 'all-complete' })
      setState({ phase: 'complete', bookCount: successCount, skippedCount: skippedBooks.length })
    },
    []
  )

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
    setState({ phase: 'initializing' })
    // Re-trigger the effect by remounting (navigate away and back)
    navigate('/app')
    setTimeout(() => navigate('/app/share-library'), 0)
  }

  // Generate the QR code URL
  const qrUrl = state.phase === 'waiting' 
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
        {state.phase === 'initializing' && <InitializingState />}
        
        {state.phase === 'waiting' && (
          <WaitingState 
            peerId={state.peerId} 
            qrUrl={qrUrl} 
            bookCount={transferableCount} 
          />
        )}
        
        {state.phase === 'connected' && <ConnectedState />}
        
        {state.phase === 'comparing' && <ComparingState />}
        
        {state.phase === 'transferring' && (
          <TransferringState
            currentBook={state.currentBook}
            currentIndex={state.currentIndex}
            totalBooks={state.totalBooks}
            skippedBooks={state.skippedBooks}
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
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/20">
        <CheckIcon className="h-10 w-10 text-success" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">Connected!</h2>
      <p className="mt-2 text-text-secondary">Starting transfer...</p>
    </div>
  )
}

function ComparingState() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">Comparing Libraries</h2>
      <p className="mt-2 text-text-secondary">Checking which books need to be transferred...</p>
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
  const progress = (currentIndex / totalBooks) * 100

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
      
      <p className="text-sm text-text-muted">
        Sending: <span className="text-text-secondary">{currentBook}</span>
      </p>
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


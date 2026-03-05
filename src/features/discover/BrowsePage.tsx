/**
 * Browse Page
 *
 * Public library browser powered by the Gutendex API (Project Gutenberg).
 * Users can search, browse popular books, and filter by topic.
 * Tapping a book opens a detail sheet for adding it to their library.
 */

import { useState, useCallback, useRef } from 'react'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { SearchIcon, LoaderIcon, AlertCircleIcon, CompassIcon } from '@/ui/icons'
import { useGutendex } from './useGutendex'
import { GutenbergBookSheet } from './GutenbergBookSheet'
import {
  getCoverUrl,
  formatAuthors,
  formatDownloadCount,
  type GutenbergBook,
} from '@/services/gutendex'

// ============================================================================
// Topic Chips
// ============================================================================

const TOPICS = [
  'Fiction',
  'Science Fiction',
  'Adventure',
  'Mystery',
  'Romance',
  'History',
  'Philosophy',
  'Science',
  'Poetry',
  'Children',
]

// ============================================================================
// Browse Page
// ============================================================================

export function BrowsePage() {
  const gutendex = useGutendex()
  const [searchInput, setSearchInput] = useState('')
  const [selectedBook, setSelectedBook] = useState<GutenbergBook | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value)
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        gutendex.search(value)
      }, 400)
    },
    [gutendex.search],
  )

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      clearTimeout(debounceRef.current)
      gutendex.search(searchInput)
    },
    [searchInput, gutendex.search],
  )

  const handleTopicClick = useCallback(
    (topic: string) => {
      setSearchInput('')
      if (gutendex.topic === topic) {
        gutendex.loadPopular()
      } else {
        gutendex.browseByTopic(topic)
      }
    },
    [gutendex.topic, gutendex.browseByTopic, gutendex.loadPopular],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header + Search */}
      <header className="space-y-3 px-5 pt-4 pb-2">
        <h1 className="text-2xl font-bold text-text-primary">
          <Trans>Browse</Trans>
        </h1>
        <form onSubmit={handleSearchSubmit}>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t`Search books, authors...`}
              className="w-full rounded-xl bg-surface-1 py-3 pl-10 pr-4 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </form>

        {/* Topic chips */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {TOPICS.map((topic) => (
            <button
              key={topic}
              onClick={() => handleTopicClick(topic)}
              className={`pressable flex-shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                gutendex.topic === topic
                  ? 'bg-accent text-white'
                  : 'bg-surface-1 text-text-secondary hover:bg-surface-2'
              }`}
            >
              {topic}
            </button>
          ))}
        </div>
      </header>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {/* Status line */}
        {!gutendex.isLoading && gutendex.books.length > 0 && (
          <p className="mb-3 text-sm text-text-muted">
            {gutendex.mode === 'search' ? (
              <Trans>{gutendex.totalCount} results for &ldquo;{gutendex.query}&rdquo;</Trans>
            ) : gutendex.mode === 'topic' ? (
              <Trans>{gutendex.totalCount} books in {gutendex.topic}</Trans>
            ) : (
              <Trans>Popular on Project Gutenberg</Trans>
            )}
          </p>
        )}

        {/* Loading initial */}
        {gutendex.isLoading && (
          <div className="flex h-64 items-center justify-center">
            <LoaderIcon className="h-8 w-8 text-accent" />
          </div>
        )}

        {/* Error */}
        {gutendex.error && !gutendex.isLoading && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
              <AlertCircleIcon className="h-8 w-8 text-text-muted" />
            </div>
            <p className="text-text-secondary">{gutendex.error}</p>
            <button
              onClick={gutendex.loadPopular}
              className="pressable rounded-full bg-surface-1 px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-2"
            >
              <Trans>Try again</Trans>
            </button>
          </div>
        )}

        {/* Empty search results */}
        {!gutendex.isLoading && !gutendex.error && gutendex.books.length === 0 && gutendex.mode === 'search' && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
              <SearchIcon className="h-8 w-8 text-text-muted" />
            </div>
            <p className="text-text-secondary">
              <Trans>No books found for &ldquo;{gutendex.query}&rdquo;</Trans>
            </p>
          </div>
        )}

        {/* Book grid */}
        {!gutendex.isLoading && gutendex.books.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {gutendex.books.map((book) => (
                <GutenbergBookCard
                  key={book.id}
                  book={book}
                  onClick={() => setSelectedBook(book)}
                />
              ))}
            </div>

            {/* Load more */}
            {gutendex.hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={gutendex.loadMore}
                  disabled={gutendex.isLoadingMore}
                  className="pressable flex items-center gap-2 rounded-full bg-surface-1 px-6 py-3 font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
                >
                  {gutendex.isLoadingMore ? (
                    <LoaderIcon className="h-5 w-5 text-accent" />
                  ) : null}
                  <Trans>Load more</Trans>
                </button>
              </div>
            )}
          </>
        )}

        {/* Initial empty state (shouldn't happen but just in case) */}
        {!gutendex.isLoading && !gutendex.error && gutendex.books.length === 0 && gutendex.mode === 'popular' && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
              <CompassIcon className="h-8 w-8 text-text-muted" />
            </div>
            <p className="text-text-secondary">
              <Trans>Discover free ebooks from Project Gutenberg</Trans>
            </p>
          </div>
        )}
      </div>

      {/* Book detail sheet */}
      {selectedBook && (
        <GutenbergBookSheet
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Book Card
// ============================================================================

function GutenbergBookCard({
  book,
  onClick,
}: {
  book: GutenbergBook
  onClick: () => void
}) {
  const coverUrl = getCoverUrl(book)
  const authors = formatAuthors(book.authors)
  const downloads = formatDownloadCount(book.download_count)

  return (
    <button
      onClick={onClick}
      className="pressable group flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-surface-1 p-3 text-left transition-colors hover:bg-surface-2 md:flex-col md:items-stretch md:p-4"
    >
      {/* Cover */}
      <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-surface-3 md:h-48 md:w-full">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-3 to-surface-4">
            <span className="text-2xl opacity-50 md:text-4xl">📖</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1 md:mt-3">
        <h3 className="mb-1 line-clamp-2 text-base font-semibold text-text-primary">
          {book.title}
        </h3>
        <p className="truncate text-sm text-text-secondary">{authors}</p>
        <p className="mt-1 text-xs text-text-muted">
          {downloads} <Trans>downloads</Trans>
        </p>
      </div>
    </button>
  )
}

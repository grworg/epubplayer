/**
 * Gutendex React Hook
 *
 * Wraps the Gutendex API client with React state management.
 * Handles loading, error, and pagination states.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  searchBooks,
  getPopularBooks,
  getBooksByTopic,
  type GutenbergBook,
  type GutenbergSearchResult,
} from '@/services/gutendex'

type BrowseMode = 'popular' | 'search' | 'topic'

interface GutendexState {
  books: GutenbergBook[]
  totalCount: number
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  hasMore: boolean
  mode: BrowseMode
  query: string
  topic: string
}

const initialState: GutendexState = {
  books: [],
  totalCount: 0,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  mode: 'popular',
  query: '',
  topic: '',
}

export function useGutendex() {
  const [state, setState] = useState<GutendexState>(initialState)
  const pageRef = useRef(1)
  const abortRef = useRef<AbortController | null>(null)

  const handleResult = useCallback((result: GutenbergSearchResult, append: boolean) => {
    setState((prev) => ({
      ...prev,
      books: append ? [...prev.books, ...result.results] : result.results,
      totalCount: result.count,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: result.next !== null,
    }))
  }, [])

  const handleError = useCallback((err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') return
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isLoadingMore: false,
      error: err instanceof Error ? err.message : 'Failed to load books',
    }))
  }, [])

  const loadPopular = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    pageRef.current = 1

    setState((prev) => ({
      ...prev,
      mode: 'popular',
      query: '',
      topic: '',
      isLoading: true,
      error: null,
    }))

    try {
      const result = await getPopularBooks(1)
      handleResult(result, false)
    } catch (err) {
      handleError(err)
    }
  }, [handleResult, handleError])

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      loadPopular()
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    pageRef.current = 1

    setState((prev) => ({
      ...prev,
      mode: 'search',
      query,
      topic: '',
      isLoading: true,
      error: null,
    }))

    try {
      const result = await searchBooks(query, { languages: 'en' })
      handleResult(result, false)
    } catch (err) {
      handleError(err)
    }
  }, [loadPopular, handleResult, handleError])

  const browseByTopic = useCallback(async (topic: string) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    pageRef.current = 1

    setState((prev) => ({
      ...prev,
      mode: 'topic',
      query: '',
      topic,
      isLoading: true,
      error: null,
    }))

    try {
      const result = await getBooksByTopic(topic)
      handleResult(result, false)
    } catch (err) {
      handleError(err)
    }
  }, [handleResult, handleError])

  const loadMore = useCallback(async () => {
    if (state.isLoadingMore || !state.hasMore) return

    pageRef.current += 1
    const page = pageRef.current

    setState((prev) => ({ ...prev, isLoadingMore: true }))

    try {
      let result: GutenbergSearchResult
      if (state.mode === 'search') {
        result = await searchBooks(state.query, { languages: 'en', page })
      } else if (state.mode === 'topic') {
        result = await getBooksByTopic(state.topic, page)
      } else {
        result = await getPopularBooks(page)
      }
      handleResult(result, true)
    } catch (err) {
      handleError(err)
    }
  }, [state.isLoadingMore, state.hasMore, state.mode, state.query, state.topic, handleResult, handleError])

  // Load popular books on mount
  useEffect(() => {
    loadPopular()
    return () => abortRef.current?.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...state,
    search,
    browseByTopic,
    loadMore,
    loadPopular,
  }
}

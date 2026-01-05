import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlaybackStatus } from './PlaybackStateMachine'

export interface Book {
  id: string
  title: string
  author: string
  coverUrl?: string
}

export interface PlaybackPosition {
  sectionIndex: number
  chunkIndex: number
  timeInChunk: number
}

interface PlayerState {
  // Current playback state (synced from state machine)
  currentBook: Book | null
  status: PlaybackStatus
  position: PlaybackPosition
  speed: number
  volume: number
  error: string | null

  // Buffering progress
  bufferProgress: number

  // Current section info (for display)
  currentSectionTitle: string

  // Derived state (for convenience)
  isPlaying: boolean
  isBuffering: boolean
  isPaused: boolean

  // Actions
  setCurrentBook: (book: Book | null) => void
  setPlaybackStatus: (status: PlaybackStatus) => void
  setPosition: (position: Partial<PlaybackPosition>) => void
  setSpeed: (speed: number) => void
  setVolume: (volume: number) => void
  setBufferProgress: (progress: number) => void
  setCurrentSectionTitle: (title: string) => void
  setError: (error: string | null) => void
  
  // Legacy actions (for backward compatibility during migration)
  play: () => void
  pause: () => void
  togglePlayback: () => void
  setBuffering: (isBuffering: boolean, progress?: number) => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      currentBook: null,
      status: 'idle' as PlaybackStatus,
      position: { sectionIndex: 0, chunkIndex: 0, timeInChunk: 0 },
      speed: 1.0,
      volume: 1.0,
      error: null,
      bufferProgress: 0,
      currentSectionTitle: '',
      
      // Derived state
      isPlaying: false,
      isBuffering: false,
      isPaused: false,

      setCurrentBook: (book) =>
        set({
          currentBook: book,
          position: { sectionIndex: 0, chunkIndex: 0, timeInChunk: 0 },
          status: book ? 'loading' : 'idle',
          isPlaying: false,
          isBuffering: false,
          isPaused: false,
          currentSectionTitle: '',
          error: null,
          bufferProgress: 0,
        }),

      setPlaybackStatus: (status) =>
        set({
          status,
          isPlaying: status === 'playing',
          isBuffering: status === 'buffering',
          isPaused: status === 'paused',
        }),

      setPosition: (position) =>
        set((state) => ({
          position: { ...state.position, ...position },
        })),

      setSpeed: (speed) => set({ speed }),
      setVolume: (volume) => set({ volume }),
      setBufferProgress: (progress) => set({ bufferProgress: progress }),
      setCurrentSectionTitle: (title) => set({ currentSectionTitle: title }),
      setError: (error) => set({ error }),

      // Legacy actions (will be removed after migration)
      play: () => set({ status: 'playing', isPlaying: true, isPaused: false }),
      pause: () => set({ status: 'paused', isPlaying: false, isPaused: true }),
      togglePlayback: () =>
        set((state) => {
          const newPlaying = !state.isPlaying
          return {
            status: newPlaying ? 'playing' : 'paused',
            isPlaying: newPlaying,
            isPaused: !newPlaying,
          }
        }),
      setBuffering: (isBuffering, progress = 0) =>
        set({
          status: isBuffering ? 'buffering' : 'playing',
          isBuffering,
          bufferProgress: progress,
        }),
    }),
    {
      name: 'epub-player-state',
      partialize: (state) => ({
        // Don't persist coverUrl - blob URLs are session-specific and won't work after refresh
        // The cover will be reloaded from IndexedDB on rehydration
        currentBook: state.currentBook ? {
          id: state.currentBook.id,
          title: state.currentBook.title,
          author: state.currentBook.author,
          // coverUrl intentionally omitted
        } : null,
        position: state.position,
        speed: state.speed,
        volume: state.volume,
      }),
    }
  )
)

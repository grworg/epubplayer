/**
 * Lyrics View Component
 * 
 * Shows the current chunk text with word-by-word highlighting
 * like Spotify's lyrics feature.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { playbackController } from './PlaybackController'
import { BrowserTTSBackend } from './audioBackends/BrowserTTSBackend'

interface LyricsViewProps {
  chunkText: string
}

export function LyricsView({ chunkText }: LyricsViewProps) {
  const [charIndex, setCharIndex] = useState(0)
  const [charLength, setCharLength] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeWordRef = useRef<HTMLSpanElement>(null)

  // Split text into words while preserving whitespace
  const words = useMemo(() => {
    const result: { text: string; start: number; end: number; isWord: boolean }[] = []
    let currentIndex = 0
    
    // Match words and whitespace/punctuation separately
    const regex = /(\S+|\s+)/g
    let match
    
    while ((match = regex.exec(chunkText)) !== null) {
      const text = match[0]
      const isWord = /\S/.test(text)
      result.push({
        text,
        start: currentIndex,
        end: currentIndex + text.length,
        isWord,
      })
      currentIndex += text.length
    }
    
    return result
  }, [chunkText])

  // Subscribe to boundary events from browser TTS
  useEffect(() => {
    const backend = playbackController.getAudioBackend()
    
    if (backend instanceof BrowserTTSBackend) {
      backend.setBoundaryCallback((index, length) => {
        setCharIndex(index)
        setCharLength(length)
      })
      
      return () => {
        backend.setBoundaryCallback(undefined)
      }
    }
  }, [])

  // Scroll active word into view
  useEffect(() => {
    if (activeWordRef.current && containerRef.current) {
      const container = containerRef.current
      const word = activeWordRef.current
      
      const containerRect = container.getBoundingClientRect()
      const wordRect = word.getBoundingClientRect()
      
      // Check if word is out of view
      const isAbove = wordRect.top < containerRect.top + 50
      const isBelow = wordRect.bottom > containerRect.bottom - 50
      
      if (isAbove || isBelow) {
        word.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    }
  }, [charIndex])

  // Note: we intentionally reset highlight state by remounting this component
  // when the chunk changes (see key usage in NowPlayingPage). This avoids
  // setState-in-effect cascades and keeps the logic simple.

  // Find which word is currently being spoken
  const activeWordIndex = useMemo(() => {
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (word.isWord && charIndex >= word.start && charIndex < word.end) {
        return i
      }
    }
    // If no exact match, find the next word after current position
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (word.isWord && word.start >= charIndex) {
        return i
      }
    }
    return -1
  }, [words, charIndex])

  return (
    <div 
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-8 lg:px-12 lg:py-16"
    >
      <div className="max-w-lg text-center lg:max-w-2xl">
        <p className="text-2xl font-medium leading-relaxed tracking-wide lg:text-3xl lg:leading-loose">
          {words.map((word, index) => {
            const isPast = word.end <= charIndex
            const isActive = index === activeWordIndex
            const isFuture = word.start > charIndex + charLength

            return (
              <span
                key={`${index}-${word.start}`}
                ref={isActive ? activeWordRef : undefined}
                className={`transition-all duration-200 ${
                  isActive
                    ? 'text-accent scale-105 inline-block'
                    : isPast
                      ? 'text-text-primary'
                      : isFuture
                        ? 'text-text-muted/50'
                        : 'text-text-secondary'
                }`}
              >
                {word.text}
              </span>
            )
          })}
        </p>
      </div>
      
      {/* Subtle gradient overlays for scroll indication */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-16 bg-gradient-to-b from-surface-1 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface-0 to-transparent" />
    </div>
  )
}


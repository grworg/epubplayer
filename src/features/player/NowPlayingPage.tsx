import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, t } from '@lingui/macro'
import { usePlayerStore } from './playerStore'
import { playbackController } from './PlaybackController'
import { useSleepTimer } from './useSleepTimer'
import { SleepTimerSheet } from '@/ui/components/SleepTimerSheet'
import { BookmarkSheet } from '@/ui/components/BookmarkSheet'
import { SpeedSheet } from '@/ui/components/SpeedSheet'
import { LyricsView } from './LyricsView'
import { ttsManager } from '@/services/tts'
import { useAnnounce } from '@/ui/accessibility'
import {
  ChevronLeftIcon,
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  RewindIcon,
  FastForwardIcon,
  SpeedIcon,
  MoonIcon,
  ListIcon,
  BookmarkIcon,
  TextIcon,
  SettingsIcon,
} from '@/ui/icons'

export function NowPlayingPage() {
  const navigate = useNavigate()
  const currentBook = usePlayerStore((s) => s.currentBook)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const speed = usePlayerStore((s) => s.speed)
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const position = usePlayerStore((s) => s.position)
  const currentSectionTitle = usePlayerStore((s) => s.currentSectionTitle)
  const bufferProgress = usePlayerStore((s) => s.bufferProgress)

  const { remainingMinutes, isActive: sleepTimerActive } = useSleepTimer()
  const [showSleepTimer, setShowSleepTimer] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showChapters, setShowChapters] = useState(false)
  const [showSpeed, setShowSpeed] = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)
  const [isSlowMode, setIsSlowMode] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  const progressBarRef = useRef<HTMLDivElement>(null)
  
  // Get sections for chapter list
  const sections = playbackController.getSections()

  // Derive chunk info/text directly from the controller.
  // Avoids duplicated React state (and setState-in-effect lint errors).
  const chunkInfo = playbackController.getChunkInfo()
  const chunkText = playbackController.getCurrentChunkText()

  // Check if using slow WASM mode
  useEffect(() => {
    const checkSpeed = () => {
      if (ttsManager.getIsReady()) {
        setIsSlowMode(ttsManager.isSlowMode())
      }
    }
    checkSpeed()
    // Check again when buffering state changes
    if (isBuffering) {
      checkSpeed()
    }
  }, [isBuffering])

  // Handle progress bar interaction
  const handleProgressBarClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || chunkInfo.total <= 0) return
    
    const rect = progressBarRef.current.getBoundingClientRect()
    if (rect.width === 0) return
    
    const clickX = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, clickX / rect.width))
    const targetChunk = Math.floor(percentage * chunkInfo.total)
    
    if (Number.isFinite(targetChunk) && targetChunk >= 0) {
      await playbackController.goToChunk(targetChunk)
    }
  }, [chunkInfo.total])

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || chunkInfo.total === 0) return
    setIsDragging(true)
    
    const rect = progressBarRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const percentage = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
    setDragProgress(percentage)
  }, [chunkInfo.total])

  // Handle keyboard navigation on progress bar
  const { announce } = useAnnounce()
  const handleProgressBarKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (chunkInfo.total <= 0) return
    
    const step = e.shiftKey ? 10 : 1 // Hold Shift for larger jumps
    let targetChunk = chunkInfo.current - 1 // Convert to 0-indexed
    
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        targetChunk = Math.min(chunkInfo.total - 1, targetChunk + step)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        targetChunk = Math.max(0, targetChunk - step)
        break
      case 'Home':
        e.preventDefault()
        targetChunk = 0
        break
      case 'End':
        e.preventDefault()
        targetChunk = chunkInfo.total - 1
        break
      default:
        return
    }
    
    await playbackController.goToChunk(targetChunk)
    const newProgress = Math.round((targetChunk / chunkInfo.total) * 100)
    announce(`${newProgress}% complete, part ${targetChunk + 1} of ${chunkInfo.total}`)
  }, [chunkInfo.total, chunkInfo.current, announce])

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!progressBarRef.current) return
      const rect = progressBarRef.current.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const percentage = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
      setDragProgress(percentage)
    }

    const handleEnd = async () => {
      setIsDragging(false)
      if (chunkInfo.total > 0 && Number.isFinite(dragProgress)) {
        const targetChunk = Math.floor((dragProgress / 100) * chunkInfo.total)
        if (Number.isFinite(targetChunk) && targetChunk >= 0) {
          await playbackController.goToChunk(targetChunk)
        }
      }
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchmove', handleMove)
    window.addEventListener('touchend', handleEnd)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleEnd)
    }
  }, [isDragging, dragProgress, chunkInfo.total])

  const handleSpeedChange = async (newSpeed: number) => {
    await playbackController.setSpeed(newSpeed)
  }

  const handleTogglePlayback = async () => {
    await playbackController.togglePlayback()
  }

  const handleSkipBack = async () => {
    await playbackController.skipBack()
  }

  const handleSkipForward = async () => {
    await playbackController.skipForward()
  }

  const handlePrevSection = async () => {
    await playbackController.previousSection()
  }

  const handleNextSection = async () => {
    await playbackController.nextSection()
  }

  if (!currentBook) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-text-secondary"><Trans>No book is currently playing</Trans></p>
        <button
          onClick={() => navigate('/app')}
          className="pressable mt-4 rounded-full bg-surface-2 px-6 py-2 text-text-primary"
        >
          <Trans>Go to Library</Trans>
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-surface-1 to-surface-0">
        {/* Header - fixed at top */}
        <header className="flex flex-shrink-0 items-center justify-between px-4 py-3 lg:px-8">
          <button
            onClick={() => navigate(-1)}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-2"
            aria-label={t`Go back`}
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
          <span className="text-sm font-medium text-text-secondary lg:hidden">Now Playing</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChapters(true)}
              className="pressable flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-2"
              aria-label={t`Table of contents`}
              title={t`Chapters`}
            >
              <ListIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => navigate('/app/settings')}
              className="pressable flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-2"
              aria-label={t`Settings`}
              title={t`Settings`}
            >
              <SettingsIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Main content - changes layout when lyrics mode is active on desktop */}
        {showLyrics && chunkText ? (
          <>
            {/* LYRICS MODE (Desktop): Full-screen lyrics with compact bottom controls */}
            {/* Mobile: Same as before - lyrics overlay */}
            
            {/* Mobile lyrics layout (same as before) */}
            <div className="flex min-h-0 flex-1 flex-col lg:hidden">
              {/* Cover art section with lyrics overlay */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-6">
                {/* Lyrics view overlay */}
                <div className="absolute inset-0 overflow-hidden">
                  <LyricsView key={`${position.sectionIndex}-${position.chunkIndex}`} chunkText={chunkText} />
                </div>
                
                {/* View toggle button */}
                <button
                  onClick={() => setShowLyrics(!showLyrics)}
                  className="absolute right-4 top-4 pressable flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white transition-colors"
                  aria-label={t`Show cover art`}
                >
                  <TextIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Mobile controls (same as before) */}
              <div className="flex flex-shrink-0 flex-col items-center px-6">
                {/* Progress bar */}
                <div className="w-full max-w-sm flex-shrink-0">
                  <div 
                    ref={progressBarRef}
                    role="slider"
                    tabIndex={0}
                    aria-label={t`Playback progress`}
                    aria-valuemin={0}
                    aria-valuemax={chunkInfo.total}
                    aria-valuenow={chunkInfo.current}
                    aria-valuetext={t`Part ${chunkInfo.current} of ${chunkInfo.total}, ${Math.round(chunkInfo.progress)}% complete`}
                    className="relative h-8 w-full cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                    onClick={handleProgressBarClick}
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                    onKeyDown={handleProgressBarKeyDown}
                  >
                    <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="absolute h-full bg-accent/30 transition-all duration-200"
                        style={{ width: `${Math.max(bufferProgress, isDragging ? dragProgress : chunkInfo.progress)}%` }}
                      />
                      <div
                        className="absolute h-full bg-accent transition-all duration-150"
                        style={{ width: `${isDragging ? dragProgress : chunkInfo.progress}%` }}
                      />
                    </div>
                    <div 
                      className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-lg transition-transform active:scale-125"
                      style={{ left: `${isDragging ? dragProgress : chunkInfo.progress}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-text-muted" aria-hidden="true">
                    <span>{chunkInfo.total > 0 ? t`Part ${chunkInfo.current} of ${chunkInfo.total}` : t`Loading...`}</span>
                    <span>{isBuffering ? t`Generating...` : `${Math.round(chunkInfo.progress)}%`}</span>
                  </div>
                </div>

                {/* Main playback controls */}
                <div className="mt-6 w-full">
                  <div className="mb-4 flex items-center justify-center gap-4">
                    <button onClick={handleSkipBack} className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Rewind`}>
                      <RewindIcon className="h-7 w-7" />
                    </button>
                    <button onClick={handlePrevSection} className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Previous chapter`}>
                      <SkipBackIcon className="h-5 w-5" />
                    </button>
                    <button onClick={handleTogglePlayback} className="pressable flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30" aria-label={isPlaying ? 'Pause' : 'Play'}>
                      {isBuffering ? <div className="h-7 w-7 animate-spin rounded-full border-3 border-white border-t-transparent" /> : isPlaying ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8 pl-0.5" />}
                    </button>
                    <button onClick={handleNextSection} className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Next chapter`}>
                      <SkipForwardIcon className="h-5 w-5" />
                    </button>
                    <button onClick={handleSkipForward} className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Forward`}>
                      <FastForwardIcon className="h-7 w-7" />
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-8">
                    <button onClick={() => setShowSpeed(true)} className="pressable flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary" aria-label={t`Change playback speed`}>
                      <SpeedIcon className="h-5 w-5" /><span className="text-xs font-medium">{speed}×</span>
                    </button>
                    <button onClick={() => setShowSleepTimer(true)} className={`pressable flex flex-col items-center gap-0.5 ${sleepTimerActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`} aria-label={t`Sleep timer`}>
                      <MoonIcon className="h-5 w-5" /><span className="text-xs">{sleepTimerActive ? `${remainingMinutes}m` : t`Sleep`}</span>
                    </button>
                    <button onClick={() => setShowBookmarks(true)} className="pressable flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary" aria-label={t`Bookmarks`}>
                      <BookmarkIcon className="h-5 w-5" /><span className="text-xs"><Trans>Mark</Trans></span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 pb-6" />
            </div>

            {/* Desktop lyrics mode: Full-screen lyrics with bottom control bar */}
            <div className="hidden min-h-0 flex-1 flex-col lg:flex">
              {/* Full-screen lyrics area */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center">
                <div className="h-full w-full max-w-4xl">
                  <LyricsView key={`desktop-${position.sectionIndex}-${position.chunkIndex}`} chunkText={chunkText} />
                </div>
              </div>

              {/* Compact bottom control bar */}
              <div className="flex-shrink-0 border-t border-surface-2 bg-surface-1/80 backdrop-blur-lg">
                <div className="mx-auto max-w-6xl px-6 py-4">
                  <div className="flex items-center gap-6">
                    {/* Mini cover art + info */}
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-surface-3 shadow-lg">
                        {currentBook.coverUrl ? (
                          <img src={currentBook.coverUrl} alt={currentBook.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-purple-900/30">
                            <span className="text-2xl opacity-50">📖</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">{currentBook.title}</p>
                        <p className="truncate text-xs text-text-secondary">{currentBook.author}</p>
                        {currentSectionTitle && (
                          <p className="truncate text-xs text-text-muted">{currentSectionTitle}</p>
                        )}
                      </div>
                    </div>

                    {/* Center: Progress bar + main controls */}
                    <div className="flex flex-1 flex-col items-center gap-2">
                      {/* Main playback controls */}
                      <div className="flex items-center gap-3">
                        <button onClick={handleSkipBack} className="pressable flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Rewind`}>
                          <RewindIcon className="h-5 w-5" />
                        </button>
                        <button onClick={handlePrevSection} className="pressable flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Previous chapter`}>
                          <SkipBackIcon className="h-4 w-4" />
                        </button>
                        <button onClick={handleTogglePlayback} className="pressable flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30" aria-label={isPlaying ? 'Pause' : 'Play'}>
                          {isBuffering ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : isPlaying ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6 pl-0.5" />}
                        </button>
                        <button onClick={handleNextSection} className="pressable flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Next chapter`}>
                          <SkipForwardIcon className="h-4 w-4" />
                        </button>
                        <button onClick={handleSkipForward} className="pressable flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:text-text-primary" aria-label={t`Forward`}>
                          <FastForwardIcon className="h-5 w-5" />
                        </button>
                      </div>
                      
                      {/* Progress bar */}
                      <div className="flex w-full max-w-md items-center gap-3">
                        <span className="w-16 text-right text-xs text-text-muted" aria-hidden="true">
                          {chunkInfo.total > 0 ? `${chunkInfo.current}/${chunkInfo.total}` : '—'}
                        </span>
                        <div 
                          ref={progressBarRef}
                          role="slider"
                          tabIndex={0}
                          aria-label={t`Playback progress`}
                          aria-valuemin={0}
                          aria-valuemax={chunkInfo.total}
                          aria-valuenow={chunkInfo.current}
                          aria-valuetext={t`Part ${chunkInfo.current} of ${chunkInfo.total}, ${Math.round(chunkInfo.progress)}% complete`}
                          className="relative h-6 flex-1 cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                          onClick={handleProgressBarClick}
                          onMouseDown={handleDragStart}
                          onTouchStart={handleDragStart}
                          onKeyDown={handleProgressBarKeyDown}
                        >
                          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3">
                            <div className="absolute h-full bg-accent/30 transition-all duration-200" style={{ width: `${Math.max(bufferProgress, isDragging ? dragProgress : chunkInfo.progress)}%` }} />
                            <div className="absolute h-full bg-accent transition-all duration-150" style={{ width: `${isDragging ? dragProgress : chunkInfo.progress}%` }} />
                          </div>
                          <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-md transition-transform hover:scale-125" style={{ left: `${isDragging ? dragProgress : chunkInfo.progress}%` }} aria-hidden="true" />
                        </div>
                        <span className="w-16 text-xs text-text-muted" aria-hidden="true">
                          {isBuffering ? 'Gen...' : `${Math.round(chunkInfo.progress)}%`}
                        </span>
                      </div>
                    </div>

                    {/* Right: Secondary controls */}
                    <div className="flex items-center gap-4">
                      <button onClick={() => setShowSpeed(true)} className="pressable flex h-9 items-center gap-1.5 rounded-full px-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary" aria-label={t`Change playback speed`}>
                        <SpeedIcon className="h-4 w-4" /><span className="text-xs font-medium">{speed}×</span>
                      </button>
                      <button onClick={() => setShowSleepTimer(true)} className={`pressable flex h-9 w-9 items-center justify-center rounded-full ${sleepTimerActive ? 'text-accent' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'}`} aria-label={t`Sleep timer`} title={sleepTimerActive ? `${remainingMinutes}m remaining` : 'Sleep timer'}>
                        <MoonIcon className="h-4 w-4" />
                      </button>
                      <button onClick={() => setShowBookmarks(true)} className="pressable flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-text-primary" aria-label={t`Bookmarks`} title={t`Add bookmark`}>
                        <BookmarkIcon className="h-4 w-4" />
                      </button>
                      <button onClick={() => setShowLyrics(false)} className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white" aria-label={t`Hide lyrics`} title={t`Hide lyrics`}>
                        <TextIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* NORMAL MODE: Cover + controls layout */}
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-center lg:gap-12 lg:px-12">
              {/* Cover art section */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-6 lg:w-2/5 lg:flex-none lg:px-0">
                {/* Book cover */}
                <div className="flex min-h-0 w-full max-w-xs flex-shrink items-center justify-center pb-4 lg:max-w-md lg:pb-0">
                  <div className="aspect-square w-full max-h-full overflow-hidden rounded-2xl bg-surface-3 shadow-2xl shadow-black/50 lg:rounded-3xl">
                    {currentBook.coverUrl ? (
                      <img
                        src={currentBook.coverUrl}
                        alt={currentBook.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-purple-900/30">
                        <span className="text-6xl opacity-50 lg:text-8xl">📖</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* View toggle button - mobile only */}
                <button
                  onClick={() => setShowLyrics(!showLyrics)}
                  className="absolute right-4 top-4 pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-secondary transition-colors hover:text-text-primary lg:hidden"
                  aria-label={t`Show lyrics`}
                >
                  <TextIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Info + Progress + Controls section */}
              <div className="flex flex-shrink-0 flex-col items-center px-6 lg:flex-1 lg:items-start lg:px-0">
                {/* Title and author */}
                <div className="flex-shrink-0 pb-1 text-center lg:pb-2 lg:text-left">
                  <h1 className="text-lg font-bold text-text-primary line-clamp-1 lg:text-2xl lg:line-clamp-2">{currentBook.title}</h1>
                  <p className="text-sm text-text-secondary line-clamp-1 lg:text-base">{currentBook.author}</p>
                </div>

                {/* Current section */}
                {currentSectionTitle && (
                  <p className="flex-shrink-0 pb-3 text-xs text-text-muted line-clamp-1 lg:pb-6 lg:text-sm">
                    {currentSectionTitle}
                  </p>
                )}

                {/* Progress bar */}
                <div className="w-full max-w-sm flex-shrink-0 lg:max-w-full">
                  {/* Interactive progress track */}
                  <div 
                    ref={progressBarRef}
                    role="slider"
                    tabIndex={0}
                    aria-label={t`Playback progress`}
                    aria-valuemin={0}
                    aria-valuemax={chunkInfo.total}
                    aria-valuenow={chunkInfo.current}
                    aria-valuetext={t`Part ${chunkInfo.current} of ${chunkInfo.total}, ${Math.round(chunkInfo.progress)}% complete`}
                    className="relative h-8 w-full cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 lg:h-10"
                    onClick={handleProgressBarClick}
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                    onKeyDown={handleProgressBarKeyDown}
                  >
                    {/* Track background */}
                    <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3 lg:h-2">
                      {/* Buffered-ahead fill (lighter) */}
                      <div
                        className="absolute h-full bg-accent/30 transition-all duration-200"
                        style={{ width: `${Math.max(bufferProgress, isDragging ? dragProgress : chunkInfo.progress)}%` }}
                      />
                      {/* Progress fill */}
                      <div
                        className="absolute h-full bg-accent transition-all duration-150"
                        style={{ width: `${isDragging ? dragProgress : chunkInfo.progress}%` }}
                      />
                    </div>
                    
                    {/* Draggable thumb */}
                    <div 
                      className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-lg transition-transform active:scale-125 lg:h-5 lg:w-5"
                      style={{ left: `${isDragging ? dragProgress : chunkInfo.progress}%` }}
                      aria-hidden="true"
                    />
                    
                    {/* Chunk markers (subtle dots) */}
                    {chunkInfo.total > 1 && chunkInfo.total <= 20 && (
                      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2" aria-hidden="true">
                        {Array.from({ length: chunkInfo.total }).map((_, i) => (
                          <div
                            key={i}
                            className="absolute h-1 w-1 -translate-x-1/2 rounded-full bg-text-muted/30"
                            style={{ left: `${(i / chunkInfo.total) * 100}%` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Progress info */}
                  <div className="flex justify-between text-xs text-text-muted lg:text-sm">
                    <span>
                      {chunkInfo.total > 0 
                        ? t`Part ${chunkInfo.current} of ${chunkInfo.total}`
                        : t`Loading...`}
                    </span>
                    <span>
                      {isBuffering 
                        ? t`Generating...` 
                        : `${Math.round(chunkInfo.progress)}%`}
                    </span>
                  </div>
                  
                  {/* Slow mode warning */}
                  {isBuffering && isSlowMode && (
                    <div className="mt-2 rounded-lg bg-warning/10 px-3 py-1.5 text-center text-xs text-warning">
                      <Trans>⚠️ CPU mode (slow)</Trans>
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div className="mt-6 w-full lg:mt-8">
                  {/* Main playback controls */}
                  <div className="mb-4 flex items-center justify-center gap-4 lg:justify-start lg:gap-6">
                    <button
                      onClick={handleSkipBack}
                      className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary lg:h-12 lg:w-12"
                      aria-label={t`Rewind`}
                    >
                      <RewindIcon className="h-7 w-7" />
                    </button>

                    <button
                      onClick={handlePrevSection}
                      className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary lg:h-12 lg:w-12"
                      aria-label={t`Previous chapter`}
                    >
                      <SkipBackIcon className="h-5 w-5 lg:h-6 lg:w-6" />
                    </button>

                    <button
                      onClick={handleTogglePlayback}
                      className="pressable flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 lg:h-20 lg:w-20"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isBuffering ? (
                        <div className="h-7 w-7 animate-spin rounded-full border-3 border-white border-t-transparent lg:h-8 lg:w-8" />
                      ) : isPlaying ? (
                        <PauseIcon className="h-8 w-8 lg:h-10 lg:w-10" />
                      ) : (
                        <PlayIcon className="h-8 w-8 pl-0.5 lg:h-10 lg:w-10" />
                      )}
                    </button>

                    <button
                      onClick={handleNextSection}
                      className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary lg:h-12 lg:w-12"
                      aria-label={t`Next chapter`}
                    >
                      <SkipForwardIcon className="h-5 w-5 lg:h-6 lg:w-6" />
                    </button>

                    <button
                      onClick={handleSkipForward}
                      className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary lg:h-12 lg:w-12"
                      aria-label={t`Forward`}
                    >
                      <FastForwardIcon className="h-7 w-7" />
                    </button>
                  </div>

                  {/* Secondary controls */}
                  <div className="flex items-center justify-center gap-8 lg:justify-start">
                    <button
                      onClick={() => setShowSpeed(true)}
                      className="pressable flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary"
                      aria-label={t`Change playback speed`}
                    >
                      <SpeedIcon className="h-5 w-5" />
                      <span className="text-xs font-medium">{speed}×</span>
                    </button>

                    <button
                      onClick={() => setShowSleepTimer(true)}
                      className={`pressable flex flex-col items-center gap-0.5 ${
                        sleepTimerActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
                      }`}
                      aria-label={t`Sleep timer`}
                    >
                      <MoonIcon className="h-5 w-5" />
                      <span className="text-xs">{sleepTimerActive ? `${remainingMinutes}m` : t`Sleep`}</span>
                    </button>

                    <button
                      onClick={() => setShowBookmarks(true)}
                      className="pressable flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary"
                      aria-label={t`Bookmarks`}
                    >
                      <BookmarkIcon className="h-5 w-5" />
                      <span className="text-xs">Mark</span>
                    </button>

                    <button
                      onClick={() => navigate('/app/settings')}
                      className="pressable flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary"
                      aria-label="Settings"
                    >
                      <SettingsIcon className="h-5 w-5" />
                      <span className="text-xs"><Trans>Settings</Trans></span>
                    </button>

                    {/* Lyrics toggle - desktop only */}
                    <button
                      onClick={() => setShowLyrics(!showLyrics)}
                      className="pressable hidden flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary lg:flex"
                      aria-label={t`Show lyrics`}
                    >
                      <TextIcon className="h-5 w-5" />
                      <span className="text-xs"><Trans>Lyrics</Trans></span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom padding */}
            <div className="flex-shrink-0 pb-6 lg:pb-8" />
          </>
        )}
      </div>

      {/* Sheets */}
      <SpeedSheet 
        isOpen={showSpeed} 
        onClose={() => setShowSpeed(false)} 
        currentSpeed={speed}
        onSpeedChange={handleSpeedChange}
      />
      <SleepTimerSheet isOpen={showSleepTimer} onClose={() => setShowSleepTimer(false)} />
      <BookmarkSheet isOpen={showBookmarks} onClose={() => setShowBookmarks(false)} />
      
      {/* Chapters Sheet */}
      {showChapters && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowChapters(false)}
          />
          
          {/* Sheet - bottom on mobile, centered modal on desktop */}
          <div className="relative w-full max-w-lg animate-slide-up rounded-t-3xl bg-surface-1 pb-safe md:rounded-2xl md:pb-4">
            {/* Handle - mobile only */}
            <div className="flex justify-center py-3 md:hidden">
              <div className="h-1 w-10 rounded-full bg-surface-3" />
            </div>
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-surface-2 px-6 pb-4 md:pt-4">
              <h2 className="text-lg font-semibold text-text-primary"><Trans>Chapters</Trans></h2>
              <button
                onClick={() => setShowChapters(false)}
                className="pressable text-sm text-accent"
              >
                Done
              </button>
            </div>
            
            {/* Chapter list */}
            <div className="max-h-[60vh] overflow-y-auto px-2 py-2 md:max-h-[50vh]">
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  onClick={async () => {
                    await playbackController.goToSection(index)
                    setShowChapters(false)
                  }}
                  className={`w-full rounded-xl px-4 py-3 text-left transition-colors ${
                    index === position.sectionIndex
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-primary hover:bg-surface-2'
                  }`}
                >
                  <span className="line-clamp-2 text-sm font-medium">
                    {section.title || `Section ${index + 1}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

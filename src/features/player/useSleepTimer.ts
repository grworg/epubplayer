import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '@lingui/macro'
import { playbackController } from './PlaybackController'

export type SleepTimerDuration = 5 | 10 | 15 | 30 | 45 | 60 | 0 // 0 = off

export function useSleepTimer() {
  const [remainingMinutes, setRemainingMinutes] = useState(0)
  const [isActive, setIsActive] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const endTimeRef = useRef<number | null>(null)

  // Clear the timer
  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    endTimeRef.current = null
    setIsActive(false)
    setRemainingMinutes(0)
  }, [])

  // Set a sleep timer
  const setTimer = useCallback(
    (minutes: SleepTimerDuration) => {
      clearTimer()

      if (minutes === 0) return

      const endTime = Date.now() + minutes * 60 * 1000
      endTimeRef.current = endTime
      setRemainingMinutes(minutes)
      setIsActive(true)

      // Update every second
      intervalRef.current = setInterval(() => {
        const now = Date.now()
        const remaining = Math.max(0, Math.ceil((endTimeRef.current! - now) / 60000))

        setRemainingMinutes(remaining)

        if (remaining <= 0) {
          // Timer expired - pause playback
          playbackController.pause()
          clearTimer()
        }
      }, 1000)
    },
    [clearTimer]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return {
    remainingMinutes,
    isActive,
    setTimer,
    clearTimer,
  }
}

export function getSleepTimerOptions(): { value: SleepTimerDuration; label: string }[] {
  return [
    { value: 0, label: t`Off` },
    { value: 5, label: t`5 minutes` },
    { value: 10, label: t`10 minutes` },
    { value: 15, label: t`15 minutes` },
    { value: 30, label: t`30 minutes` },
    { value: 45, label: t`45 minutes` },
    { value: 60, label: t`1 hour` },
  ]
}

// For backwards compatibility
export const SLEEP_TIMER_OPTIONS = getSleepTimerOptions()

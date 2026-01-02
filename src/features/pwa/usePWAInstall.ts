import { useState, useEffect } from 'react'
import { settingsRepository } from '@/services/storage/settingsRepository'

export type Platform = 'ios' | 'android' | 'desktop-chrome' | 'desktop-other' | 'unknown'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Detect user's platform
export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
  const isAndroid = /android/.test(ua)
  const isChrome = /chrome/.test(ua) && !/edge|edg/.test(ua)
  const isSafari = /safari/.test(ua) && !/chrome/.test(ua)
  
  if (isIOS) return 'ios'
  if (isAndroid) return 'android'
  if (isChrome) return 'desktop-chrome'
  if (isSafari) return 'desktop-other'
  return 'desktop-other'
}

// Check if app is already installed as PWA
export function isInstalledAsPWA(): boolean {
  // Check display-mode
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  
  // iOS Safari standalone mode
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true
  
  // Check if running in TWA (Android)
  if (document.referrer.includes('android-app://')) return true
  
  return false
}

// Hook for PWA install functionality
export function usePWAInstall() {
  const [platform] = useState<Platform>(detectPlatform)
  const [isInstalled, setIsInstalled] = useState(isInstalledAsPWA)
  const [hasDismissedPrompt, setHasDismissedPrompt] = useState<boolean | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [canPromptNatively, setCanPromptNatively] = useState(false)

  // Load dismissed state from settings
  useEffect(() => {
    settingsRepository.get('hasDismissedPWAPrompt').then(setHasDismissedPrompt)
  }, [])

  // Listen for the beforeinstallprompt event (Chrome/Edge)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setCanPromptNatively(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    
    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
      setCanPromptNatively(false)
    })

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  // Check installation status on visibility change (user might have installed)
  useEffect(() => {
    const checkInstalled = () => {
      if (isInstalledAsPWA()) {
        setIsInstalled(true)
      }
    }
    
    document.addEventListener('visibilitychange', checkInstalled)
    return () => document.removeEventListener('visibilitychange', checkInstalled)
  }, [])

  const dismissPrompt = async () => {
    await settingsRepository.set('hasDismissedPWAPrompt', true)
    setHasDismissedPrompt(true)
  }

  const triggerNativeInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setIsInstalled(true)
      }
      setDeferredPrompt(null)
      setCanPromptNatively(false)
    }
  }

  // Should show the install notification?
  const shouldShowPrompt = 
    hasDismissedPrompt === false && 
    !isInstalled

  return {
    platform,
    isInstalled,
    shouldShowPrompt,
    canPromptNatively,
    dismissPrompt,
    triggerNativeInstall,
  }
}

// Get platform-specific install instructions
export function getInstallInstructions(platform: Platform): {
  title: string
  steps: string[]
  icon: string
} {
  switch (platform) {
    case 'ios':
      return {
        title: 'Install on iPhone/iPad',
        icon: '📱',
        steps: [
          'Tap the Share button (square with arrow) in Safari',
          'Scroll down and tap "Add to Home Screen"',
          'Tap "Add" in the top right',
          'EPUB Player will appear on your home screen!',
        ],
      }
    case 'android':
      return {
        title: 'Install on Android',
        icon: '📱',
        steps: [
          'Tap the menu (⋮) in the top right of Chrome',
          'Tap "Install app" or "Add to Home screen"',
          'Tap "Install" to confirm',
          'EPUB Player will appear in your app drawer!',
        ],
      }
    case 'desktop-chrome':
      return {
        title: 'Install on Desktop',
        icon: '💻',
        steps: [
          'Click the install icon (⊕) in the address bar',
          'Or click the menu (⋮) → "Install EPUB Player"',
          'Click "Install" to confirm',
          'EPUB Player will open as a standalone app!',
        ],
      }
    default:
      return {
        title: 'Install as App',
        icon: '💻',
        steps: [
          'Look for an "Install" or "Add to Home Screen" option in your browser menu',
          'This lets you use EPUB Player like a native app',
          'It will work offline and launch from your home screen/dock',
        ],
      }
  }
}


import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Trans } from '@lingui/react/macro'
import { I18nProvider } from '@lingui/react'
import { i18n, initI18n } from '@/i18n'
import { AppShell } from '@/app/AppShell'
import { LandingPage } from '@/features/landing/LandingPage'
import { LibraryPage } from '@/features/library/LibraryPage'
import { NowPlayingPage } from '@/features/player/NowPlayingPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { BookDetailPage } from '@/features/library/BookDetailPage'
import { HelpPage } from '@/features/help/HelpPage'
import { TermsPage } from '@/features/legal/TermsPage'
import { DebugLogsPage } from '@/features/debug/DebugLogsPage'
import { FindEbooksPage } from '@/features/discover/FindEbooksPage'
import { ShareLibraryPage, ReceiveLibraryPage } from '@/features/transfer'
import { AccessibilityPage } from '@/features/accessibility/AccessibilityPage'
import { LiveRegionProvider } from '@/ui/accessibility'
import { usePlaybackAnnouncements } from '@/features/player/usePlaybackAnnouncements'
import { useGlobalShortcuts, KeyboardShortcutsHelp } from '@/features/player/useGlobalShortcuts'

/**
 * I18n loader that initializes locale before rendering
 */
function I18nLoader({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    initI18n().then(() => setReady(true))
  }, [])

  // Don't render anything until i18n is ready
  // This prevents flash of untranslated content
  if (!ready) {
    return null
  }

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}

/**
 * Accessibility wrapper that provides announcements and keyboard shortcuts
 */
function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  
  usePlaybackAnnouncements()
  useGlobalShortcuts({
    onShowHelp: () => setShowShortcutsHelp(true),
  })
  
  return (
    <>
      {children}
      <KeyboardShortcutsHelp 
        isOpen={showShortcutsHelp} 
        onClose={() => setShowShortcutsHelp(false)} 
      />
    </>
  )
}

export default function App() {
  return (
    <I18nLoader>
      <LiveRegionProvider>
        <Analytics />
        {/* Skip link for keyboard users */}
        <a href="#main-content" className="skip-link">
          <Trans>Skip to main content</Trans>
        </a>
        <BrowserRouter>
          <AccessibilityProvider>
            <Routes>
              {/* Landing page */}
              <Route path="/" element={<LandingPage />} />
              
              {/* App routes */}
              <Route path="/app" element={<AppShell />}>
                <Route index element={<LibraryPage />} />
                <Route path="book/:bookId" element={<BookDetailPage />} />
                <Route path="playing" element={<NowPlayingPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="help" element={<HelpPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="find-ebooks" element={<FindEbooksPage />} />
                <Route path="debug-logs" element={<DebugLogsPage />} />
                <Route path="share-library" element={<ShareLibraryPage />} />
                <Route path="receive-library" element={<ReceiveLibraryPage />} />
                <Route path="accessibility" element={<AccessibilityPage />} />
              </Route>
            </Routes>
          </AccessibilityProvider>
        </BrowserRouter>
      </LiveRegionProvider>
    </I18nLoader>
  )
}

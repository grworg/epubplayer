import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
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

export default function App() {
  return (
    <>
      <Analytics />
      <BrowserRouter>
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
        </Route>
      </Routes>
    </BrowserRouter>
    </>
  )
}

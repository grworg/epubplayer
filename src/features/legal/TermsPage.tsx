import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ChevronLeftIcon } from '@/ui/icons'

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl bg-surface-1 p-5">
      <h2 className="mb-2 text-lg font-semibold text-text-primary">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-text-secondary">{children}</div>
    </section>
  )
}

function Small({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-text-muted">{children}</p>
}

export function TermsPage() {
  const navigate = useNavigate()
  const updatedAt = '2025-12-28'

  useEffect(() => {
    const prev = document.title
    document.title = 'Terms & Privacy — EPUB Player'
    return () => {
      document.title = prev
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={() => navigate(-1)}
          className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary"
          aria-label="Back"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-text-primary">Terms & Privacy</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Last updated: {updatedAt}</p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-5 pb-8">
        <Section title="Plain-English summary">
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary">No accounts, no tracking, no analytics.</strong>
            </li>
            <li>
              <strong className="text-text-primary">We don’t collect or sell your data.</strong>
            </li>
            <li>
              <strong className="text-text-primary">Your ebooks, audio, and settings stay on your device</strong> (local
              browser storage).
            </li>
            <li>
              <strong className="text-text-primary">Text-to-speech generation happens locally</strong> on your device.
            </li>
          </ul>
        </Section>

        <Section title="Local storage (what’s saved)">
          <p>To make the app work offline and resume reliably, it stores data locally on your device, including:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Imported EPUB files</li>
            <li>Extracted book structure/text (for playback)</li>
            <li>Generated audio chunks (when using AI TTS that pre-generates audio)</li>
            <li>Playback progress, bookmarks, and app settings</li>
          </ul>
          <p>
            You can delete this at any time in <Link className="text-accent underline" to="/app/settings">Settings</Link> →
            Storage.
          </p>
          <Small>
            Technical detail: storage uses your browser’s on-device database (IndexedDB). Storage quotas vary by device
            and browser.
          </Small>
        </Section>

        <Section title="Network use (what may be downloaded)">
          <p>
            The core app is designed to work offline once loaded. However, some features require downloading files to
            your device:
          </p>
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary">App updates/assets</strong> (standard website files, cached by your
              browser/PWA).
            </li>
            <li>
              <strong className="text-text-primary">AI TTS engine/model files</strong> (for Kokoro). These downloads are
              used so the model can run locally on your device.
            </li>
          </ul>
          <Small>
            Important: downloading engine/model files is not the same as uploading your ebooks. Your book contents are
            not sent to a server for storage.
          </Small>
        </Section>

        <Section title="Your content and copyright">
          <p>
            You are responsible for the ebooks you import. Only use content you own or have the right to use. Don’t use
            this app to infringe copyright or violate terms from content providers.
          </p>
        </Section>

        <Section title="Disclaimers">
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary">No warranty:</strong> the app is provided “as is,” without warranties
              of any kind.
            </li>
            <li>
              <strong className="text-text-primary">Performance varies:</strong> AI TTS speed and loading time depend on
              your device. Modern phones with WebGPU generally perform best.
            </li>
            <li>
              <strong className="text-text-primary">Data durability:</strong> browser storage can be cleared by you, by
              your browser, or by the OS (e.g., low storage cleanup). Keep backups of any important files.
            </li>
          </ul>
        </Section>

        <Section title="Open-source license">
          <p>
            This project is open-source under the <strong className="text-text-primary">MIT License</strong>. See the{' '}
            <strong className="text-text-primary">LICENSE</strong> file in the project for full terms.
          </p>
        </Section>

        <div className="rounded-2xl bg-surface-1 p-5 text-sm text-text-secondary">
          <p>
            Want a friendly walkthrough? See{' '}
            <Link className="text-accent underline" to="/app/help">
              Help & How it works
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}



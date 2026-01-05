import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
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
    document.title = t`Terms & Privacy — EPUB Player`
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
          aria-label={t`Go back`}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-text-primary">
            <Trans>Terms & Privacy</Trans>
          </h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            <Trans>Last updated: {updatedAt}</Trans>
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-5 pb-8">
        <Section title={t`Plain-English summary`}>
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary"><Trans>No accounts, no tracking, no analytics.</Trans></strong>
            </li>
            <li>
              <strong className="text-text-primary"><Trans>We don't collect or sell your data.</Trans></strong>
            </li>
            <li>
              <strong className="text-text-primary"><Trans>Your ebooks, audio, and settings stay on your device</Trans></strong>{' '}
              <Trans>(local browser storage).</Trans>
            </li>
            <li>
              <strong className="text-text-primary"><Trans>Text-to-speech generation happens locally</Trans></strong>{' '}
              <Trans>on your device.</Trans>
            </li>
          </ul>
        </Section>

        <Section title={t`Local storage (what's saved)`}>
          <p><Trans>To make the app work offline and resume reliably, it stores data locally on your device, including:</Trans></p>
          <ul className="list-inside list-disc space-y-1">
            <li><Trans>Imported EPUB files</Trans></li>
            <li><Trans>Extracted book structure/text (for playback)</Trans></li>
            <li><Trans>Generated audio chunks (when using AI TTS that pre-generates audio)</Trans></li>
            <li><Trans>Playback progress, bookmarks, and app settings</Trans></li>
          </ul>
          <p>
            <Trans>
              You can delete this at any time in <Link className="text-accent underline" to="/app/settings">Settings</Link> → Storage.
            </Trans>
          </p>
          <Small>
            <Trans>Technical detail: storage uses your browser's on-device database (IndexedDB). Storage quotas vary by device and browser.</Trans>
          </Small>
        </Section>

        <Section title={t`Network use (what may be downloaded)`}>
          <p>
            <Trans>The core app is designed to work offline once loaded. However, some features require downloading files to your device:</Trans>
          </p>
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary"><Trans>App updates/assets</Trans></strong>{' '}
              <Trans>(standard website files, cached by your browser/PWA).</Trans>
            </li>
            <li>
              <strong className="text-text-primary"><Trans>AI TTS engine/model files</Trans></strong>{' '}
              <Trans>(for Kokoro). These downloads are used so the model can run locally on your device.</Trans>
            </li>
          </ul>
          <Small>
            <Trans>Important: downloading engine/model files is not the same as uploading your ebooks. Your book contents are not sent to a server for storage.</Trans>
          </Small>
        </Section>

        <Section title={t`Your content and copyright`}>
          <p>
            <Trans>You are responsible for the ebooks you import. Only use content you own or have the right to use. Don't use this app to infringe copyright or violate terms from content providers.</Trans>
          </p>
        </Section>

        <Section title={t`Disclaimers`}>
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary"><Trans>No warranty:</Trans></strong>{' '}
              <Trans>the app is provided "as is," without warranties of any kind.</Trans>
            </li>
            <li>
              <strong className="text-text-primary"><Trans>Performance varies:</Trans></strong>{' '}
              <Trans>AI TTS speed and loading time depend on your device. Modern phones with WebGPU generally perform best.</Trans>
            </li>
            <li>
              <strong className="text-text-primary"><Trans>Data durability:</Trans></strong>{' '}
              <Trans>browser storage can be cleared by you, by your browser, or by the OS (e.g., low storage cleanup). Keep backups of any important files.</Trans>
            </li>
          </ul>
        </Section>

        <Section title={t`Open-source license`}>
          <p>
            <Trans>
              This project is open-source under the <strong className="text-text-primary">MIT License</strong>. See the <strong className="text-text-primary">LICENSE</strong> file in the project for full terms.
            </Trans>
          </p>
        </Section>

        <div className="rounded-2xl bg-surface-1 p-5 text-sm text-text-secondary">
          <p>
            <Trans>
              Want a friendly walkthrough? See <Link className="text-accent underline" to="/app/help">Help & How it works</Link>.
            </Trans>
          </p>
        </div>
      </div>
    </div>
  )
}



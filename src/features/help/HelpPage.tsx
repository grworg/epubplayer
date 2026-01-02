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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-secondary">
      {children}
    </span>
  )
}

export function HelpPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const prev = document.title
    document.title = 'Help & How it works — EPUB Player'
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
          <h1 className="truncate text-2xl font-bold text-text-primary">Help & How it works</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            An offline-first, open-source EPUB reader that can generate audiobook-style playback on your device.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-5 pb-8">
        <Section title="Quick start (EPUB → audio)">
          <ol className="list-inside list-decimal space-y-2">
            <li>
              Tap <Pill>Add EPUB</Pill> on the Library screen and select an <Pill>.epub</Pill> file.
            </li>
            <li>
              Open the book and press <Pill>Play</Pill>.
            </li>
            <li>
              To choose voice/quality, go to <Link className="text-accent underline" to="/app/settings">Settings</Link> →{' '}
              <Pill>Text-to-Speech</Pill>.
            </li>
          </ol>
          <p>
            Tip: If you want the fastest “press play and go” experience, pick <Pill>Browser (Fast)</Pill>.
          </p>
        </Section>

        <Section title="Open software, free to use">
          <p>
            This is a <strong className="text-text-primary">fully open-source</strong> web app under the{' '}
            <strong className="text-text-primary">MIT License</strong>. You’re free to use it, share it, and build on it.
          </p>
          <p className="text-xs text-text-muted">
            License details: see the project’s <Pill>LICENSE</Pill> file.
          </p>
        </Section>

        <Section title="Privacy: everything stays on your device">
          <p>
            This app is designed to be <strong className="text-text-primary">local-first</strong>. Your imported books,
            generated audio, playback progress, bookmarks, and settings are stored in your browser’s local storage
            (IndexedDB) on this device.
          </p>
          <p>
            <strong className="text-text-primary">We don’t run accounts</strong>, and there’s no “upload your library”
            feature. Nothing is sent to a server for storage.
          </p>
          <p className="text-xs text-text-muted">
            Note: the app may download the TTS engine/model files (see below) so it can run locally; downloading is not
            the same thing as uploading your content.
          </p>
        </Section>

        <Section title="How text-to-speech works (modes + quality)">
          <div className="space-y-4">
            <div className="rounded-xl border border-border-muted bg-surface-0 p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill>Browser (Fast)</Pill>
                <Pill>Web Speech API</Pill>
                <Pill>Instant</Pill>
              </div>
              <p>
                Uses your device/browser’s built-in text-to-speech voices. It starts immediately (no model download),
                and it’s usually the best option for older phones or low battery.
              </p>
              <p className="text-xs text-text-muted">
                Quality varies a lot by device, OS, and browser. Some voices sound great; others sound robotic.
              </p>
            </div>

            <div className="rounded-xl border border-border-muted bg-surface-0 p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill>Kokoro (Best Quality)</Pill>
                <Pill>AI voice</Pill>
                <Pill>Runs locally</Pill>
              </div>
              <p>
                Uses a neural TTS model (Kokoro) inside a <strong className="text-text-primary">Web Worker</strong> so
                your UI stays responsive while audio is generated. The audio generation happens on your device.
              </p>
              <p>
                The first time you use it (or after clearing storage), the model must load.{' '}
                <strong className="text-text-primary">Loading time depends on your phone</strong>:
              </p>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <strong className="text-text-primary">Modern phones with WebGPU support</strong> (often Chrome/Edge on
                  Android) will generate audio much faster.
                </li>
                <li>
                  Without WebGPU, it falls back to a CPU/WASM path and can be{' '}
                  <strong className="text-text-primary">very slow</strong> on some devices.
                </li>
              </ul>
              <p className="text-xs text-text-muted">
                You can also tune Kokoro under <Pill>Model Quality</Pill> (q4/q8/fp16): higher quality generally uses
                more storage and more compute.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Install as an app">
          <p>
            EPUB Player works best when installed as a <strong className="text-text-primary">Progressive Web App (PWA)</strong>. 
            This gives you a full-screen experience, offline support, and lets you launch it from your home screen.
          </p>
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-border-muted bg-surface-0 p-4">
              <p className="mb-2 font-medium text-text-primary">📱 iPhone / iPad (Safari)</p>
              <ol className="list-inside list-decimal space-y-1 text-xs">
                <li>Tap the Share button (square with arrow)</li>
                <li>Scroll down and tap "Add to Home Screen"</li>
                <li>Tap "Add" to confirm</li>
              </ol>
            </div>
            <div className="rounded-xl border border-border-muted bg-surface-0 p-4">
              <p className="mb-2 font-medium text-text-primary">📱 Android (Chrome)</p>
              <ol className="list-inside list-decimal space-y-1 text-xs">
                <li>Tap the menu (⋮) in the top right</li>
                <li>Tap "Install app" or "Add to Home screen"</li>
                <li>Tap "Install" to confirm</li>
              </ol>
            </div>
            <div className="rounded-xl border border-border-muted bg-surface-0 p-4">
              <p className="mb-2 font-medium text-text-primary">💻 Desktop (Chrome/Edge)</p>
              <ol className="list-inside list-decimal space-y-1 text-xs">
                <li>Look for the install icon (⊕) in the address bar</li>
                <li>Or click menu → "Install EPUB Player"</li>
                <li>Click "Install" to confirm</li>
              </ol>
            </div>
          </div>
        </Section>

        <Section title="Storage + offline notes">
          <p>
            Generated audio is cached locally so replays are fast and offline. You can manage storage in{' '}
            <Link className="text-accent underline" to="/app/settings">Settings</Link> → <Pill>Storage</Pill>.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <strong className="text-text-primary">Clear All Audio</strong> deletes generated audio only (books remain).
            </li>
            <li>
              <strong className="text-text-primary">Clear All Data</strong> removes everything (books, audio, settings).
            </li>
          </ul>
        </Section>

        <Section title="Troubleshooting">
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-text-primary">Kokoro is slow</strong>: your device likely isn’t using WebGPU.
              Try Chrome/Edge on a newer device, or switch to <Pill>Browser (Fast)</Pill>.
            </li>
            <li>
              <strong className="text-text-primary">No voices show up in Browser mode</strong>: some browsers load voices
              asynchronously; try reopening Settings, or restart the browser.
            </li>
            <li>
              <strong className="text-text-primary">Running out of storage</strong>: reduce <Pill>Buffer Ahead</Pill>,
              lower <Pill>Model Quality</Pill>, or clear cached audio.
            </li>
          </ul>
        </Section>

        <div className="rounded-2xl bg-surface-1 p-5 text-sm text-text-secondary">
          <p>
            Looking for the legal/privacy details? See{' '}
            <Link className="text-accent underline" to="/app/terms">
              Terms & Privacy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}



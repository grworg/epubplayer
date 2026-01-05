/**
 * Accessibility Information Page
 * 
 * Documents accessibility features, keyboard shortcuts,
 * and supported assistive technologies.
 */

import { useNavigate } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { ChevronLeftIcon, KeyboardIcon } from '@/ui/icons'

const KEYBOARD_SHORTCUTS = [
  { key: 'Space', description: 'Play or pause playback' },
  { key: '← Arrow Left', description: 'Skip back (default: 30 seconds)' },
  { key: '→ Arrow Right', description: 'Skip forward (default: 30 seconds)' },
  { key: '[ Left Bracket', description: 'Go to previous chapter' },
  { key: '] Right Bracket', description: 'Go to next chapter' },
  { key: 'B', description: 'Add a bookmark at current position' },
  { key: 'P', description: 'Go to Now Playing page' },
  { key: '?', description: 'Show keyboard shortcuts help' },
  { key: 'Escape', description: 'Close dialogs or go back' },
]

const ASSISTIVE_TECH = [
  { name: 'VoiceOver', platform: 'macOS / iOS', status: 'Supported' },
  { name: 'NVDA', platform: 'Windows', status: 'Supported' },
  { name: 'JAWS', platform: 'Windows', status: 'Supported' },
  { name: 'TalkBack', platform: 'Android', status: 'Supported' },
]

export function AccessibilityPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={() => navigate(-1)}
          className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary"
          aria-label={t`Go back`}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold text-text-primary"><Trans>Accessibility</Trans></h1>
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-8 overflow-y-auto px-5 pb-8">
        {/* Intro */}
        <section>
          <p className="text-text-secondary">
            EPUB Player is designed to be accessible to everyone. As a text-to-speech app,
            we believe accessibility isn't optional — it's core to our mission.
          </p>
        </section>

        {/* Keyboard Shortcuts */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-primary">
            <KeyboardIcon className="h-5 w-5 text-accent" />
            Keyboard Shortcuts
          </h2>
          <div className="rounded-xl bg-surface-1 p-4">
            <p className="mb-4 text-sm text-text-secondary">
              Control playback without touching your mouse. Press <kbd className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">?</kbd> anywhere to see this list.
            </p>
            <div className="space-y-2">
              {KEYBOARD_SHORTCUTS.map((shortcut) => (
                <div key={shortcut.key} className="flex items-center justify-between py-1">
                  <span className="text-text-secondary">{shortcut.description}</span>
                  <kbd className="rounded bg-surface-3 px-2 py-1 font-mono text-sm text-text-primary">
                    {shortcut.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Screen Reader Support */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Screen Reader Support</h2>
          <div className="rounded-xl bg-surface-1 p-4">
            <p className="mb-4 text-sm text-text-secondary">
              EPUB Player is tested with the following screen readers:
            </p>
            <div className="space-y-2">
              {ASSISTIVE_TECH.map((tech) => (
                <div key={tech.name} className="flex items-center justify-between py-1">
                  <div>
                    <span className="font-medium text-text-primary">{tech.name}</span>
                    <span className="ml-2 text-sm text-text-muted">({tech.platform})</span>
                  </div>
                  <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success">
                    {tech.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Accessibility Features</h2>
          <div className="space-y-4 text-text-secondary">
            <Feature 
              title="Live Announcements"
              description="Playback status, chapter changes, and important events are announced to screen readers automatically."
            />
            <Feature 
              title="Focus Management"
              description="Dialogs and sheets trap focus appropriately and return focus when closed. Press Escape to close any dialog."
            />
            <Feature 
              title="Skip Link"
              description="Press Tab when the page loads to reveal a 'Skip to main content' link."
            />
            <Feature 
              title="Reduced Motion"
              description="Respects your system's 'prefers-reduced-motion' setting. Animations are disabled when this is enabled."
            />
            <Feature 
              title="High Contrast"
              description="Supports the 'prefers-contrast' media query for users who need higher contrast interfaces."
            />
            <Feature 
              title="Text-to-Speech"
              description="At its core, EPUB Player converts text to speech, making books accessible to users who prefer listening."
            />
            <Feature 
              title="Word Highlighting"
              description="The Lyrics view highlights the current word being spoken, helpful for users with dyslexia or learning disabilities."
            />
            <Feature 
              title="Adjustable Speed"
              description="Playback speed can be adjusted from 0.5x to 2x to match your listening preference."
            />
          </div>
        </section>

        {/* Known Limitations */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Known Limitations</h2>
          <div className="rounded-xl bg-surface-1 p-4">
            <ul className="list-inside list-disc space-y-2 text-sm text-text-secondary">
              <li>
                EPUB images have alt text only if provided by the original EPUB file.
              </li>
              <li>
                Complex tables and mathematical formulas in EPUBs may not be fully accessible.
              </li>
              <li>
                The P2P library transfer feature requires visual QR code scanning (manual code entry is available).
              </li>
            </ul>
          </div>
        </section>

        {/* Contact */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Feedback</h2>
          <p className="text-text-secondary">
            Found an accessibility issue? Please{' '}
            <a 
              href="https://github.com/grworg/epubplayer/issues/new?labels=accessibility"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover"
            >
              open an issue on GitHub
            </a>
            {' '}with details about your setup and the problem you encountered.
          </p>
        </section>
      </div>
    </div>
  )
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl bg-surface-1 p-4">
      <h3 className="font-medium text-text-primary">{title}</h3>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  )
}


import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import { HeadphonesIcon, UploadIcon, VolumeIcon, PlayIcon } from '@/ui/icons'

export function LandingPage() {
  useEffect(() => {
    document.title = 'EPUB Player — Turn Your EPUBs into Audiobooks'
  }, [])

  return (
    <div className="h-full overflow-y-auto scroll-smooth bg-surface-0 text-text-primary">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-surface-0 to-purple-900/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/10 via-transparent to-transparent" />
        
        {/* Floating decorative elements */}
        <div className="absolute left-10 top-20 h-64 w-64 rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute right-10 bottom-20 h-96 w-96 rounded-full bg-purple-500/5 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-16 text-center md:pb-32 md:pt-24">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-surface-1/80 px-4 py-2 text-sm text-text-secondary backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            100% Free &amp; Open Source
          </div>

          {/* Headline */}
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl">
            Your EPUBs,{' '}
            <span className="bg-gradient-to-r from-accent via-purple-400 to-accent bg-clip-text text-transparent">
              Brought to Life
            </span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mb-10 max-w-2xl text-lg text-text-secondary md:text-xl">
            A beautiful audiobook player that transforms your EPUBs into listenable books with AI voices. 
            Full player controls, bookmarks, sleep timer — everything runs locally on your device.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/app"
              className="pressable flex items-center gap-3 rounded-full bg-accent px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-accent/30 transition-all hover:shadow-xl hover:shadow-accent/40"
            >
              <PlayIcon className="h-5 w-5" />
              Open App
            </Link>
            <a
              href="#how-it-works"
              className="pressable flex items-center gap-2 rounded-full bg-surface-1 px-8 py-4 text-lg font-medium text-text-primary transition-colors hover:bg-surface-2"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* What It Is - Feature Grid */}
      <section className="border-t border-border-muted bg-surface-1/50 py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">
            Your Books, Your Player
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-text-secondary">
            A full audiobook player built with love for readers who want to listen. No strings attached.
          </p>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<span className="text-2xl">💸</span>}
              title="100% Free, Forever"
              description="No subscriptions, no premium tiers, no hidden costs. This is a labor of love."
            />
            <FeatureCard
              icon={<span className="text-2xl">🔒</span>}
              title="No Accounts"
              description="No sign-ups, no passwords, no email harvesting. Just open and use."
            />
            <FeatureCard
              icon={<span className="text-2xl">📱</span>}
              title="Runs on Your Device"
              description="All processing happens locally. Your books never leave your device."
            />
            <FeatureCard
              icon={<span className="text-2xl">📚</span>}
              title="Bring Your EPUBs"
              description="Import any EPUB you own. Your library, your rules."
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 md:py-28 scroll-mt-8">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-text-secondary">
            Three simple steps to turn your ebooks into audiobooks.
          </p>

          <div className="grid gap-8 md:grid-cols-3">
            <StepCard
              number="1"
              icon={<UploadIcon className="h-8 w-8" />}
              title="Import Your EPUB"
              description="Drop in any EPUB file from your collection. It's stored locally in your browser."
            />
            <StepCard
              number="2"
              icon={<VolumeIcon className="h-8 w-8" />}
              title="Choose a Voice"
              description="Pick from your device's built-in voices for instant playback, or use Kokoro AI for studio-quality narration."
            />
            <StepCard
              number="3"
              icon={<HeadphonesIcon className="h-8 w-8" />}
              title="Listen & Enjoy"
              description="Full audiobook player with speed control, bookmarks, sleep timer, and chapter navigation. Works offline."
            />
          </div>

          <div className="mt-16 rounded-2xl bg-surface-1 p-8 text-center">
            <p className="text-lg text-text-secondary">
              <strong className="text-text-primary">Your device does the work.</strong>{' '}
              The AI runs entirely in your browser using WebGPU or your CPU. 
              Nothing is sent to external servers for processing.
            </p>
          </div>
        </div>
      </section>

      {/* Player Features */}
      <section className="border-t border-border-muted bg-surface-1/50 py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">
            A Real Audiobook Experience
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-text-secondary">
            Not just a converter — a full-featured player designed for long listening sessions.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PlayerFeature
              icon="⏯️"
              title="Intuitive Playback"
              description="Play, pause, skip forward/back with controls designed for audiobooks"
            />
            <PlayerFeature
              icon="🎚️"
              title="Speed Control"
              description="Listen at 0.5× to 2× speed — find your perfect pace"
            />
            <PlayerFeature
              icon="🌙"
              title="Sleep Timer"
              description="Fall asleep listening without losing your place"
            />
            <PlayerFeature
              icon="🔖"
              title="Bookmarks"
              description="Mark favorite passages and jump back to them anytime"
            />
            <PlayerFeature
              icon="📑"
              title="Chapter Navigation"
              description="Jump between chapters with a tap"
            />
            <PlayerFeature
              icon="💾"
              title="Auto-Save Progress"
              description="Pick up exactly where you left off, every time"
            />
            <PlayerFeature
              icon="📴"
              title="Works Offline"
              description="Listen anywhere — no internet needed after setup"
            />
            <PlayerFeature
              icon="📱"
              title="Mobile-First Design"
              description="Beautiful on your phone, great on desktop too"
            />
            <PlayerFeature
              icon="✨"
              title="Lyrics Mode"
              description="Follow along with the text as you listen"
            />
          </div>
        </div>
      </section>

      {/* Storage & Processing */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">
            Local-First Architecture
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-text-secondary">
            Everything stays on your device. Here's what that means.
          </p>

          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl bg-surface-1 p-6 md:p-8">
              <h3 className="mb-4 text-xl font-semibold">📦 Storage</h3>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span>Your imported EPUBs live in your browser's IndexedDB</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span>Generated audio is cached locally for instant replay</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span>Playback progress, bookmarks, and settings — all local</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span>Clear your data anytime from Settings</span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl bg-surface-1 p-6 md:p-8">
              <h3 className="mb-4 text-xl font-semibold">⚡ Processing</h3>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-purple-400" />
                  <span><strong className="text-text-primary">Browser TTS:</strong> Uses your device's built-in voices — instant, no download</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-purple-400" />
                  <span><strong className="text-text-primary">Kokoro AI:</strong> Neural TTS with natural-sounding voices, runs via WebGPU or WASM</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-purple-400" />
                  <span>AI models download once, then work offline forever</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-purple-400" />
                  <span>Modern phones with WebGPU get blazing fast generation</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Install as App */}
      <section className="border-t border-border-muted bg-surface-1/50 py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">
            Install for the Best Experience
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-text-secondary">
            Add EPUB Player to your home screen for offline access, faster loading, and a full-screen experience.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            <InstallCard
              icon="📱"
              platform="iPhone / iPad"
              steps={[
                'Open in Safari',
                'Tap Share (□↑)',
                '"Add to Home Screen"',
              ]}
            />
            <InstallCard
              icon="📱"
              platform="Android"
              steps={[
                'Open in Chrome',
                'Tap menu (⋮)',
                '"Install app"',
              ]}
            />
            <InstallCard
              icon="💻"
              platform="Desktop"
              steps={[
                'Look for ⊕ in address bar',
                'Or menu → Install',
                'Click "Install"',
              ]}
            />
          </div>
        </div>
      </section>

      {/* Credits */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <div className="mb-8 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-500/20">
            <span className="text-3xl">💜</span>
          </div>
          
          <h2 className="mb-4 text-3xl font-bold md:text-4xl">
            Built With Love
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-text-secondary">
            This project wouldn't be possible without the incredible work of the open-source community.
          </p>

          <div className="mb-12 grid gap-6 md:grid-cols-2">
            <CreditCard
              name="Kokoro TTS"
              description="Beautiful, natural-sounding neural text-to-speech that runs entirely in the browser."
              link="https://github.com/hexgrad/kokoro"
              linkText="View on GitHub"
            />
            <CreditCard
              name="Piper TTS"
              description="Fast, local neural text-to-speech engine that powers offline voice synthesis."
              link="https://github.com/rhasspy/piper"
              linkText="View on GitHub"
            />
          </div>

          <p className="text-text-secondary">
            EPUB Player is open source under the{' '}
            <strong className="text-text-primary">MIT License</strong>.{' '}
            <a 
              href="https://github.com/grworg/epubplayer" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              View the source code →
            </a>
          </p>
        </div>
      </section>

      {/* Support / Donate */}
      <section className="border-t border-border-muted bg-gradient-to-b from-surface-1/50 to-surface-0 py-20 md:py-28">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <div className="mb-8 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20">
            <span className="text-3xl">☕</span>
          </div>

          <h2 className="mb-4 text-3xl font-bold md:text-4xl">
            Support the Project
          </h2>
          <p className="mb-8 text-text-secondary">
            EPUB Player is free and always will be. If it's brought joy to your reading life 
            and you'd like to support continued development, a coffee would mean the world.
          </p>

          <a
            href="https://buymeacoffee.com"
            target="_blank"
            rel="noopener noreferrer"
            className="pressable inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:shadow-xl"
          >
            <span className="text-xl">☕</span>
            Buy Me a Coffee
          </a>

          <p className="mt-6 text-sm text-text-muted">
            No pressure — using and sharing the app is support enough!
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="mb-6 text-3xl font-bold md:text-4xl">
            Ready to Listen?
          </h2>
          <p className="mb-8 text-lg text-text-secondary">
            Import your first book and start your audiobook journey. 
            Your library, your pace, your way.
          </p>
          <Link
            to="/app"
            className="pressable inline-flex items-center gap-3 rounded-full bg-accent px-10 py-5 text-xl font-semibold text-white shadow-lg shadow-accent/30 transition-all hover:shadow-xl hover:shadow-accent/40"
          >
            <HeadphonesIcon className="h-6 w-6" />
            Open EPUB Player
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-muted py-12">
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2 text-text-secondary">
              <HeadphonesIcon className="h-5 w-5 text-accent" />
              <span className="font-medium">EPUB Player</span>
            </div>

            <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-text-secondary">
              <Link to="/app" className="hover:text-text-primary transition-colors">
                Open App
              </Link>
              <Link to="/app/help" className="hover:text-text-primary transition-colors">
                Help
              </Link>
              <Link to="/app/terms" className="hover:text-text-primary transition-colors">
                Terms &amp; Privacy
              </Link>
              <a 
                href="https://github.com/grworg/epubplayer" 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:text-text-primary transition-colors"
              >
                GitHub
              </a>
            </nav>

            <p className="text-sm text-text-muted">
              Made with 🎧 for audiobook lovers
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode
  title: string
  description: string 
}) {
  return (
    <div className="rounded-2xl bg-surface-1 p-6 transition-colors hover:bg-surface-2">
      <div className="mb-4">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  )
}

function StepCard({
  number,
  icon,
  title,
  description,
}: {
  number: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="relative rounded-2xl bg-surface-1 p-6 md:p-8">
      {/* Step number */}
      <div className="absolute -top-4 left-6 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-white shadow-lg">
        {number}
      </div>
      
      <div className="mb-4 mt-2 text-accent">{icon}</div>
      <h3 className="mb-2 text-xl font-semibold">{title}</h3>
      <p className="text-text-secondary">{description}</p>
    </div>
  )
}

function PlayerFeature({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl bg-surface-1 p-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <h3 className="font-semibold text-text-primary">{title}</h3>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
    </div>
  )
}

function InstallCard({
  icon,
  platform,
  steps,
}: {
  icon: string
  platform: string
  steps: string[]
}) {
  return (
    <div className="rounded-2xl bg-surface-1 p-6">
      <div className="mb-3 text-3xl">{icon}</div>
      <h3 className="mb-3 text-lg font-semibold text-text-primary">{platform}</h3>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

function CreditCard({
  name,
  description,
  link,
  linkText,
}: {
  name: string
  description: string
  link: string
  linkText: string
}) {
  return (
    <div className="rounded-2xl bg-surface-1 p-6 text-left md:p-8">
      <h3 className="mb-2 text-xl font-semibold">{name}</h3>
      <p className="mb-4 text-text-secondary">{description}</p>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-accent hover:underline"
      >
        {linkText}
        <span aria-hidden="true">→</span>
      </a>
    </div>
  )
}


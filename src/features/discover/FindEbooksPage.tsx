import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { ChevronLeftIcon } from '@/ui/icons'

// ============================================================================
// Types
// ============================================================================

interface EbookSource {
  name: string
  url: string
  description: string
  highlight?: string // A standout feature
}

interface SourceCategory {
  title: string
  description: string
  emoji: string
  sources: EbookSource[]
}

// ============================================================================
// Data
// ============================================================================

function getEbookSources(): SourceCategory[] {
  return [
    {
      title: t`Free Public Domain Books`,
      description: t`Classic literature, out-of-copyright works, and openly licensed content — all completely free.`,
      emoji: '📚',
      sources: [
        {
          name: 'Project Gutenberg',
          url: 'https://www.gutenberg.org',
          description: t`The original free ebook library. Over 70,000 free ebooks, including classics like Pride and Prejudice, Moby Dick, and The Adventures of Sherlock Holmes.`,
          highlight: t`70,000+ free books`,
        },
        {
          name: 'Standard Ebooks',
          url: 'https://standardebooks.org',
          description: t`Beautifully formatted editions of public domain books. Each ebook is carefully typeset with professional covers and modernized punctuation.`,
          highlight: t`Best formatting`,
        },
        {
          name: 'Open Library',
          url: 'https://openlibrary.org',
          description: t`Part of the Internet Archive. Offers free borrowing of millions of books, plus unlimited access to public domain titles.`,
          highlight: t`Borrow modern books free`,
        },
        {
          name: 'Feedbooks Public Domain',
          url: 'https://www.feedbooks.com/catalog/public_domain',
          description: t`A curated collection of public domain classics, well-organized by genre and popularity.`,
          highlight: t`Great discovery`,
        },
        {
          name: 'ManyBooks',
          url: 'https://manybooks.net',
          description: t`Over 50,000 free ebooks. Includes both public domain classics and free contemporary titles from indie authors.`,
          highlight: t`Indie + classics mix`,
        },
      ],
    },
    {
      title: t`DRM-Free Bookstores`,
      description: t`Buy books you actually own — no DRM means you can read them in any app, on any device, forever.`,
      emoji: '🔓',
      sources: [
        {
          name: 'Smashwords',
          url: 'https://www.smashwords.com',
          description: t`The largest indie ebook distributor. All books are DRM-free. Great for discovering new authors and supporting independent writers directly.`,
          highlight: t`Supports indie authors`,
        },
        {
          name: 'Tor.com Ebooks',
          url: 'https://www.tor.com/ebooks/',
          description: t`Major sci-fi/fantasy publisher that sells all ebooks DRM-free. A rare example of a big publisher doing the right thing.`,
          highlight: t`Major publisher, DRM-free`,
        },
        {
          name: 'Weightless Books',
          url: 'https://weightlessbooks.com',
          description: t`Curated DRM-free speculative fiction. Focuses on science fiction, fantasy, and horror from quality indie publishers.`,
          highlight: t`Curated sci-fi/fantasy`,
        },
        {
          name: 'Google Play Books',
          url: 'https://play.google.com/store/books',
          description: t`Large selection with many titles available for EPUB download. Check each book — if it has an "Export" option, you can download the EPUB.`,
          highlight: t`Wide selection`,
        },
        {
          name: 'Kobo',
          url: 'https://www.kobo.com',
          description: t`Major ebook retailer with DRM-free options when publishers allow. Look for the "DRM-Free" badge or download via Adobe Digital Editions.`,
          highlight: t`Check for DRM-free badge`,
        },
      ],
    },
    {
      title: t`Buy Direct from Authors`,
      description: t`The most ethical option — authors keep more of the sale price when you buy directly from them.`,
      emoji: '✍️',
      sources: [
        {
          name: t`Author Websites`,
          url: 'https://www.patreon.com',
          description: t`Many authors sell directly from their websites or Patreon. Search for "[author name] buy ebook direct" — you'd be surprised how many offer this.`,
          highlight: t`Authors keep ~95% vs ~30%`,
        },
        {
          name: 'Gumroad',
          url: 'https://gumroad.com',
          description: t`Popular platform for creators selling directly. Many authors and publishers use it for DRM-free ebook sales.`,
          highlight: t`Creator-friendly platform`,
        },
        {
          name: 'Itch.io',
          url: 'https://itch.io/books',
          description: t`Originally for indie games, now hosts books too. Great for finding unique, experimental, and indie publications.`,
          highlight: t`Indie + experimental`,
        },
      ],
    },
  ]
}

// ============================================================================
// Components
// ============================================================================

function SourceCard({ source }: { source: EbookSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="pressable group block rounded-xl border border-border-muted bg-surface-0 p-4 transition-all hover:border-accent/50 hover:bg-surface-1"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="font-semibold text-text-primary group-hover:text-accent">
          {source.name}
          <span className="ml-1.5 text-text-muted transition-transform group-hover:translate-x-0.5">→</span>
        </h4>
        {source.highlight && (
          <span className="flex-shrink-0 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
            {source.highlight}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-text-secondary">
        {source.description}
      </p>
    </a>
  )
}

function CategorySection({ category }: { category: SourceCategory }) {
  return (
    <section className="rounded-2xl bg-surface-1 p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-2xl">{category.emoji}</span>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{category.title}</h2>
          <p className="text-sm text-text-secondary">{category.description}</p>
        </div>
      </div>
      <div className="space-y-3">
        {category.sources.map((source) => (
          <SourceCard key={source.name} source={source} />
        ))}
      </div>
    </section>
  )
}

// ============================================================================
// Page
// ============================================================================

export function FindEbooksPage() {
  const navigate = useNavigate()
  const ebookSources = getEbookSources()

  useEffect(() => {
    const prev = document.title
    document.title = t`Find Ebooks — EPUB Player`
    return () => {
      document.title = prev
    }
  }, [])

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
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-text-primary">
            <Trans>Find Ebooks</Trans>
          </h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            <Trans>Discover where to get EPUBs — free classics, DRM-free stores, and more.</Trans>
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-5 pb-8">
        {/* Intro note */}
        <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            <strong className="text-text-primary"><Trans>Why these sources?</Trans></strong>{' '}
            <Trans>
              We've curated options that respect readers: public domain works are free, DRM-free stores let you actually own your books, and buying direct from authors supports creators fairly. All of these provide standard EPUB files that work great with this app.
            </Trans>
          </p>
        </div>

        {/* Categories */}
        {ebookSources.map((category) => (
          <CategorySection key={category.title} category={category} />
        ))}

        {/* Footer note */}
        <div className="rounded-2xl bg-surface-1 p-5 text-sm text-text-secondary">
          <p className="mb-2">
            <strong className="text-text-primary"><Trans>💡 Tip:</Trans></strong>{' '}
            <Trans>
              When downloading, look for the <strong className="text-text-primary">EPUB</strong> format (not Kindle/MOBI or PDF). EPUBs work best for text-to-speech since they're reflowable text.
            </Trans>
          </p>
          <p className="text-text-muted">
            <Trans>Know another great source? This app is open source — feel free to suggest additions!</Trans>
          </p>
        </div>
      </div>
    </div>
  )
}


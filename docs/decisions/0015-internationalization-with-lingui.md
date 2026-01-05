# Internationalization with Lingui

- **Status**: Accepted
- **Date**: 2026-01-05
- **Deciders**: Development team

## Context

EPUB Player aims to be accessible to a global audience. As a text-to-speech application, we serve users who may prefer to consume content in their native language, including:

- Users with visual impairments worldwide
- Non-English speaking book lovers
- Users with dyslexia or other reading difficulties in various countries

Currently, all UI strings are hardcoded in English. To maximize reach and provide a professional experience, we need internationalization (i18n) support.

### Requirements

1. **Performance**: Minimal bundle size impact (PWA with offline support)
2. **Developer Experience**: Easy to use, minimal boilerplate, good tooling
3. **Professional Quality**: Support for pluralization, gender, dates, numbers
4. **Type Safety**: Catch missing translations at build time
5. **Translator-Friendly**: Standard format that professional translators know
6. **Vite Compatible**: First-class support for our build tool
7. **React 19 Compatible**: Must work with latest React

### Initial Target Languages

Phase 1:
- English (en) - default
- Spanish (es) - 500M+ speakers
- French (fr) - 300M+ speakers  
- German (de) - 100M+ speakers
- Portuguese (pt) - 250M+ speakers
- Chinese Simplified (zh-CN) - 1B+ speakers

Phase 2:
- Japanese (ja)
- Korean (ko)
- Italian (it)
- Dutch (nl)
- Arabic (ar) - RTL support
- Hindi (hi)

## Decision

We will use **Lingui** (https://lingui.dev) for internationalization.

### Why Lingui?

```
┌─────────────────────────────────────────────────────────────────┐
│                     i18n Library Comparison                      │
├──────────────────┬────────────┬──────────┬──────────┬───────────┤
│ Criteria         │ Lingui     │ i18next  │ FormatJS │ Paraglide │
├──────────────────┼────────────┼──────────┼──────────┼───────────┤
│ Runtime Size     │ ~3KB       │ ~15KB    │ ~12KB    │ <1KB      │
│ Message Format   │ ICU        │ Custom   │ ICU      │ Custom    │
│ Extraction       │ Automatic  │ Manual   │ Manual   │ Automatic │
│ Type Safety      │ ✓          │ Plugin   │ Plugin   │ ✓✓        │
│ Vite Support     │ ✓✓         │ ✓        │ ✓        │ ✓✓        │
│ Maturity         │ High       │ Highest  │ High     │ Medium    │
│ Translator UX    │ Excellent  │ Good     │ Excellent│ Good      │
│ React 19         │ ✓          │ ✓        │ ✓        │ ✓         │
└──────────────────┴────────────┴──────────┴──────────┴───────────┘
```

**Lingui wins because:**

1. **Small Runtime (~3KB gzipped)**: Critical for our PWA. i18next adds 15KB+.

2. **ICU MessageFormat**: Industry standard that professional translators know:
   ```
   {count, plural,
     =0 {No books}
     one {# book}
     other {# books}
   }
   ```

3. **Automatic Message Extraction**: No manual string cataloging:
   ```tsx
   // Just write this:
   <Trans>Welcome to EPUB Player</Trans>
   
   // Lingui extracts it automatically via CLI
   ```

4. **Macro-Based with Compile-Time Optimization**:
   ```tsx
   import { t, Trans, Plural } from '@lingui/macro'
   
   // Compiles to optimized runtime code
   const title = t`Playback Speed`
   ```

5. **Excellent TypeScript Support**: Catches missing translations at build time.

6. **First-Class Vite Support**: Official `@lingui/vite-plugin`.

### Architecture

```
src/
├── locales/
│   ├── en/
│   │   └── messages.po          # English (source)
│   ├── es/
│   │   └── messages.po          # Spanish
│   ├── fr/
│   │   └── messages.po          # French
│   └── ...
├── i18n.ts                       # Lingui configuration
└── features/
    └── */
        └── *.tsx                 # Components use <Trans>, t``
```

### Implementation Pattern

#### 1. Setup (`src/i18n.ts`)

```typescript
import { i18n } from '@lingui/core'
import { detect, fromNavigator, fromStorage } from '@lingui/detect-locale'

export const locales = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português',
  'zh-CN': '简体中文',
}

export const defaultLocale = 'en'

// Detect user's preferred locale
export function detectLocale(): string {
  const detected = detect(
    fromStorage('locale'),      // Check localStorage first
    fromNavigator(),            // Then browser settings
    () => defaultLocale         // Fallback
  )
  return detected in locales ? detected : defaultLocale
}

// Dynamic import for code splitting
export async function loadCatalog(locale: string) {
  const { messages } = await import(`./locales/${locale}/messages.po`)
  i18n.load(locale, messages)
  i18n.activate(locale)
}
```

#### 2. Provider Setup (`src/App.tsx`)

```tsx
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { useEffect, useState } from 'react'
import { detectLocale, loadCatalog } from './i18n'

function I18nLoader({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  
  useEffect(() => {
    const locale = detectLocale()
    loadCatalog(locale).then(() => setLoaded(true))
  }, [])
  
  if (!loaded) return null // Or loading skeleton
  
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}
```

#### 3. Usage in Components

```tsx
import { Trans, t, Plural } from '@lingui/macro'
import { useLingui } from '@lingui/react'

function LibraryPage() {
  const { i18n } = useLingui()
  
  return (
    <div>
      {/* Simple text */}
      <h1><Trans>Library</Trans></h1>
      
      {/* With variables */}
      <p><Trans>Welcome back, {userName}</Trans></p>
      
      {/* Pluralization */}
      <Plural
        value={bookCount}
        zero="No books yet"
        one="# book"
        other="# books"
      />
      
      {/* In attributes (aria-label, title, etc.) */}
      <button aria-label={t`Play`}>
        <PlayIcon />
      </button>
      
      {/* Date/number formatting */}
      <span>{i18n.date(date, { dateStyle: 'medium' })}</span>
      <span>{i18n.number(progress, { style: 'percent' })}</span>
    </div>
  )
}
```

#### 4. Extraction & Compilation

```bash
# Extract messages from source code
npm run i18n:extract

# After translators update .po files, compile to JS
npm run i18n:compile
```

### File Format: PO/POT

We use the industry-standard **PO (Portable Object)** format:

```po
#: src/features/library/LibraryPage.tsx:42
msgid "Library"
msgstr "Biblioteca"

#: src/features/player/NowPlayingPage.tsx:88
msgid "{count, plural, =0 {No bookmarks} one {# bookmark} other {# bookmarks}}"
msgstr "{count, plural, =0 {Sin marcadores} one {# marcador} other {# marcadores}}"
```

**Why PO format:**
- Supported by every translation tool (Crowdin, Phrase, Lokalise, POEdit)
- Includes source location for context
- Human-readable for review
- Git-friendly (text-based diffs)

### Translation Workflow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Developer   │     │  Translator  │     │   CI/CD      │
│  writes code │────▶│  translates  │────▶│   compiles   │
│  with Trans  │     │  .po files   │     │   & deploys  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
   npm run             Crowdin/POEdit      npm run build
   i18n:extract        or GitHub PR        (auto-compiles)
```

### TTS Voice Considerations

Different TTS engines support different languages. We need to:

1. **Filter available voices by language**: Show only voices that match the UI language or book language
2. **Warn users**: If their preferred voice doesn't support a book's language
3. **Store language preference**: Per-book language override in IndexedDB

```typescript
// Example: Voice filtering
function getVoicesForLanguage(lang: string): Voice[] {
  return allVoices.filter(voice => 
    voice.supportedLanguages.includes(lang)
  )
}
```

### RTL (Right-to-Left) Support

For Arabic, Hebrew, etc., we need:

```css
/* Add to index.css */
[dir="rtl"] {
  /* Flip horizontal margins/paddings */
  --space-start: var(--space-right);
  --space-end: var(--space-left);
}
```

```tsx
// In App.tsx
<html lang={locale} dir={isRTL(locale) ? 'rtl' : 'ltr'}>
```

### Settings Integration

Add language selector to Settings page:

```tsx
// In SettingsPage.tsx
<SettingsItem
  icon={<GlobeIcon />}
  label={t`Language`}
  value={locales[currentLocale]}
  onClick={() => setActiveSheet('language')}
/>
```

## Consequences

### Positive

1. **Global Reach**: Access to billions of non-English speakers
2. **Professional Quality**: ICU format handles complex linguistic rules
3. **Fast Performance**: 3KB runtime, lazy-loaded catalogs
4. **Great DX**: Macros extract strings automatically, TypeScript catches errors
5. **Maintainable**: PO format is industry standard, easy to manage
6. **Future-Proof**: Can add languages without code changes

### Negative

1. **Initial Effort**: Need to wrap all 200+ strings with `<Trans>` or `t``
2. **Build Complexity**: Adds extraction/compilation steps
3. **Translation Cost**: Professional translation for 6 languages (~$2-5K)
4. **Ongoing Maintenance**: New features need translation before release
5. **Bundle Size**: +3KB runtime + ~5-20KB per language catalog

### Neutral

1. **Changed workflow**: Developers must use macros for all user-facing text
2. **PR process**: May want translation review before merge
3. **Release process**: Coordinate with translators for major releases

## Alternatives Considered

### Alternative 1: react-i18next

The most popular React i18n library.

**Pros:**
- Largest community, most plugins
- Battle-tested at massive scale
- Excellent documentation

**Rejected because:**
- 15KB+ runtime (5x larger than Lingui)
- Manual key management (error-prone)
- JSON format less translator-friendly than PO

### Alternative 2: FormatJS (react-intl)

From Yahoo/Meta, powers many large apps.

**Pros:**
- ICU MessageFormat (same as Lingui)
- Excellent date/number formatting
- Large company backing

**Rejected because:**
- 12KB+ runtime
- More verbose API
- Manual message extraction
- Less active development recently

### Alternative 3: Paraglide (Inlang)

Newest approach, compile-time i18n.

**Pros:**
- Smallest runtime (<1KB)
- Fully type-safe
- Tree-shakes unused messages

**Rejected because:**
- Younger project, smaller community
- Less tooling ecosystem
- Custom message format (not ICU)
- Fewer translation tool integrations

### Alternative 4: No Library (DIY)

Build a simple translation system ourselves.

**Rejected because:**
- Pluralization rules are complex (Slavic languages have 4 plural forms!)
- Gender agreement varies by language
- Date/number formatting is non-trivial
- Would reinvent the wheel poorly

## Implementation Plan

### Phase 1: Infrastructure ✅ COMPLETE
- [x] Install Lingui dependencies
- [x] Configure Vite plugin
- [x] Set up locale detection (from settings or navigator)
- [x] Create language selector in Settings
- [x] Add scripts to package.json (`i18n:extract`, `i18n:compile`)

### Phase 2: String Extraction ✅ COMPLETE
- [x] Wrap all strings in `<Trans>` / `t`` (317 messages extracted)
- [x] Run extraction to generate locale catalogs
- [ ] Set up CI to validate extraction

### Phase 3: Translation (Pending)
- [ ] Set up Crowdin or similar platform
- [ ] Commission translations for Phase 1 languages
- [ ] Review and iterate with native speakers

### Phase 4: Polish (Pending)
- [ ] Add RTL support for Arabic
- [ ] Test on various devices
- [ ] Add language-specific TTS voice filtering
- [ ] Performance testing with all locales loaded

## References

- [Lingui Documentation](https://lingui.dev)
- [ICU Message Format](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
- [PO File Format](https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html)
- [Crowdin for Open Source](https://crowdin.com/page/open-source-project-setup-request)
- [CLDR Plural Rules](https://cldr.unicode.org/index/cldr-spec/plural-rules)


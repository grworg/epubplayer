import { i18n } from '@lingui/core'
import { settingsRepository } from '@/services/storage/settingsRepository'

// Supported locales with their display names
export const locales = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  zh: '中文',
} as const

export type Locale = keyof typeof locales

export const defaultLocale: Locale = 'en'

/**
 * Check if a string is a valid locale
 */
export function isValidLocale(locale: string): locale is Locale {
  return locale in locales
}

/**
 * Detect the user's preferred locale
 * Priority: stored setting > navigator language > default
 */
export async function detectLocale(): Promise<Locale> {
  // Check stored setting first
  const storedLocale = (await settingsRepository.get('locale')) as string
  console.log('[i18n] Stored locale:', storedLocale)
  if (storedLocale && isValidLocale(storedLocale)) {
    console.log('[i18n] Using stored locale:', storedLocale)
    return storedLocale
  }

  // Try navigator languages
  console.log('[i18n] Navigator languages:', navigator.languages)
  if (typeof navigator !== 'undefined' && navigator.languages) {
    for (const lang of navigator.languages) {
      // Check exact match first (e.g., 'en-US' -> 'en')
      const primary = lang.split('-')[0].toLowerCase()
      console.log('[i18n] Checking language:', lang, '-> primary:', primary, 'valid:', isValidLocale(primary))
      if (isValidLocale(primary)) {
        console.log('[i18n] Detected locale from browser:', primary)
        return primary
      }
    }
  }

  // Fallback to default
  console.log('[i18n] Falling back to default:', defaultLocale)
  return defaultLocale
}

/**
 * Dynamically load a locale's message catalog
 */
async function loadCatalog(locale: Locale): Promise<void> {
  // Dynamic imports for code-splitting
  const catalog = await import(`./locales/${locale}/messages.ts`)
  i18n.load(locale, catalog.messages)
}

/**
 * Activate a locale (load catalog and set as active)
 */
export async function activateLocale(locale: Locale): Promise<void> {
  // Load the catalog if not already loaded
  const loadedLocales = i18n.locales || []
  if (!loadedLocales.includes(locale)) {
    await loadCatalog(locale)
  }
  
  i18n.activate(locale)
  
  // Update the HTML lang attribute
  document.documentElement.lang = locale
  
  // Update direction for RTL languages (future: Arabic, Hebrew)
  const rtlLocales: string[] = [] // Add 'ar', 'he' when supported
  document.documentElement.dir = rtlLocales.includes(locale) ? 'rtl' : 'ltr'
}

/**
 * Initialize i18n with the detected/stored locale
 */
export async function initI18n(): Promise<Locale> {
  console.log('[i18n] Initializing...')
  const locale = await detectLocale()
  console.log('[i18n] Activating locale:', locale)
  await activateLocale(locale)
  console.log('[i18n] Activated! Current locale:', i18n.locale)
  return locale
}

/**
 * Change the active locale and persist the preference
 */
export async function changeLocale(locale: Locale): Promise<void> {
  await settingsRepository.set('locale', locale)
  await activateLocale(locale)
}

/**
 * Get the currently active locale
 */
export function getActiveLocale(): Locale {
  const active = i18n.locale
  return isValidLocale(active) ? active : defaultLocale
}

// Re-export the i18n instance for components that need it directly
export { i18n }


import ePub, { type Book as EPubBook, type NavItem } from 'epubjs'
import { createLogger } from '@/services/logging'
import { hashText, sectionId } from '@/services/storage/db'
import type { Book, Section } from '@/services/storage/db'

const log = createLogger('epub')

// ============================================================================
// Types
// ============================================================================

export interface ParsedEPUB {
  book: Omit<Book, 'addedAt' | 'lastPlayedAt'>
  sections: Section[]
}

export interface TOCItem {
  title: string
  href: string
  sectionIndex: number
  children?: TOCItem[]
}

// ============================================================================
// EPUB Parser
// ============================================================================

/**
 * Parse an EPUB file and extract metadata, cover, and sections
 */
export async function parseEPUB(file: File): Promise<ParsedEPUB> {
  log.info('Starting EPUB parse', { filename: file.name })

  const arrayBuffer = await file.arrayBuffer()
  const epub = ePub(arrayBuffer)

  // Wait for the book to be ready
  await epub.ready
  log.debug('EPUB book ready')

  // Extract metadata
  const metadata = await extractMetadata(epub)
  log.debug('Metadata extracted', { title: metadata.title, author: metadata.author })

  const coverBlob = await extractCover(epub)
  log.debug('Cover extracted', { hasCover: !!coverBlob })

  // Extract spine items (sections)
  const sections = await extractSections(epub, metadata.id)
  log.info('EPUB parsed', { title: metadata.title, sections: sections.length })

  const book: Omit<Book, 'addedAt' | 'lastPlayedAt'> = {
    id: metadata.id,
    title: metadata.title,
    author: metadata.author,
    coverBlob,
    language: metadata.language,
    publisher: metadata.publisher,
    description: metadata.description,
    totalSections: sections.length,
  }

  // Clean up
  epub.destroy()

  return { book, sections }
}

/**
 * Extract metadata from EPUB
 */
async function extractMetadata(epub: EPubBook) {
  const meta = epub.packaging.metadata

  // Generate a unique ID based on identifiers or title+author
  const identifier = meta.identifier || `${meta.title}-${meta.creator}`
  const id = await hashText(identifier)

  return {
    id,
    title: meta.title || 'Untitled',
    author: meta.creator || 'Unknown Author',
    language: meta.language,
    publisher: meta.publisher,
    description: meta.description,
  }
}

/**
 * Extract cover image from EPUB
 */
async function extractCover(epub: EPubBook): Promise<Blob | undefined> {
  try {
    // Try to get the cover URL
    const coverUrl = await epub.coverUrl()
    if (!coverUrl) return undefined

    // Fetch the cover image
    const response = await fetch(coverUrl)
    if (!response.ok) return undefined

    return await response.blob()
  } catch (error) {
    log.warn('Failed to extract cover', error)
    return undefined
  }
}

/**
 * Extract sections (spine items) from EPUB
 */
async function extractSections(epub: EPubBook, bookId: string): Promise<Section[]> {
  const sections: Section[] = []
  const spine = epub.spine

  // Get navigation (TOC) for section titles
  const navigation = epub.navigation
  const tocMap = buildTocMap(navigation?.toc || [])

  // Access spine items
  const spineItems = (spine as unknown as { items: Array<{ href: string; index: number }> }).items
  if (!spineItems || spineItems.length === 0) {
    log.warn('No spine items found in EPUB')
    return sections
  }

  log.debug('Processing spine items', { count: spineItems.length })

  for (let i = 0; i < spineItems.length; i++) {
    const item = spineItems[i]

    try {
      // Get the section from spine
      const section = spine.get(item.href) || spine.get(i)
      if (!section) {
        log.warn('Could not get section', { index: i })
        continue
      }

      // Load the section - this populates section.document
      const sectionObj = section as unknown as {
        load: (loader: (url: string) => Promise<unknown>) => Promise<unknown>
        document?: Document
      }

      await sectionObj.load(epub.load.bind(epub))

      // Get text content from the loaded document
      const doc = sectionObj.document
      if (!doc) {
        log.warn('Section has no document after load', { index: i })
        continue
      }

      const textContent = extractTextFromDocument(doc)
      if (!textContent.trim()) {
        continue // Skip empty sections (like cover pages)
      }

      // Get title from TOC or generate one
      const hrefWithoutFragment = item.href.split('#')[0]
      const title = tocMap.get(hrefWithoutFragment) || tocMap.get(item.href) || `Section ${i + 1}`

      // Calculate text hash for caching
      const textHash = await hashText(textContent)

      // Estimate duration (rough: ~150 words per minute, ~5 chars per word)
      const estimatedDuration = Math.ceil((textContent.length / 5 / 150) * 60)

      sections.push({
        id: sectionId(bookId, sections.length),
        bookId,
        index: sections.length,
        title,
        href: item.href,
        textContent: normalizeText(textContent),
        textHash,
        charCount: textContent.length,
        estimatedDuration,
      })

      log.debug('Added section', { title, chars: textContent.length })
    } catch (error) {
      log.error('Error processing section', { index: i, error })
    }
  }

  return sections
}

/**
 * Build a map of href -> title from TOC
 */
function buildTocMap(toc: NavItem[]): Map<string, string> {
  const map = new Map<string, string>()

  function processItem(item: NavItem) {
    if (item.href) {
      // Remove fragment identifier if present
      const href = item.href.split('#')[0]
      map.set(href, item.label.trim())
      // Also add with the full href in case it's needed
      map.set(item.href, item.label.trim())
    }
    if (item.subitems) {
      item.subitems.forEach(processItem)
    }
  }

  toc.forEach(processItem)
  return map
}

/**
 * Extract plain text from an HTML document
 */
function extractTextFromDocument(doc: Document): string {
  // Remove script and style elements
  const scripts = doc.querySelectorAll('script, style, noscript')
  scripts.forEach((el) => el.remove())

  // Get body text
  const body = doc.body || doc.documentElement
  return body?.textContent || ''
}

/**
 * Normalize text for TTS
 */
function normalizeText(text: string): string {
  return (
    text
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      // Remove excessive line breaks
      .replace(/\n{3,}/g, '\n\n')
      // Trim
      .trim()
  )
}

/**
 * Extract TOC structure from EPUB
 */
export async function extractTOC(file: File): Promise<TOCItem[]> {
  const arrayBuffer = await file.arrayBuffer()
  const epub = ePub(arrayBuffer)
  await epub.ready

  const navigation = epub.navigation
  const toc = navigation?.toc || []

  // Get spine items for index mapping
  const spineItems = (epub.spine as unknown as { items: Array<{ href: string }> }).items || []
  const hrefToIndex = new Map(spineItems.map((item, i) => [item.href?.split('#')[0], i]))

  function processTocItem(item: NavItem): TOCItem {
    const href = item.href?.split('#')[0] || ''
    return {
      title: item.label.trim(),
      href: item.href || '',
      sectionIndex: hrefToIndex.get(href) ?? -1,
      children: item.subitems?.map(processTocItem),
    }
  }

  const result = toc.map(processTocItem)
  epub.destroy()

  return result
}

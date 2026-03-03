// Re-export all content parser modules
export type {
  ParsedContent,
  ContentMetadata,
  ContentSourceType,
  DetectedSection,
  SectionConfidence,
  ImportProgressCallback,
  TextBlock,
  HtmlBlock,
} from './types'

export { parseEPUBToContent } from './epubAdapter'
export type { EPUBParseOptions } from './epubAdapter'

export { parsePDF } from './pdfParser'
export type { PDFParseOptions } from './pdfParser'

export { parseWebUrl, parseHtmlContent, fetchAndDiscover, parseMultiPageWebsite, discoverPages } from './webParser'
export type { WebParseOptions } from './webParser'

export { discoverLinkedPages } from './linkDiscovery'
export type { DiscoveredPage } from './linkDiscovery'

export { parseText } from './textParser'
export type { TextParseOptions } from './textParser'

export { fetchUrl, FetchError } from './fetchService'

export {
  detectSectionsFromTextBlocks,
  detectSectionsFromHtml,
  detectSectionsFromPlainText,
  collapseToSingleSection,
} from './sectionDetector'

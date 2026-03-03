# Multi-Source Import

- **Status**: Accepted
- **Date**: 2026-03-02
- **Deciders**: Ben

## Context

EPUB Player only supported importing EPUB files. Users frequently have content in other formats (PDFs, web articles, blog posts) that they want to listen to. Adding multi-source import significantly broadens the app's utility while maintaining the local-first architecture.

Key challenges:
- PDFs lack inherent chapter structure (unlike EPUBs with spine/TOC)
- Fetching arbitrary web URLs from a browser runs into CORS restrictions
- Scanned PDFs require OCR, which is CPU-intensive and requires a large WASM module
- Different source formats need a unified pipeline to avoid duplication in the save/playback path

## Decision

Implement a multi-source import pipeline supporting four content sources (EPUB, PDF, Web URL, and pasted text) that all produce a common `ParsedContent` shape, feeding into a single shared save pipeline.

### Architecture

```
Import Sources → Content Parsers → Section Detector → Save Pipeline → IndexedDB
```

1. **Shared types** (`ParsedContent`, `DetectedSection`) as the contract between parsers and storage
2. **Section detector** — shared service that splits raw text into sections using heading detection, pattern matching, and font-size heuristics
3. **PDF parser** — PDF.js in a Web Worker for text extraction, with on-demand Tesseract.js OCR for scanned documents
4. **Web parser** — Cascading fetch strategy (direct → CORS proxy → paste fallback) with Mozilla Readability for article extraction
5. **Text parser** — Simplest path for pasted content
6. **EPUB adapter** — Thin wrapper around existing parser to produce `ParsedContent`
7. **Unified save pipeline** — Single function that all sources use for deduplication, section creation, and playback initialization

### Fetch Strategy for URLs

To avoid requiring a self-hosted proxy (which contradicts local-first philosophy):
1. Try direct fetch (works for CORS-friendly sites)
2. Fall back to `allorigins.win`, a public CORS proxy running since 2015
3. Proxy URL is stored as a user setting, making it swappable if the service goes down
4. Friendly fallback to paste if all fetching fails

### Section Detection

- EPUB: Existing spine-based sections pass through directly (high confidence)
- PDF: Font-size analysis to identify headings, "Chapter N" pattern matching
- Web: Split on `<h1>`–`<h3>` tags from Readability output
- Text: Pattern matching on heading-like lines
- Universal fallback: Single section titled with the document name
- Minimum section size (200 chars) prevents orphan sections

### OCR for Scanned PDFs

Tesseract.js (~15MB) is loaded on-demand only when text density per page falls below a threshold. This avoids penalizing the common case (text-based PDFs) with a large download.

## Consequences

### Positive

- Users can import PDFs, web articles, and pasted text — significantly broader content support
- All import methods share the same save pipeline, reducing duplication
- Section detection produces quality chapters even from unstructured sources
- New import page provides a better UX than the old hidden file input
- CORS proxy is configurable, making the system resilient to third-party service changes

### Negative

- Three new dependencies: `pdfjs-dist`, `tesseract.js` (lazy-loaded), `@mozilla/readability`
- OCR is slow and quality varies — user expectations need to be managed
- Public CORS proxy is a third-party dependency (mitigated by configurability and paste fallback)
- Section detection is heuristic and will sometimes produce imperfect results (mitigated by section preview and collapse-to-single option)

### Neutral

- Existing EPUB import path is preserved internally; the adapter is purely additive
- The old `useImportEPUB` hook still exists for any code that depends on it (e.g., onboarding)

## Alternatives Considered

### Alternative 1: Server-Side Proxy

Host our own Vercel/Cloudflare serverless function for URL fetching. Rejected because it adds operational complexity, contradicts local-first principles, and has a cost. The public proxy with paste fallback is sufficient.

### Alternative 2: Browser Extension for URL Fetching

A browser extension could bypass CORS entirely. Rejected because it adds significant friction (users must install an extension) and limits the app to desktop browsers.

### Alternative 3: Server-Side PDF Processing

Send PDFs to a server for text extraction. Rejected to maintain local-first architecture — all processing stays on-device.

### Alternative 4: Separate Import Pages Per Source

Instead of a unified tabbed page, have separate routes for each source type. Rejected because a unified page is simpler to navigate and makes source discovery easier.

## References

- [allorigins.win](https://allorigins.win/) — Public CORS proxy
- [Mozilla Readability](https://github.com/mozilla/readability) — Article extraction
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF text extraction
- [Tesseract.js](https://tesseract.projectnaptha.com/) — Browser-based OCR

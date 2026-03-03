/**
 * Page Picker
 *
 * Shown when a multi-page website is detected (e.g., a book split
 * across multiple URLs). Lets the user select which pages to include
 * as chapters, or skip and import just the current page.
 */

import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import type { DiscoveredPage } from '@/services/contentParsers'
import { GlobeIcon } from '@/ui/icons'

// ============================================================================
// Props
// ============================================================================

interface PagePickerProps {
  pages: DiscoveredPage[]
  onImportSelected: (pages: { url: string; title: string }[]) => void
  onImportSingle: () => void
  onCancel: () => void
}

// ============================================================================
// Component
// ============================================================================

export function PagePicker({
  pages,
  onImportSelected,
  onImportSingle,
  onCancel,
}: PagePickerProps) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Select all pages by default
    return new Set(pages.map((p) => p.url))
  })

  const togglePage = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) {
        next.delete(url)
      } else {
        next.add(url)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set(pages.map((p) => p.url)))
  const selectNone = () => setSelected(new Set())

  const handleImport = () => {
    const selectedPages = pages
      .filter((p) => selected.has(p.url))
      .map((p) => ({ url: p.url, title: p.title }))

    if (selectedPages.length === 0) return
    onImportSelected(selectedPages)
  }

  return (
    <div className="space-y-5">
      {/* Header info */}
      <div className="rounded-2xl bg-surface-1 p-4">
        <div className="mb-2 flex items-center gap-2">
          <GlobeIcon className="h-5 w-5 text-accent" />
          <h2 className="font-bold text-text-primary">
            <Trans>Multi-page site detected</Trans>
          </h2>
        </div>
        <p className="text-sm text-text-secondary">
          <Trans>
            This site has multiple pages that look like chapters. Select which pages to include — each will become a chapter.
          </Trans>
        </p>
      </div>

      {/* Select all / none */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {selected.size} of {pages.length} <Trans>pages selected</Trans>
        </p>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="text-xs font-medium text-accent hover:underline"
          >
            <Trans>Select all</Trans>
          </button>
          <span className="text-text-muted">·</span>
          <button
            onClick={selectNone}
            className="text-xs font-medium text-accent hover:underline"
          >
            <Trans>Select none</Trans>
          </button>
        </div>
      </div>

      {/* Page list */}
      <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-1">
        {pages.map((page, index) => (
          <label
            key={page.url}
            className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 ${
              index < pages.length - 1 ? 'border-b border-border-muted' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(page.url)}
              onChange={() => togglePage(page.url)}
              className="h-4 w-4 flex-shrink-0 rounded border-border accent-accent"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">
                {page.title}
              </p>
              <p className="truncate text-xs text-text-muted">
                {extractPathSuffix(page.url)}
              </p>
            </div>
            {page.isCurrent && (
              <span className="flex-shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                {t`current`}
              </span>
            )}
          </label>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-2">
        <button
          onClick={handleImport}
          disabled={selected.size === 0}
          className="pressable w-full rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40"
        >
          <Trans>Import {selected.size} pages as chapters</Trans>
        </button>
        <button
          onClick={onImportSingle}
          className="pressable w-full rounded-xl bg-surface-2 py-3 text-sm font-medium text-text-secondary hover:bg-surface-3"
        >
          <Trans>Just import this page</Trans>
        </button>
        <button
          onClick={onCancel}
          className="w-full py-2 text-sm text-text-muted hover:text-text-secondary"
        >
          <Trans>Cancel</Trans>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function extractPathSuffix(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname
  } catch {
    return url
  }
}

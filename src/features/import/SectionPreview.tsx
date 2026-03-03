/**
 * Section Preview
 *
 * Shows detected sections before saving to library.
 * Lets user:
 * - Review section titles and word counts
 * - Edit title and author
 * - Collapse all sections into a single chapter
 * - Save or cancel
 */

import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import type { ParsedContent } from '@/services/contentParsers'
import type { SectionConfidence } from '@/services/contentParsers/types'

// ============================================================================
// Props
// ============================================================================

interface SectionPreviewProps {
  content: ParsedContent
  onCollapse: () => void
  onUpdateMetadata: (updates: { title?: string; author?: string }) => void
  onSave: () => void
  onCancel: () => void
}

// ============================================================================
// Component
// ============================================================================

export function SectionPreview({
  content,
  onCollapse,
  onUpdateMetadata,
  onSave,
  onCancel,
}: SectionPreviewProps) {
  const { metadata, sections } = content
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingAuthor, setEditingAuthor] = useState(false)

  const totalWords = sections.reduce(
    (sum, s) => sum + countWords(s.textContent),
    0,
  )

  const handleCollapse = () => {
    setIsCollapsed(true)
    onCollapse()
  }

  const hasLowConfidence = sections.some((s) => s.confidence === 'low')
  const sourceLabel = getSourceLabel(metadata.sourceType)

  return (
    <div className="space-y-5">
      {/* Book info */}
      <div className="rounded-2xl bg-surface-1 p-4">
        {/* Title — click to edit */}
        <div className="mb-1">
          {editingTitle ? (
            <input
              type="text"
              defaultValue={metadata.title}
              onBlur={(e) => {
                const val = e.target.value.trim()
                if (val) onUpdateMetadata({ title: val })
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              autoFocus
              className="w-full rounded-lg border border-accent bg-surface-2 px-2 py-1 text-lg font-bold text-text-primary focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="group w-full text-left"
              title={t`Click to edit title`}
            >
              <h2 className="text-lg font-bold text-text-primary group-hover:text-accent">
                {metadata.title}
              </h2>
            </button>
          )}
        </div>

        {/* Author — click to edit */}
        <div className="mb-3">
          {editingAuthor ? (
            <input
              type="text"
              defaultValue={metadata.author}
              onBlur={(e) => {
                const val = e.target.value.trim()
                if (val) onUpdateMetadata({ author: val })
                setEditingAuthor(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              autoFocus
              className="w-full rounded-lg border border-accent bg-surface-2 px-2 py-1 text-sm text-text-secondary focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setEditingAuthor(true)}
              className="group text-left"
              title={t`Click to edit author`}
            >
              <p className="text-sm text-text-secondary group-hover:text-accent">
                {metadata.author}
              </p>
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-text-muted">
          <span>{sections.length} {sections.length === 1 ? t`section` : t`sections`}</span>
          <span>{totalWords.toLocaleString()} {t`words`}</span>
          <span className="rounded-full bg-surface-3 px-2 py-0.5">{sourceLabel}</span>
        </div>
      </div>

      {/* Sections list */}
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium text-text-secondary">
          <Trans>Detected Sections</Trans>
        </h3>

        <div className="max-h-72 overflow-y-auto rounded-xl bg-surface-1">
          {sections.map((section, index) => (
            <SectionRow
              key={index}
              index={index}
              title={section.title}
              wordCount={countWords(section.textContent)}
              confidence={section.confidence}
              isLast={index === sections.length - 1}
            />
          ))}
        </div>

        {/* Low-confidence notice */}
        {hasLowConfidence && !isCollapsed && sections.length > 1 && (
          <p className="text-xs text-text-muted">
            <Trans>Some sections were detected automatically and may not be perfect.</Trans>
          </p>
        )}
      </div>

      {/* Collapse option */}
      {sections.length > 1 && !isCollapsed && (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-1 p-3">
          <input
            type="checkbox"
            checked={false}
            onChange={handleCollapse}
            className="h-4 w-4 rounded border-border accent-accent"
          />
          <span className="text-sm text-text-secondary">
            <Trans>Import as a single chapter instead</Trans>
          </span>
        </label>
      )}

      {isCollapsed && (
        <div className="rounded-xl bg-accent/10 p-3 text-sm text-accent">
          <Trans>All content will be imported as a single chapter.</Trans>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onCancel}
          className="pressable flex-1 rounded-xl bg-surface-2 py-3 font-medium text-text-secondary hover:bg-surface-3"
        >
          <Trans>Cancel</Trans>
        </button>
        <button
          onClick={onSave}
          className="pressable flex-1 rounded-xl bg-accent py-3 font-medium text-white"
        >
          <Trans>Save to Library</Trans>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Section Row
// ============================================================================

function SectionRow({
  index,
  title,
  wordCount,
  confidence,
  isLast,
}: {
  index: number
  title: string
  wordCount: number
  confidence: SectionConfidence
  isLast: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${
        !isLast ? 'border-b border-border-muted' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs text-text-muted">
          {index + 1}
        </span>
        <span className="truncate text-sm text-text-primary">{title}</span>
        {confidence === 'low' && (
          <span
            className="flex-shrink-0 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
            title={t`Auto-detected section boundary`}
          >
            auto
          </span>
        )}
      </div>
      <span className="ml-3 flex-shrink-0 text-xs text-text-muted">
        {wordCount.toLocaleString()}w
      </span>
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function getSourceLabel(sourceType: string): string {
  switch (sourceType) {
    case 'epub':
      return 'EPUB'
    case 'pdf':
      return 'PDF'
    case 'web':
      return t`Web Article`
    case 'text':
      return t`Pasted Text`
    default:
      return sourceType
  }
}

/**
 * Book Editor View
 *
 * Core editor UI used by both the import flow (pre-save) and
 * the standalone edit page (post-save). Fixed-height section rows
 * with animated removal for rapid junk-clearing UX.
 */

import { useState, useEffect, useCallback } from 'react'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import {
  CloseIcon,
  AlertTriangleIcon,
  WandIcon,
  TrashIcon,
} from '@/ui/icons'
import { useBookEditor, type EditorSection } from './useBookEditor'
import { SectionDetailSheet } from './SectionDetailSheet'

// ============================================================================
// Props
// ============================================================================

export interface BookEditorViewProps {
  mode: 'import' | 'edit'
  initialSections: { title: string; textContent: string; id?: string }[]
  bookTitle?: string
  bookAuthor?: string
  onSave: (sections: EditorSection[], metadata?: { title: string; author: string }) => void
  onCancel: () => void
  onUpdateMetadata?: (updates: { title?: string; author?: string }) => void
}

// ============================================================================
// Component
// ============================================================================

export function BookEditorView({
  mode,
  initialSections,
  bookTitle,
  bookAuthor,
  onSave,
  onCancel,
  onUpdateMetadata,
}: BookEditorViewProps) {
  const editor = useBookEditor(initialSections)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingAuthor, setEditingAuthor] = useState(false)
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [collapsingIds, setCollapsingIds] = useState<Set<string>>(new Set())

  // Sync metadata
  useEffect(() => {
    if (bookTitle || bookAuthor) {
      editor.setMetadata({ title: bookTitle || '', author: bookAuthor || '' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    const active = editor.getActiveSections()
    onSave(active, editor.metadata || undefined)
  }

  // Animated removal: mark as collapsing, wait for CSS transition, then actually remove
  const handleRemove = useCallback((activeIndex: number) => {
    const active = editor.activeSections
    const target = active[activeIndex]
    if (!target) return
    setCollapsingIds((prev) => new Set(prev).add(target.id))
    setTimeout(() => {
      editor.removeSection(activeIndex)
      setCollapsingIds((prev) => {
        const next = new Set(prev)
        next.delete(target.id)
        return next
      })
    }, 150)
  }, [editor])

  const handleRemoveAllFlagged = useCallback(() => {
    const flagged = editor.activeSections.filter((s) => s.isJunk)
    setCollapsingIds((prev) => {
      const next = new Set(prev)
      flagged.forEach((s) => next.add(s.id))
      return next
    })
    setTimeout(() => {
      editor.removeAllFlagged()
      setCollapsingIds(new Set())
    }, 150)
  }, [editor])

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `<1 min`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const remaining = minutes % 60
    return `${hours}h ${remaining}m`
  }

  return (
    <div className="space-y-4">
      {/* Book metadata (import mode only) */}
      {mode === 'import' && editor.metadata && (
        <div className="rounded-2xl bg-surface-1 p-4">
          {/* Title */}
          <div className="mb-1">
            {editingTitle ? (
              <input
                type="text"
                defaultValue={editor.metadata.title}
                onBlur={(e) => {
                  const val = e.target.value.trim()
                  if (val) {
                    editor.updateMetadata({ title: val })
                    onUpdateMetadata?.({ title: val })
                  }
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
                title={t`Tap to edit title`}
              >
                <h2 className="text-lg font-bold text-text-primary group-hover:text-accent">
                  {editor.metadata.title}
                </h2>
              </button>
            )}
          </div>
          {/* Author */}
          <div>
            {editingAuthor ? (
              <input
                type="text"
                defaultValue={editor.metadata.author}
                onBlur={(e) => {
                  const val = e.target.value.trim()
                  if (val) {
                    editor.updateMetadata({ author: val })
                    onUpdateMetadata?.({ author: val })
                  }
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
                title={t`Tap to edit author`}
              >
                <p className="text-sm text-text-secondary group-hover:text-accent">
                  {editor.metadata.author}
                </p>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-muted">
          {editor.junkCount > 0 ? (
            <Trans>{editor.junkCount} likely junk · {editor.activeSections.length} sections</Trans>
          ) : (
            <Trans>{editor.activeSections.length} sections</Trans>
          )}
          {editor.totalIssues > 0 && (
            <span className="ml-2 text-warning">
              · {editor.totalIssues} {editor.totalIssues === 1 ? t`issue` : t`issues`}
            </span>
          )}
        </span>
        <span className="flex-1" />
        {editor.totalIssues > 0 && (
          <button
            onClick={editor.cleanAllSections}
            className="pressable flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3"
          >
            <WandIcon className="h-3.5 w-3.5" />
            <Trans>Clean All</Trans>
          </button>
        )}
        {editor.junkCount > 0 && (
          <button
            onClick={handleRemoveAllFlagged}
            className="pressable flex items-center gap-1.5 rounded-lg bg-error/10 px-3 py-1.5 text-xs font-medium text-error"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <Trans>Remove Flagged</Trans>
          </button>
        )}
      </div>

      {/* Section list */}
      <div className="rounded-xl bg-surface-1">
        {editor.sections
          .filter((s) => !s.isRemoved)
          .map((section, activeIndex) => (
            <SectionRow
              key={section.id}
              section={section}
              isCollapsing={collapsingIds.has(section.id)}
              isLast={activeIndex === editor.activeSections.length - 1}
              onRemove={() => handleRemove(activeIndex)}
              onTap={() => setDetailIndex(activeIndex)}
              formatDuration={formatDuration}
            />
          ))}
        {editor.activeSections.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            <Trans>All sections removed. Use undo to restore.</Trans>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onCancel}
          className="pressable flex-1 rounded-xl bg-surface-2 py-3 font-medium text-text-secondary hover:bg-surface-3"
        >
          <Trans>Cancel</Trans>
        </button>
        <button
          onClick={handleSave}
          disabled={editor.activeSections.length === 0}
          className="pressable flex-1 rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40"
        >
          {mode === 'import' ? <Trans>Save to Library</Trans> : <Trans>Save Changes</Trans>}
        </button>
      </div>

      {/* Undo toast */}
      {editor.undoLabel && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 pb-safe">
          <div className="flex items-center gap-3 rounded-full bg-surface-3 px-5 py-3 shadow-lg">
            <span className="text-sm text-text-primary">{editor.undoLabel}</span>
            <button
              onClick={() => { editor.undo(); setCollapsingIds(new Set()) }}
              className="pressable text-sm font-semibold text-accent"
            >
              <Trans>Undo</Trans>
            </button>
            <button
              onClick={editor.dismissUndo}
              className="ml-1 text-text-muted hover:text-text-secondary"
              aria-label={t`Dismiss`}
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Section Detail Sheet (Phase 2) */}
      {detailIndex !== null && detailIndex < editor.activeSections.length && (
        <SectionDetailSheet
          section={editor.activeSections[detailIndex]}
          isLastSection={detailIndex >= editor.activeSections.length - 1}
          onClose={() => setDetailIndex(null)}
          onRename={(newTitle) => {
            editor.renameSection(detailIndex, newTitle)
            setDetailIndex(null)
          }}
          onClean={() => editor.cleanSection(detailIndex)}
          onMerge={() => {
            editor.mergeSections(detailIndex)
            setDetailIndex(null)
          }}
          onUpdateText={(text) => editor.updateSectionText(detailIndex, text)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Section Row
// ============================================================================

function SectionRow({
  section,
  isCollapsing,
  isLast,
  onRemove,
  onTap,
  formatDuration,
}: {
  section: EditorSection
  isCollapsing: boolean
  isLast: boolean
  onRemove: () => void
  onTap: () => void
  formatDuration: (s: number) => string
}) {
  return (
    <div
      className={`section-row flex items-center ${!isLast ? 'border-b border-border-muted' : ''} ${isCollapsing ? 'collapsed' : ''}`}
    >
      {/* Tappable content area */}
      <button
        onClick={onTap}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
      >
        {/* Junk indicator */}
        {section.isJunk && (
          <AlertTriangleIcon className="h-4 w-4 flex-shrink-0 text-warning" />
        )}
        <div className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${section.isJunk ? 'text-text-muted' : 'text-text-primary'}`}>
            {section.title}
          </span>
          <span className="block text-xs text-text-muted">
            {section.wordCount.toLocaleString()}w · {formatDuration(section.estimatedDuration)}
            {section.issueCount > 0 && (
              <span className="text-warning"> · {section.issueCount} {section.issueCount === 1 ? t`issue` : t`issues`}</span>
            )}
          </span>
        </div>
      </button>

      {/* Remove button — fixed position for rapid clicking */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="pressable flex h-full items-center px-4 text-text-muted hover:text-error"
        aria-label={t`Remove section`}
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  )
}

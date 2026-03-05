/**
 * Section Detail Sheet
 *
 * Bottom sheet (mobile) / modal (desktop) for viewing and editing
 * a single section's content. Shows issue highlights, word count,
 * and offers auto-clean and merge actions.
 */

import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { CloseIcon, WandIcon, MergeIcon } from '@/ui/icons'
import { useFocusTrap } from '@/ui/accessibility/useFocusTrap'
import { detectIssues } from './textCleanup'
import type { EditorSection } from './useBookEditor'

// ============================================================================
// Props
// ============================================================================

interface SectionDetailSheetProps {
  section: EditorSection
  isLastSection: boolean
  onClose: () => void
  onRename: (title: string) => void
  onClean: () => void
  onMerge: () => void
  onUpdateText: (text: string) => void
}

// ============================================================================
// Component
// ============================================================================

export function SectionDetailSheet({
  section,
  isLastSection,
  onClose,
  onRename,
  onClean,
  onMerge,
  onUpdateText,
}: SectionDetailSheetProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [rawText, setRawText] = useState(section.textContent)

  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: true,
    onEscape: handleClose,
  })

  const issues = detectIssues(rawText)
  const isDirty = rawText !== section.textContent

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `<1 min`
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  function handleClose() {
    if (isDirty) onUpdateText(rawText)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl animate-slide-up md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
      >
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border-muted px-5 pb-3 md:pt-4">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                type="text"
                defaultValue={section.title}
                onBlur={(e) => {
                  const val = e.target.value.trim()
                  if (val && val !== section.title) onRename(val)
                  setEditingTitle(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                autoFocus
                className="w-full rounded-lg border border-accent bg-surface-2 px-2 py-1 text-base font-semibold text-text-primary focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="group w-full text-left"
                title={t`Tap to rename`}
              >
                <h3 className="truncate text-base font-semibold text-text-primary group-hover:text-accent">
                  {section.title}
                </h3>
              </button>
            )}
            <p className="mt-0.5 text-xs text-text-muted">
              {section.wordCount.toLocaleString()} {t`words`} · {formatDuration(section.estimatedDuration)}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="pressable flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text-primary"
            aria-label={t`Close`}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Issues summary */}
          {issues.length > 0 && (
            <div className="mb-4 rounded-xl bg-warning/5 p-3">
              <p className="mb-1 text-xs font-medium text-warning">
                <Trans>{issues.reduce((n, i) => n + i.count, 0)} issues detected</Trans>
              </p>
              <div className="flex flex-wrap gap-2">
                {issues.map((issue) => (
                  <span
                    key={issue.type}
                    className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning"
                  >
                    {issue.count}× {issue.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Editable text area — always live */}
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={12}
            className="w-full resize-y rounded-xl border border-border-muted bg-surface-2 px-3 py-2 text-sm leading-relaxed text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Actions bar */}
        <div className="flex gap-2 border-t border-border-muted px-5 py-3 pb-safe md:pb-3">
          {section.issueCount > 0 && (
            <button
              onClick={() => { onClean(); onClose() }}
              className="pressable flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3"
            >
              <WandIcon className="h-4 w-4" />
              <Trans>Auto-Clean</Trans>
            </button>
          )}
          {!isLastSection && (
            <button
              onClick={onMerge}
              className="pressable flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3"
            >
              <MergeIcon className="h-4 w-4" />
              <Trans>Merge with Next</Trans>
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={handleClose}
            className="pressable rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            <Trans>Done</Trans>
          </button>
        </div>
      </div>
    </>
  )
}


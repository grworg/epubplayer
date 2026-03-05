/**
 * Book Editor Hook
 *
 * Manages section editing state for both import (pre-save) and
 * standalone (post-save) modes. Provides undo, junk detection,
 * remove/rename/reorder/merge/clean actions.
 */

import { useState, useCallback, useRef } from 'react'
import { countIssues, cleanAll } from './textCleanup'

// ============================================================================
// Types
// ============================================================================

export interface EditorSection {
  id: string
  title: string
  textContent: string
  wordCount: number
  estimatedDuration: number
  isJunk: boolean
  isRemoved: boolean
  issueCount: number
}

export interface EditorMetadata {
  title: string
  author: string
}

interface UndoEntry {
  sections: EditorSection[]
  label: string
}

// ============================================================================
// Junk Detection
// ============================================================================

const JUNK_TITLE_PATTERN = /^(cover|title\s*page|copyright|toc|table of contents|contents|index|appendix|about|acknowledgment|acknowledgement|license|licence|colophon|also by|frontmatter|backmatter|project gutenberg|half title|endorsements|dedication|epigraph|preface|foreword|front cover|back cover|blank page)/i

function detectJunk(section: { title: string; wordCount: number }, index: number, total: number): boolean {
  if (section.wordCount < 50) return true
  if (JUNK_TITLE_PATTERN.test(section.title.trim())) return true
  if ((index === 0 || index === total - 1) && section.wordCount < 150) return true
  return false
}

function countWords(text: string): number {
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

// ============================================================================
// Section Builders
// ============================================================================

function buildEditorSection(
  input: { title: string; textContent: string; id?: string },
  index: number,
  total: number,
): EditorSection {
  const wordCount = countWords(input.textContent)
  const charCount = input.textContent.length
  const estimatedDuration = Math.ceil((charCount / 5 / 150) * 60)
  const section: EditorSection = {
    id: input.id || `editor-${index}`,
    title: input.title || `Section ${index + 1}`,
    textContent: input.textContent,
    wordCount,
    estimatedDuration,
    isJunk: false,
    isRemoved: false,
    issueCount: countIssues(input.textContent),
  }
  section.isJunk = detectJunk(section, index, total)
  return section
}

// ============================================================================
// Hook
// ============================================================================

export function useBookEditor(initialSections: { title: string; textContent: string; id?: string }[]) {
  const [sections, setSections] = useState<EditorSection[]>(() =>
    initialSections.map((s, i) => buildEditorSection(s, i, initialSections.length)),
  )
  const [metadata, setMetadata] = useState<EditorMetadata | null>(null)
  const undoStackRef = useRef<UndoEntry[]>([])
  const [undoLabel, setUndoLabel] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const pushUndo = useCallback((label: string) => {
    setSections((prev) => {
      undoStackRef.current.push({ sections: prev, label })
      if (undoStackRef.current.length > 30) undoStackRef.current.shift()
      return prev
    })
    setUndoLabel(label)
    setIsDirty(true)
  }, [])

  // ---- Computed Values ----

  const activeSections = sections.filter((s) => !s.isRemoved)
  const junkCount = activeSections.filter((s) => s.isJunk).length
  const totalIssues = activeSections.reduce((sum, s) => sum + s.issueCount, 0)

  // ---- Actions ----

  const removeSection = useCallback((index: number) => {
    pushUndo('Section removed')
    setSections((prev) => {
      const active = prev.filter((s) => !s.isRemoved)
      const target = active[index]
      if (!target) return prev
      return prev.map((s) => (s.id === target.id ? { ...s, isRemoved: true } : s))
    })
  }, [pushUndo])

  const removeAllFlagged = useCallback(() => {
    const flaggedCount = sections.filter((s) => !s.isRemoved && s.isJunk).length
    if (flaggedCount === 0) return
    pushUndo(`${flaggedCount} sections removed`)
    setSections((prev) =>
      prev.map((s) => (s.isJunk && !s.isRemoved ? { ...s, isRemoved: true } : s)),
    )
  }, [sections, pushUndo])

  const renameSection = useCallback((index: number, newTitle: string) => {
    pushUndo('Section renamed')
    setSections((prev) => {
      const active = prev.filter((s) => !s.isRemoved)
      const target = active[index]
      if (!target) return prev
      return prev.map((s) => (s.id === target.id ? { ...s, title: newTitle } : s))
    })
  }, [pushUndo])

  const reorderSection = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    pushUndo('Sections reordered')
    setSections((prev) => {
      const active = prev.filter((s) => !s.isRemoved)
      const removed = prev.filter((s) => s.isRemoved)
      const item = active.splice(fromIndex, 1)[0]
      if (!item) return prev
      active.splice(toIndex, 0, item)
      return [...active, ...removed]
    })
  }, [pushUndo])

  const mergeSections = useCallback((index: number) => {
    const active = sections.filter((s) => !s.isRemoved)
    if (index >= active.length - 1) return
    pushUndo('Sections merged')
    setSections((prev) => {
      const activeIds = prev.filter((s) => !s.isRemoved).map((s) => s.id)
      const targetId = activeIds[index]
      const mergeId = activeIds[index + 1]
      if (!targetId || !mergeId) return prev
      const target = prev.find((s) => s.id === targetId)!
      const merge = prev.find((s) => s.id === mergeId)!
      const mergedText = target.textContent + '\n\n' + merge.textContent
      const mergedWordCount = target.wordCount + merge.wordCount
      return prev.map((s) => {
        if (s.id === targetId)
          return {
            ...s,
            textContent: mergedText,
            wordCount: mergedWordCount,
            estimatedDuration: target.estimatedDuration + merge.estimatedDuration,
            issueCount: countIssues(mergedText),
          }
        if (s.id === mergeId) return { ...s, isRemoved: true }
        return s
      })
    })
  }, [sections, pushUndo])

  const cleanSection = useCallback((index: number) => {
    pushUndo('Section cleaned')
    setSections((prev) => {
      const active = prev.filter((s) => !s.isRemoved)
      const target = active[index]
      if (!target) return prev
      const cleaned = cleanAll(target.textContent)
      return prev.map((s) =>
        s.id === target.id
          ? { ...s, textContent: cleaned, wordCount: countWords(cleaned), issueCount: countIssues(cleaned) }
          : s,
      )
    })
  }, [pushUndo])

  const cleanAllSections = useCallback(() => {
    const cleanable = sections.filter((s) => !s.isRemoved && s.issueCount > 0)
    if (cleanable.length === 0) return
    pushUndo(`Cleaned ${totalIssues} issues`)
    setSections((prev) =>
      prev.map((s) => {
        if (s.isRemoved || s.issueCount === 0) return s
        const cleaned = cleanAll(s.textContent)
        return { ...s, textContent: cleaned, wordCount: countWords(cleaned), issueCount: countIssues(cleaned) }
      }),
    )
  }, [sections, totalIssues, pushUndo])

  const updateSectionText = useCallback((index: number, newText: string) => {
    pushUndo('Section text edited')
    setSections((prev) => {
      const active = prev.filter((s) => !s.isRemoved)
      const target = active[index]
      if (!target) return prev
      return prev.map((s) =>
        s.id === target.id
          ? { ...s, textContent: newText, wordCount: countWords(newText), issueCount: countIssues(newText) }
          : s,
      )
    })
  }, [pushUndo])

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    setSections(entry.sections)
    setUndoLabel(undoStackRef.current.length > 0 ? undoStackRef.current[undoStackRef.current.length - 1].label : null)
    if (undoStackRef.current.length === 0) setIsDirty(false)
  }, [])

  const dismissUndo = useCallback(() => {
    setUndoLabel(null)
  }, [])

  const updateMetadata = useCallback((updates: Partial<EditorMetadata>) => {
    setMetadata((prev) => (prev ? { ...prev, ...updates } : null))
    setIsDirty(true)
  }, [])

  const getActiveSections = useCallback(() => {
    return sections.filter((s) => !s.isRemoved)
  }, [sections])

  return {
    sections,
    activeSections,
    junkCount,
    totalIssues,
    isDirty,
    undoLabel,
    canUndo: undoStackRef.current.length > 0,
    metadata,

    removeSection,
    removeAllFlagged,
    renameSection,
    reorderSection,
    mergeSections,
    cleanSection,
    cleanAllSections,
    updateSectionText,
    undo,
    dismissUndo,
    updateMetadata,
    setMetadata,
    getActiveSections,
  }
}

export type BookEditorActions = ReturnType<typeof useBookEditor>

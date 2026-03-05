/**
 * Import Page
 *
 * Unified multi-source import flow with three tabs:
 * 1. File (EPUB / PDF) — drag-and-drop + file picker
 * 2. URL — fetch any article / webpage
 * 3. Paste — paste text or HTML directly
 *
 * After parsing, shows a section preview before saving.
 */

import { useState, useRef, useCallback, Component, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { useImport, type ImportStep } from './useImport'
import { PagePicker } from './PagePicker'
import { BookEditorView } from '@/features/editor/BookEditorView'
import type { EditorSection } from '@/features/editor/useBookEditor'
import { createLogger } from '@/services/logging'
import {
  ArrowLeftIcon,
  FileTextIcon,
  GlobeIcon,
  ClipboardIcon,
  UploadIcon,
  LoaderIcon,
  AlertCircleIcon,
  CheckCircleIcon,
} from '@/ui/icons'

const log = createLogger('import')

// ============================================================================
// Error Boundary
// ============================================================================

interface ErrorBoundaryProps {
  onReset: () => void
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class ImportErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    log.error('Import UI crashed', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-error/10">
            <AlertCircleIcon className="h-10 w-10 text-error" />
          </div>
          <p className="mb-2 text-lg font-medium text-text-primary">Something went wrong</p>
          <p className="mb-6 max-w-xs text-sm text-text-secondary">
            {this.state.error.message || 'An unexpected error occurred during import.'}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset()
            }}
            className="pressable rounded-xl bg-accent px-6 py-3 font-medium text-white"
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

// ============================================================================
// Tab Types
// ============================================================================

type ImportTab = 'file' | 'url' | 'paste'

// ============================================================================
// Import Page
// ============================================================================

export function ImportPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<ImportTab>('file')
  const importState = useImport()

  const handleBack = () => {
    if (importState.step === 'preview' || importState.step === 'pagePicker') {
      importState.reset()
    } else {
      navigate('/app')
    }
  }

  const handleEditorSave = async (activeSections: EditorSection[], metadata?: { title: string; author: string }) => {
    const bookId = await importState.save({
      sections: activeSections.map((s) => ({ title: s.title, textContent: s.textContent, confidence: 'high' as const })),
      metadata,
    })
    if (bookId) {
      setTimeout(() => navigate(`/app/book/${bookId}`), 800)
    }
  }

  const switchToPaste = () => {
    importState.reset()
    setActiveTab('paste')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={handleBack}
          className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary hover:bg-surface-2"
          aria-label={t`Back`}
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold text-text-primary">
          {importState.step === 'preview' ? (
            <Trans>Edit Sections</Trans>
          ) : importState.step === 'pagePicker' ? (
            <Trans>Select Pages</Trans>
          ) : (
            <Trans>Import</Trans>
          )}
        </h1>
      </header>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-5 pb-8">
          <ImportErrorBoundary onReset={importState.reset}>
            {importState.step === 'idle' || importState.step === 'error' ? (
              <SourceSelection
                activeTab={activeTab}
                onTabChange={setActiveTab}
                importState={importState}
                onSwitchToPaste={switchToPaste}
              />
            ) : importState.step === 'processing' || importState.step === 'saving' ? (
              <ProcessingView
                label={importState.progressLabel}
                percent={importState.progressPercent}
                step={importState.step}
              />
            ) : importState.step === 'pagePicker' ? (
              <PagePicker
                pages={importState.discoveredPages}
                onImportSelected={importState.importSelectedPages}
                onImportSingle={importState.importSinglePage}
                onCancel={importState.reset}
              />
            ) : importState.step === 'preview' && importState.parsedContent ? (
              <BookEditorView
                mode="import"
                initialSections={importState.parsedContent.sections.map((s) => ({
                  title: s.title,
                  textContent: s.textContent,
                }))}
                bookTitle={importState.parsedContent.metadata.title}
                bookAuthor={importState.parsedContent.metadata.author}
                onSave={handleEditorSave}
                onCancel={importState.reset}
                onUpdateMetadata={importState.updateMetadata}
              />
            ) : importState.step === 'success' ? (
              <SuccessView />
            ) : null}
          </ImportErrorBoundary>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Source Selection (Tab Container)
// ============================================================================

function SourceSelection({
  activeTab,
  onTabChange,
  importState,
  onSwitchToPaste,
}: {
  activeTab: ImportTab
  onTabChange: (tab: ImportTab) => void
  importState: ReturnType<typeof useImport>
  onSwitchToPaste: () => void
}) {
  const tabs: { id: ImportTab; label: string; icon: typeof FileTextIcon }[] = [
    { id: 'file', label: t`File`, icon: FileTextIcon },
    { id: 'url', label: t`URL`, icon: GlobeIcon },
    { id: 'paste', label: t`Paste`, icon: ClipboardIcon },
  ]

  return (
    <>
      {/* Tab bar */}
      <div className="mb-6 flex rounded-xl bg-surface-1 p-1" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                onTabChange(tab.id)
                if (importState.step === 'error') importState.reset()
              }}
              className={`pressable flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-surface-3 text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Error banner */}
      {importState.step === 'error' && importState.error && (
        <div className="mb-4 rounded-xl bg-error/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" />
            <div className="flex-1">
              <p className="font-medium text-error"><Trans>Import Failed</Trans></p>
              <p className="mt-1 text-sm text-error/80">{importState.error}</p>
              {importState.suggestPaste && (
                <button
                  onClick={onSwitchToPaste}
                  className="pressable mt-2 rounded-lg bg-error/10 px-3 py-1.5 text-sm font-medium text-error hover:bg-error/20"
                >
                  <Trans>Switch to Paste</Trans>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active tab content */}
      <div role="tabpanel">
        {activeTab === 'file' && <FileTab onImport={importState.importFile} />}
        {activeTab === 'url' && <UrlTab onImport={importState.importUrl} />}
        {activeTab === 'paste' && <PasteTab onImport={importState.importText} />}
      </div>
    </>
  )
}

// ============================================================================
// File Tab
// ============================================================================

function FileTab({ onImport }: { onImport: (file: File) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      const name = file.name.toLowerCase()
      if (
        name.endsWith('.epub') ||
        name.endsWith('.pdf') ||
        file.type === 'application/epub+zip' ||
        file.type === 'application/pdf'
      ) {
        onImport(file)
      }
    },
    [onImport],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`pressable flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragging
            ? 'border-accent bg-accent/5'
            : 'border-border-muted bg-surface-1 hover:border-border hover:bg-surface-2'
        }`}
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <UploadIcon className="h-8 w-8 text-accent" />
        </div>
        <p className="text-base font-medium text-text-primary">
          <Trans>Drop EPUB or PDF here</Trans>
        </p>
        <p className="mt-1 text-sm text-text-muted">
          <Trans>or tap to browse files</Trans>
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
        className="hidden"
        aria-label={t`Select file to import`}
      />

      <p className="text-center text-xs text-text-muted">
        <Trans>Supported formats: EPUB, PDF (text-based and scanned)</Trans>
      </p>
    </div>
  )
}

// ============================================================================
// URL Tab
// ============================================================================

function UrlTab({ onImport }: { onImport: (url: string) => void }) {
  const [url, setUrl] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) onImport(url.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="import-url" className="mb-2 block text-sm font-medium text-text-secondary">
          <Trans>Article or webpage URL</Trans>
        </label>
        <input
          id="import-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="w-full rounded-xl border border-border-muted bg-surface-1 px-4 py-3 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          autoComplete="off"
        />
      </div>

      <button
        type="submit"
        disabled={!url.trim()}
        className="pressable w-full rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40"
      >
        <Trans>Fetch Article</Trans>
      </button>

      <p className="text-center text-xs text-text-muted">
        <Trans>Works best with articles and blog posts. Some sites may block access.</Trans>
      </p>
    </form>
  )
}

// ============================================================================
// Paste Tab
// ============================================================================

function PasteTab({
  onImport,
}: {
  onImport: (text: string, title: string, author?: string) => void
}) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim() && title.trim()) {
      onImport(text.trim(), title.trim(), author.trim() || undefined)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="import-title" className="mb-2 block text-sm font-medium text-text-secondary">
          <Trans>Title</Trans>
        </label>
        <input
          id="import-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t`Article title`}
          className="w-full rounded-xl border border-border-muted bg-surface-1 px-4 py-3 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label htmlFor="import-author" className="mb-2 block text-sm font-medium text-text-secondary">
          <Trans>Author</Trans> <span className="text-text-muted">(<Trans>optional</Trans>)</span>
        </label>
        <input
          id="import-author"
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder={t`Author name`}
          className="w-full rounded-xl border border-border-muted bg-surface-1 px-4 py-3 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label htmlFor="import-text" className="mb-2 block text-sm font-medium text-text-secondary">
          <Trans>Content</Trans>
        </label>
        <textarea
          id="import-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t`Paste article text or HTML here...`}
          rows={10}
          className="w-full resize-y rounded-xl border border-border-muted bg-surface-1 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <button
        type="submit"
        disabled={!text.trim() || !title.trim()}
        className="pressable w-full rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40"
      >
        <Trans>Import Text</Trans>
      </button>

      <p className="text-center text-xs text-text-muted">
        <Trans>Paste plain text or HTML from any source. Headings will be used for chapter detection.</Trans>
      </p>
    </form>
  )
}

// ============================================================================
// Processing View
// ============================================================================

function ProcessingView({
  label,
  percent,
  step,
}: {
  label: string
  percent: number
  step: ImportStep
}) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-2">
        <LoaderIcon className="h-10 w-10 text-accent" />
      </div>

      <p className="mb-2 text-lg font-medium text-text-primary">
        {step === 'saving' ? <Trans>Saving to Library...</Trans> : <Trans>Processing...</Trans>}
      </p>
      <p className="mb-6 text-sm text-text-secondary">{label}</p>

      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <div className="h-2 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${Math.max(5, percent)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-text-muted">{Math.round(percent)}%</p>
      </div>
    </div>
  )
}

// ============================================================================
// Success View
// ============================================================================

function SuccessView() {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <CheckCircleIcon className="h-10 w-10 text-success" />
      </div>
      <p className="text-lg font-medium text-text-primary">
        <Trans>Added to Library!</Trans>
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        <Trans>Redirecting...</Trans>
      </p>
    </div>
  )
}

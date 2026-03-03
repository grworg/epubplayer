# User Bug Reporting System

- **Status**: Proposed
- **Date**: 2026-01-12
- **Deciders**: Ben, Claude

## Context

Users occasionally experience bugs that are difficult to reproduce or diagnose, such as:

- Playback randomly pausing 30+ minutes into listening
- TTS generation failures
- Audio buffering issues
- State machine edge cases

Currently, users have no way to report these issues with context. While we have a structured logging system (ADR-0013) that captures detailed subsystem logs in memory, there's no mechanism to transmit these logs for developer review.

### Requirements

1. **User-initiated**: Bug reporting must be opt-in, respecting our local-first, privacy-focused architecture
2. **Include logs**: Automatically attach recent logs (with opt-out option)
3. **Low friction**: Simple form with title/description
4. **Free storage**: Solution must work within free tier limits for low-volume projects
5. **Viewable**: Developers need a way to browse/search submitted reports

### Constraints

- No existing backend infrastructure (pure Vite frontend)
- Local-first principles (ADR-0001) — no automatic telemetry
- Must work with Vercel deployment

## Decision

Implement a **user-initiated bug reporting system** with the following architecture:

### 1. Frontend: Report Bug UI

Add a "Report Bug" button to the Settings page that opens a modal/sheet with:

```
┌─────────────────────────────────────────┐
│ Report a Bug                            │
├─────────────────────────────────────────┤
│ What happened?                          │
│ ┌─────────────────────────────────────┐ │
│ │ [Title input]                       │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Please describe the issue:              │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │ [Description textarea]              │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ☑ Include debug logs (recommended)      │
│   Helps us diagnose the issue faster    │
│                                         │
│ [Cancel]              [Submit Report]   │
└─────────────────────────────────────────┘
```

### 2. Log Collection

Leverage the existing `logStore` from ADR-0013:

```typescript
import { logStore } from '@/services/logging'

function collectBugReport(title: string, description: string, includeLogs: boolean) {
  return {
    title,
    description,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    // Include last N log entries (not the full 2000)
    logs: includeLogs ? logStore.getSnapshot().slice(-500) : null,
    // App state context
    context: {
      currentBook: playerStore.getState().currentBook?.title,
      playbackState: playerStore.getState().playbackState,
      ttsEngine: settingsRepository.get('ttsEngine'),
      // ... other relevant state
    }
  }
}
```

The logging system already captures structured data with timestamps, subsystems, and levels — no modifications needed.

### 3. Backend: Vercel Edge Function

Create a minimal Edge Function to receive and store reports:

```
api/
└── bug-report.ts    # POST endpoint
```

```typescript
// api/bug-report.ts
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const report = await request.json()
  
  // Validate payload size (prevent abuse)
  const payloadSize = JSON.stringify(report).length
  if (payloadSize > 500_000) { // 500KB limit
    return new Response('Payload too large', { status: 413 })
  }

  // Store in Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  const { error } = await supabase.from('bug_reports').insert({
    title: report.title,
    description: report.description,
    user_agent: report.userAgent,
    logs: report.logs,
    context: report.context,
    created_at: report.timestamp,
  })

  if (error) {
    return new Response('Failed to store report', { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
```

### 4. Storage: Supabase (Free Tier)

Use Supabase as the persistence layer:

| Resource | Free Tier Limit | Our Expected Usage |
|----------|-----------------|-------------------|
| Database | 500 MB | ~1-5 MB/year |
| API Requests | 500K/month | ~10-50/month |
| Bandwidth | 5 GB/month | Negligible |

**Schema:**

```sql
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  user_agent TEXT,
  logs JSONB,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'new' -- new, reviewed, resolved, wontfix
);

-- Index for browsing
CREATE INDEX idx_bug_reports_created_at ON bug_reports(created_at DESC);
CREATE INDEX idx_bug_reports_status ON bug_reports(status);
```

**Why Supabase over alternatives:**

- **Dashboard UI**: Built-in table viewer to browse/search reports
- **Free tier is generous**: 500MB far exceeds our needs
- **Row-level data**: Can query, filter, and manage individual reports
- **Familiar**: PostgreSQL, widely used, good documentation

### 5. Data Flow

```
┌─────────────────┐
│ User clicks     │
│ "Report Bug"    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ BugReportModal  │
│ - Title         │
│ - Description   │
│ - [x] Logs      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ collectReport() │────▶│ logStore         │
│                 │     │ .getSnapshot()   │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐
│ POST /api/      │
│ bug-report      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Edge Function   │────▶│ Supabase         │
│                 │     │ bug_reports      │
└─────────────────┘     └──────────────────┘
```

### 6. Privacy Considerations

To maintain local-first principles:

1. **Explicit opt-in**: User must actively click "Report Bug" — never automatic
2. **Log preview**: Consider showing a "Preview logs" expandable section so users can see exactly what's being sent
3. **Checkbox default**: Logs checkbox is ON by default (helps debugging) but clearly labeled
4. **No PII in logs**: Logs contain subsystem data, not book content or user data
5. **Minimal context**: Only include technical state, not sensitive preferences

### 7. File Structure

```
src/
├── features/
│   └── settings/
│       ├── SettingsPage.tsx        # Add "Report Bug" button
│       └── BugReportModal.tsx      # NEW: Bug report form
├── services/
│   └── bugReport/
│       └── bugReportService.ts     # NEW: Collect and submit logic
api/
└── bug-report.ts                   # NEW: Vercel Edge Function
```

## Consequences

### Positive

- **Actionable bug reports**: Logs provide context that "it stopped playing" doesn't
- **No logging changes**: Existing `logStore` already captures what we need
- **Zero cost**: Supabase free tier is more than sufficient
- **Respects privacy**: User-initiated, with clear opt-out for logs
- **Browsable**: Supabase dashboard lets us view/search/manage reports
- **Low complexity**: Single endpoint, single table, minimal code

### Negative

- **New dependency**: Supabase account and API keys needed
- **Environment variables**: Need to manage `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- **Not fully local**: First "server" component, though user-initiated
- **Storage limits**: 500 log entries × ~500 bytes = ~250KB per report (acceptable)

### Neutral

- Reports are anonymous (no user accounts to tie them to)
- Can't follow up with users unless they include contact info in description
- Historical logs only — if user reports hours after the issue, relevant logs may be gone

## Alternatives Considered

### Alternative 1: Vercel KV (Redis)

Store reports in Vercel's built-in Redis.

**Rejected because:**
- No dashboard UI to browse reports (would need to build one)
- Key-value model less suited for querying/filtering
- Free tier has lower limits (3,000 requests/day)

### Alternative 2: Vercel Blob Storage

Store each report as a JSON file.

**Rejected because:**
- No built-in way to browse/search reports
- Would need to build a viewer or download files manually
- Less structured than database

### Alternative 3: GitHub Issues API

Auto-create GitHub issues for each bug report.

**Rejected because:**
- Requires GitHub token management
- Would pollute issue tracker with raw bug reports
- Privacy concern: logs would be public

### Alternative 4: Email (Resend/SendGrid)

Email reports to developers.

**Rejected because:**
- Email is harder to search/organize than database
- Logs in email are awkward to view
- Free tiers have sending limits
- No centralized dashboard

### Alternative 5: Firebase Firestore

Use Firebase free tier instead of Supabase.

**Viable alternative, rejected because:**
- Supabase has better dashboard for viewing JSON/logs
- PostgreSQL is more familiar than Firestore's document model
- Similar free tier limits

## Implementation Plan

### Phase 1: Backend Setup
1. Create Supabase project and `bug_reports` table
2. Create `api/bug-report.ts` Edge Function
3. Add environment variables to Vercel
4. Test endpoint manually

### Phase 2: Frontend UI
1. Create `BugReportModal.tsx` component
2. Create `bugReportService.ts` for submission logic
3. Add "Report Bug" button to Settings page
4. Handle loading/success/error states

### Phase 3: Polish
1. Add "Preview logs" expandable section
2. Add success toast/confirmation
3. Consider rate limiting on frontend (prevent spam)
4. Add to help/FAQ: "How to report a bug"

## References

- [ADR-0013: Structured Logging System](./0013-structured-logging-system.md) — Existing log infrastructure
- [ADR-0001: Local-First Architecture](./0001-local-first-architecture.md) — Privacy principles
- [Vercel Edge Functions](https://vercel.com/docs/functions/edge-functions)
- [Supabase Free Tier](https://supabase.com/pricing)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)

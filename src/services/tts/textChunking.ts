/**
 * Text chunking utilities for TTS generation.
 *
 * Splits text into chunks that respect sentence boundaries.
 * Never splits mid-sentence — a long sentence stays whole.
 */

/**
 * Split text into chunks at sentence boundaries.
 * - Combines sentences until hitting the character limit
 * - Never splits a sentence mid-way (even if it exceeds the limit)
 */
export function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const limit = Number.isFinite(maxChars) ? Math.max(100, Math.floor(maxChars)) : 500

  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  // Split into sentences
  const sentences = splitIntoSentences(normalized)
  if (sentences.length === 0) return []

  // Combine sentences into chunks, respecting the limit
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (!current) {
      // First sentence in chunk
      current = sentence
    } else if (current.length + 1 + sentence.length <= limit) {
      // Can fit this sentence in current chunk
      current += ' ' + sentence
    } else {
      // Current chunk is full, start a new one
      chunks.push(current)
      current = sentence
    }
  }

  // Don't forget the last chunk
  if (current) {
    chunks.push(current)
  }

  return chunks
}

/**
 * Split text into sentences.
 * Handles common punctuation: . ! ? …
 * Keeps punctuation attached to the sentence.
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let start = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    
    // Check for sentence-ending punctuation
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') {
      continue
    }

    // Consume consecutive punctuation (e.g., "..." or "?!")
    let end = i + 1
    while (end < text.length) {
      const next = text[end]
      if (next === '.' || next === '!' || next === '?' || next === '…') {
        end++
      } else {
        break
      }
    }

    // Only split if followed by whitespace or end of string
    if (end === text.length || /\s/.test(text[end])) {
      const sentence = text.slice(start, end).trim()
      if (sentence) {
        sentences.push(sentence)
      }

      // Skip whitespace after the sentence
      while (end < text.length && /\s/.test(text[end])) {
        end++
      }
      
      start = end
      i = end - 1
    }
  }

  // Handle any remaining text (no sentence-ending punctuation)
  const remaining = text.slice(start).trim()
  if (remaining) {
    sentences.push(remaining)
  }

  return sentences
}


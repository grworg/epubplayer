# Sentence-Boundary Text Chunking

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

TTS engines work best with appropriately-sized text chunks:
- **Too small**: Excessive overhead, choppy playback, poor prosody
- **Too large**: Long generation times, late first-audio, large cache entries
- **Mid-word splits**: Terrible audio quality, broken words

We need a chunking strategy that balances these concerns while maintaining natural speech flow.

## Decision

Split text into chunks at **sentence boundaries only**. Never split mid-sentence, even if a sentence exceeds the target chunk size.

Algorithm:
1. Target chunk size: ~300 characters (configurable)
2. Accumulate sentences until reaching the target
3. When adding a sentence would exceed target, start a new chunk
4. Single long sentences stay whole (better audio than splitting)

Sentence boundaries detected by: `.` `!` `?` `…` followed by whitespace or end-of-string.

Each chunk gets a **stable text hash** (SHA-256 truncated) for cache keying.

## Consequences

### Positive

- **Natural prosody**: TTS engines can apply proper intonation within sentences
- **No broken words**: Never cut mid-word or mid-phrase
- **Stable cache keys**: Same text always produces same hash, enabling cache reuse
- **Predictable generation**: Chunk size is bounded and consistent
- **Good resume granularity**: Can resume within a few sentences of where you left off

### Negative

- **Variable chunk sizes**: A 500-character sentence becomes a 500-character chunk
- **Long sentences = long waits**: A very long sentence must fully generate before playback
- **Edge cases**: Quoted speech, abbreviations (Dr., Mr.) can cause mis-splits
- **Language-dependent**: Punctuation rules vary by language

### Neutral

- Chunk boundaries don't align with paragraph or chapter boundaries
- Users can't seek to arbitrary positions within chunks (only chunk boundaries)

## Alternatives Considered

### Alternative 1: Fixed-Size Chunking

Split at exactly N characters, regardless of content.

**Rejected because:**
- Breaks words mid-syllable ("The qui" / "ck brown fox")
- Terrible audio quality at boundaries
- TTS engines handle this very poorly

### Alternative 2: Word-Boundary Chunking

Split at word boundaries, targeting a character count.

**Rejected because:**
- Still breaks sentences, producing unnatural pauses
- TTS prosody suffers when sentences are split
- Only marginally better than fixed-size

### Alternative 3: Paragraph Chunking

One chunk per paragraph.

**Rejected because:**
- Paragraphs vary wildly in length (1 sentence to 20+)
- Very long paragraphs = very long generation times
- Doesn't solve the core problem

### Alternative 4: TTS Engine's Native Chunking

Let each TTS engine decide how to chunk.

**Rejected because:**
- Different engines would produce different chunks
- Can't cache audio across engine switches
- Lose control over chunk size and cache keys

## References

- [Kokoro Chunking Recommendations](https://github.com/hexgrad/kokoro#usage) - Library docs
- Text hash implementation uses Web Crypto API's SHA-256


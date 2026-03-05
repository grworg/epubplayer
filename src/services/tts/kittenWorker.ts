/**
 * KittenTTS Web Worker
 *
 * Lightweight 15M-parameter neural TTS using KittenTTS Nano v0.1.
 * Uses ONNX Runtime Web (WASM) for inference — no GPU required.
 * Model: ~24MB, 8 voices, 24kHz output.
 *
 * Pipeline: text → phonemize (eSpeak WASM) → tokenize → ONNX → waveform → WAV
 */

// ============================================================================
// Worker Logger
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const workerLog = {
  debug: (message: string, data?: unknown) => postLog('debug', message, data),
  info: (message: string, data?: unknown) => postLog('info', message, data),
  warn: (message: string, data?: unknown) => postLog('warn', message, data),
  error: (message: string, data?: unknown) => postLog('error', message, data),
}

function postLog(level: LogLevel, message: string, data?: unknown) {
  try {
    postMessage({
      type: 'log',
      level,
      subsystem: 'tts',
      message,
      data: serializeForLog(data),
      ts: Date.now(),
    })
  } catch {
    console[level](`[tts:kitten] ${message}`, data)
  }
}

function serializeForLog(data: unknown): unknown {
  if (data === undefined) return undefined
  if (data instanceof Error) {
    return { __type: 'Error', name: data.name, message: data.message, stack: data.stack }
  }
  if (typeof data !== 'object' || data === null) return data
  try {
    JSON.stringify(data)
    return data
  } catch {
    return String(data)
  }
}

// ============================================================================
// Types
// ============================================================================

interface InitMessage {
  type: 'init'
  voiceId: string
}

interface GenerateMessage {
  type: 'generate'
  requestId: string
  text: string
  voiceId: string
  speed: number
}

interface SetVoiceMessage {
  type: 'setVoice'
  voiceId: string
}

interface CancelMessage {
  type: 'cancel'
  requestId?: string
}

type WorkerMessage = InitMessage | GenerateMessage | SetVoiceMessage | CancelMessage

// ============================================================================
// Constants
// ============================================================================

const MODEL_URL = 'https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx'
const VOICES_URL = 'https://raw.githubusercontent.com/clowerweb/kitten-tts-web-demo/main/public/tts-model/voices.json'
const SAMPLE_RATE = 24000

// ============================================================================
// Tokenizer Vocabulary (from KittenTTS tokenizer.json, embedded for zero-latency loading)
// ============================================================================

const VOCAB: Record<string, number> = {
  '$': 0, ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6,
  '\u00a1': 7, '\u00bf': 8, '\u2014': 9, '\u2026': 10,
  '"': 15, '\u00ab': 12, '\u00bb': 13, ' ': 16,
  'A': 17, 'B': 18, 'C': 19, 'D': 20, 'E': 21, 'F': 22, 'G': 23,
  'H': 24, 'I': 25, 'J': 26, 'K': 27, 'L': 28, 'M': 29, 'N': 30,
  'O': 31, 'P': 32, 'Q': 33, 'R': 34, 'S': 35, 'T': 36, 'U': 37,
  'V': 38, 'W': 39, 'X': 40, 'Y': 41, 'Z': 42,
  'a': 43, 'b': 44, 'c': 45, 'd': 46, 'e': 47, 'f': 48, 'g': 49,
  'h': 50, 'i': 51, 'j': 52, 'k': 53, 'l': 54, 'm': 55, 'n': 56,
  'o': 57, 'p': 58, 'q': 59, 'r': 60, 's': 61, 't': 62, 'u': 63,
  'v': 64, 'w': 65, 'x': 66, 'y': 67, 'z': 68,
  '\u0251': 69, '\u0250': 70, '\u0252': 71, '\u00e6': 72,
  '\u0253': 73, '\u0299': 74, '\u03b2': 75, '\u0254': 76,
  '\u0255': 77, '\u00e7': 78, '\u0257': 79, '\u0256': 80,
  '\u00f0': 81, '\u02a4': 82, '\u0259': 83, '\u0258': 84,
  '\u025a': 85, '\u025b': 86, '\u025c': 87, '\u025d': 88,
  '\u025e': 89, '\u025f': 90, '\u0284': 91, '\u0261': 92,
  '\u0260': 93, '\u0262': 94, '\u029b': 95, '\u0266': 96,
  '\u0267': 97, '\u0127': 98, '\u0265': 99, '\u029c': 100,
  '\u0268': 101, '\u026a': 102, '\u029d': 103, '\u026d': 104,
  '\u026c': 105, '\u026b': 106, '\u026e': 107, '\u029f': 108,
  '\u0271': 109, '\u026f': 110, '\u0270': 111, '\u014b': 112,
  '\u0273': 113, '\u0272': 114, '\u0274': 115, '\u00f8': 116,
  '\u0275': 117, '\u0278': 118, '\u03b8': 119, '\u0153': 120,
  '\u0276': 121, '\u0298': 122, '\u0279': 123, '\u027a': 124,
  '\u027e': 125, '\u027b': 126, '\u0280': 127, '\u0281': 128,
  '\u027d': 129, '\u0282': 130, '\u0283': 131, '\u0288': 132,
  '\u02a7': 133, '\u0289': 134, '\u028a': 135, '\u028b': 136,
  '\u2c71': 137, '\u028c': 138, '\u0263': 139, '\u0264': 140,
  '\u028d': 141, '\u03c7': 142, '\u028e': 143, '\u028f': 144,
  '\u0291': 145, '\u0290': 146, '\u0292': 147, '\u0294': 148,
  '\u02a1': 149, '\u0295': 150, '\u02a2': 151,
  '\u01c0': 152, '\u01c1': 153, '\u01c2': 154, '\u01c3': 155,
  '\u02c8': 156, '\u02cc': 157, '\u02d0': 158, '\u02d1': 159,
  '\u02bc': 160, '\u02b4': 161, '\u02b0': 162, '\u02b1': 163,
  '\u02b2': 164, '\u02b7': 165, '\u02e0': 166, '\u02e4': 167,
  '\u02de': 168, '\u2193': 169, '\u2191': 170, '\u2192': 171,
  '\u2197': 172, '\u2198': 173, "'": 176, '\u0329': 175,
  '\u1d7b': 177,
}

// ============================================================================
// Worker State
// ============================================================================

let ort: any = null
let session: any = null
let phonemizeFn: ((text: string, lang: string) => Promise<string>) | null = null
let voiceEmbeddings: Record<string, number[][]> = {}
let currentVoiceId = 'expr-voice-2-m'
let isInitialized = false
let isInitializing = false
let inferenceCount = 0

const cancelledRequests = new Set<string>()
let cancelAll = false
let generateQueue: Promise<void> = Promise.resolve()

// ============================================================================
// Text Processing
// ============================================================================

const EMOJI_RE = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{FE0F}]|[\u{200D}]/gu

function cleanText(text: string): string {
  if (!text) return ''
  return text
    .replace(EMOJI_RE, '')
    .replace(/\b\/\b/, ' slash ')
    .replace(/[/\\()¯]/g, '')
    .replace(/["""\u201C\u201D]/g, '')
    .replace(/\s\u2014/g, '.')
    .replace(/\b_\b/g, ' ')
    .replace(/\b-\b/g, ' ')
    .replace(/[^\u0000-\u024F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(phonemes: string): number[] {
  const wrapped = `$${phonemes}$`
  return wrapped.split('').map(char => {
    const id = VOCAB[char]
    if (id === undefined) return 0
    return id
  })
}

// ============================================================================
// ONNX Runtime Loading
// ============================================================================

async function loadOrt(): Promise<any> {
  if (ort) return ort
  // @ts-expect-error Dynamic import from CDN
  const module = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/ort.all.mjs')
  ort = module
  ort.env.wasm.proxy = false
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4
  ort.env.wasm.numThreads = cores
  workerLog.info('ONNX Runtime WASM configured', { numThreads: cores, hardwareConcurrency: cores })
  return ort
}

async function loadPhonemizer(): Promise<void> {
  if (phonemizeFn) return
  // @ts-expect-error Dynamic import from CDN
  const mod = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/+esm')
  phonemizeFn = mod.phonemize
}

// ============================================================================
// Model Loading
// ============================================================================

async function loadModel(
  onProgress: (status: string, progress: number) => void
): Promise<void> {
  onProgress('Loading ONNX Runtime...', 0.05)
  const ortModule = await loadOrt()

  onProgress('Loading phonemizer...', 0.1)
  await loadPhonemizer()

  onProgress('Loading KittenTTS model (~24MB)...', 0.15)
  const modelResponse = await fetch(MODEL_URL)
  if (!modelResponse.ok) throw new Error(`Failed to fetch model: ${modelResponse.status}`)
  const modelBuffer = await modelResponse.arrayBuffer()

  onProgress('Creating inference session...', 0.7)
  session = await ortModule.InferenceSession.create(modelBuffer, {
    executionProviders: [{ name: 'wasm', simd: true }],
  })

  onProgress('Loading voice embeddings...', 0.85)
  const voicesResponse = await fetch(VOICES_URL)
  if (!voicesResponse.ok) throw new Error(`Failed to fetch voices: ${voicesResponse.status}`)
  voiceEmbeddings = await voicesResponse.json()

  onProgress('Ready!', 1.0)
}

// ============================================================================
// WAV Generation
// ============================================================================

function createWavBlob(audioData: Float32Array): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = SAMPLE_RATE * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = audioData.length * 2

  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const int16Data = new Int16Array(audioData.length)
  for (let i = 0; i < audioData.length; i++) {
    int16Data[i] = Math.floor(Math.max(-1, Math.min(1, audioData[i])) * 32767)
  }
  new Uint8Array(buffer, 44).set(new Uint8Array(int16Data.buffer))

  return new Blob([buffer], { type: 'audio/wav' })
}

// ============================================================================
// Audio Post-Processing
// ============================================================================

function normalizePeak(samples: Float32Array, target = 0.9): void {
  let max = 1e-9
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]))
  const gain = Math.min(4, target / max)
  if (gain < 1) {
    for (let i = 0; i < samples.length; i++) samples[i] *= gain
  }
}

function trimSilence(samples: Float32Array, thresh = 0.002): Float32Array {
  const padding = Math.floor(SAMPLE_RATE * 0.02) // 20ms
  let start = 0
  let end = samples.length - 1
  while (start < end && Math.abs(samples[start]) < thresh) start++
  while (end > start && Math.abs(samples[end]) < thresh) end--
  start = Math.max(0, start - padding)
  end = Math.min(samples.length, end + padding)
  return samples.slice(start, end)
}

// ============================================================================
// Inference
// ============================================================================

const MAX_TOKEN_LENGTH = 450

function splitIntoSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text]
  return parts.map(p => p.trim()).filter(p => p.length > 0)
}

async function runSingleInference(cleaned: string, embedding: number[][], speed: number): Promise<Float32Array> {
  const phonemes = await phonemizeFn!(cleaned, 'en-us')
  const tokenIds = tokenize(phonemes)

  if (tokenIds.length > MAX_TOKEN_LENGTH) {
    workerLog.warn('Token sequence still too long after splitting, truncating', { tokens: tokenIds.length, max: MAX_TOKEN_LENGTH })
    tokenIds.length = MAX_TOKEN_LENGTH
  }

  const inputIds = new BigInt64Array(tokenIds.map(id => BigInt(id)))
  const speakerEmbedding = new Float32Array(embedding[0])

  const inputs = {
    'input_ids': new ort.Tensor('int64', inputIds, [1, inputIds.length]),
    'style': new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]),
    'speed': new ort.Tensor('float32', new Float32Array([speed]), [1]),
  }

  const results = await session.run(inputs)
  const audioData = new Float32Array(results.waveform.data as Float32Array)

  let hasNaN = false
  for (let i = 0; i < Math.min(100, audioData.length); i++) {
    if (isNaN(audioData[i])) { hasNaN = true; break }
  }
  if (hasNaN) {
    workerLog.warn('NaN values in audio output, replacing with silence')
    for (let i = 0; i < audioData.length; i++) {
      if (isNaN(audioData[i])) audioData[i] = 0
    }
  }

  return audioData
}

async function runInference(text: string, voiceId: string, speed: number): Promise<{ wav: Float32Array; duration: number }> {
  if (!session || !phonemizeFn || !ort) {
    throw new Error('Not initialized')
  }

  let embedding = voiceEmbeddings[voiceId]
  if (!embedding) {
    const availableVoices = Object.keys(voiceEmbeddings)
    const fallback = availableVoices[0]
    if (!fallback) throw new Error('No voice embeddings loaded')
    workerLog.warn('Unknown voice, falling back', { requested: voiceId, fallback })
    embedding = voiceEmbeddings[fallback]
  }

  const cleaned = cleanText(text)
  if (!cleaned) {
    return { wav: new Float32Array(0), duration: 0 }
  }

  const phonemes = await phonemizeFn(cleaned, 'en-us')
  const tokenIds = tokenize(phonemes)

  if (tokenIds.length <= MAX_TOKEN_LENGTH) {
    let audioData = await runSingleInference(cleaned, embedding, speed)
    normalizePeak(audioData)
    audioData = trimSilence(audioData)
    return { wav: audioData, duration: audioData.length / SAMPLE_RATE }
  }

  workerLog.info('Text too long for single inference, splitting', { tokens: tokenIds.length, textLength: cleaned.length })
  const sentences = splitIntoSentences(cleaned)
  const audioSegments: Float32Array[] = []

  for (const sentence of sentences) {
    if (!sentence.trim()) continue
    const segment = await runSingleInference(sentence, embedding, speed)
    if (segment.length > 0) {
      audioSegments.push(segment)
    }
  }

  if (audioSegments.length === 0) {
    return { wav: new Float32Array(0), duration: 0 }
  }

  const totalLength = audioSegments.reduce((sum, s) => sum + s.length, 0)
  let combined = new Float32Array(totalLength)
  let offset = 0
  for (const segment of audioSegments) {
    combined.set(segment, offset)
    offset += segment.length
  }

  normalizePeak(combined)
  combined = trimSilence(combined)

  return {
    wav: combined,
    duration: combined.length / SAMPLE_RATE,
  }
}

// ============================================================================
// Message Handlers
// ============================================================================

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data

  switch (message.type) {
    case 'init':
      await handleInit(message)
      break

    case 'generate':
      generateQueue = generateQueue
        .then(() => handleGenerate(message))
        .catch((e) => {
          postMessage({
            type: 'error',
            requestId: message.requestId,
            message: e instanceof Error ? e.message : 'Generation failed',
          })
        })
      break

    case 'setVoice':
      currentVoiceId = message.voiceId
      break

    case 'cancel':
      if (message.requestId) {
        cancelledRequests.add(message.requestId)
      } else {
        cancelAll = true
        workerLog.debug('Cancel all requested')
        setTimeout(() => {
          cancelAll = false
          cancelledRequests.clear()
          workerLog.debug('Cancel state auto-reset')
        }, 100)
      }
      break
  }
}

async function handleInit(message: InitMessage) {
  if (isInitialized || isInitializing) {
    if (isInitialized) {
      postMessage({ type: 'ready', voices: Object.keys(voiceEmbeddings) })
    }
    return
  }

  isInitializing = true

  try {
    workerLog.info('Initializing KittenTTS worker')
    currentVoiceId = message.voiceId || 'expr-voice-2-m'

    await loadModel((status, progress) => {
      postMessage({ type: 'progress', status, progress })
    })

    isInitialized = true
    isInitializing = false

    workerLog.info('KittenTTS worker ready', { voice: currentVoiceId, voices: Object.keys(voiceEmbeddings).length })
    postMessage({ type: 'ready', voices: Object.keys(voiceEmbeddings) })
  } catch (error) {
    workerLog.error('KittenTTS init error', error)
    isInitializing = false
    postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to initialize',
    })
  }
}

async function handleGenerate(message: GenerateMessage) {
  const { requestId, text, voiceId, speed } = message

  if (cancelAll || cancelledRequests.has(requestId)) {
    workerLog.debug('Generation skipped - cancelled', { requestId })
    cancelledRequests.delete(requestId)
    postMessage({ type: 'cancelled', requestId })
    return
  }

  if (!isInitialized || !session) {
    postMessage({ type: 'error', requestId, message: 'Not initialized' })
    return
  }

  try {
    inferenceCount++
    const inferenceNum = inferenceCount
    workerLog.debug('Starting inference', { inferenceNum, textPreview: text.substring(0, 50) })
    const startTime = performance.now()

    const { wav, duration } = await runInference(text, voiceId || currentVoiceId, speed)
    const inferenceTime = Math.round(performance.now() - startTime)

    if (cancelAll || cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      return
    }

    if (wav.length === 0) {
      postMessage({ type: 'cancelled', requestId })
      return
    }

    const blob = createWavBlob(wav)

    workerLog.debug('Generated audio', { inferenceNum, durationSec: duration, inferenceTimeMs: inferenceTime })

    postMessage({
      type: 'audio',
      requestId,
      audioBlob: blob,
      duration,
    })
  } catch (error) {
    workerLog.error('Generate error', error)
    if (!cancelAll && !cancelledRequests.has(requestId)) {
      postMessage({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : 'Generation failed',
      })
    }
    cancelledRequests.delete(requestId)
  }
}

/**
 * Piper TTS Web Worker
 *
 * Runs Piper/VITS TTS in a separate thread using sherpa-onnx WASM.
 * Much faster than Kokoro on CPU - designed for real-time inference.
 */

// ============================================================================
// Types
// ============================================================================

interface InitMessage {
  type: 'init'
  modelId: string
}

interface GenerateMessage {
  type: 'generate'
  requestId: string
  text: string
}

interface CancelMessage {
  type: 'cancel'
  requestId?: string
}

type WorkerMessage = InitMessage | GenerateMessage | CancelMessage

interface ProgressResponse {
  type: 'progress'
  status: string
  progress?: number
}

interface ReadyResponse {
  type: 'ready'
}

interface AudioResponse {
  type: 'audio'
  requestId: string
  audioBlob: Blob
  duration: number
}

interface ErrorResponse {
  type: 'error'
  requestId?: string
  message: string
}

interface LogResponse {
  type: 'log'
  level: 'debug' | 'log' | 'info' | 'warn' | 'error'
  ts: number
  args: unknown[]
}

// ============================================================================
// Worker State
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tts: any = null
let isInitializing = false
let currentModelId: string | null = null
const cancelledRequests = new Set<string>()
let cancelAll = false

// Sequential generation queue
let generateQueue: Promise<void> = Promise.resolve()

// ============================================================================
// Logging (forward to main thread for mobile debugging)
// ============================================================================

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack }
  }
  if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`
  try {
    structuredClone(arg)
    return arg
  } catch {
    try {
      return JSON.stringify(arg)
    } catch {
      return String(arg)
    }
  }
}

function postLog(level: LogResponse['level'], ...args: unknown[]) {
  try {
    postMessage({ type: 'log', level, ts: Date.now(), args: args.map(serializeArg) } as LogResponse)
  } catch {
    // ignore
  }
}

// Capture original console methods before patching
const _debug = console.debug.bind(console)
const _log = console.log.bind(console)
const _info = console.info.bind(console)
const _warn = console.warn.bind(console)
const _error = console.error.bind(console)

;(console as unknown as Record<string, (...a: unknown[]) => void>).debug = (...args: unknown[]) => {
  try {
    _debug(...args)
  } finally {
    postLog('debug', ...args)
  }
}
;(console as unknown as Record<string, (...a: unknown[]) => void>).log = (...args: unknown[]) => {
  try {
    _log(...args)
  } finally {
    postLog('log', ...args)
  }
}
;(console as unknown as Record<string, (...a: unknown[]) => void>).info = (...args: unknown[]) => {
  try {
    _info(...args)
  } finally {
    postLog('info', ...args)
  }
}
;(console as unknown as Record<string, (...a: unknown[]) => void>).warn = (...args: unknown[]) => {
  try {
    _warn(...args)
  } finally {
    postLog('warn', ...args)
  }
}
;(console as unknown as Record<string, (...a: unknown[]) => void>).error = (...args: unknown[]) => {
  try {
    _error(...args)
  } finally {
    postLog('error', ...args)
  }
}

self.addEventListener('error', (e) => {
  postLog('error', '[piperWorker.error]', (e as ErrorEvent).message, (e as ErrorEvent).error)
})
self.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postLog('error', '[piperWorker.unhandledrejection]', (e as any).reason)
})

// ============================================================================
// Model Configuration
// ============================================================================

// Piper models hosted on Hugging Face (sherpa-onnx format)
const MODEL_CONFIGS: Record<string, { modelUrl: string; tokensUrl: string; sampleRate: number }> = {
  'en_US-amy-medium': {
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
    tokensUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
    sampleRate: 22050,
  },
  'en_US-lessac-medium': {
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    tokensUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    sampleRate: 22050,
  },
  'en_GB-alba-medium': {
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx',
    tokensUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json',
    sampleRate: 22050,
  },
  'en_GB-jenny_dioco-medium': {
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx',
    tokensUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json',
    sampleRate: 22050,
  },
}

// ============================================================================
// Message Handler
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
          } as ErrorResponse)
        })
      break

    case 'cancel':
      handleCancel(message)
      break
  }
}

async function handleInit(message: InitMessage) {
  if (tts && currentModelId === message.modelId) {
    postMessage({ type: 'ready' } as ReadyResponse)
    return
  }

  if (isInitializing) {
    return
  }

  isInitializing = true

  try {
    console.log('[piperWorker] init', { modelId: message.modelId })
    postMessage({
      type: 'progress',
      status: 'Loading Piper TTS...',
      progress: 0,
    } as ProgressResponse)

    const modelConfig = MODEL_CONFIGS[message.modelId]
    if (!modelConfig) {
      throw new Error(`Unknown Piper model: ${message.modelId}`)
    }

    postMessage({
      type: 'progress',
      status: 'Downloading model...',
      progress: 0.1,
    } as ProgressResponse)

    // Fetch model and config files
    const [modelResponse, configResponse] = await Promise.all([
      fetch(modelConfig.modelUrl),
      fetch(modelConfig.tokensUrl),
    ])

    if (!modelResponse.ok) {
      throw new Error(`Failed to download model: ${modelResponse.status}`)
    }
    if (!configResponse.ok) {
      throw new Error(`Failed to download config: ${configResponse.status}`)
    }

    postMessage({
      type: 'progress',
      status: 'Loading model into memory...',
      progress: 0.5,
    } as ProgressResponse)

    const modelBuffer = await modelResponse.arrayBuffer()
    const configJson = await configResponse.json()

    postMessage({
      type: 'progress',
      status: 'Initializing ONNX Runtime...',
      progress: 0.7,
    } as ProgressResponse)

    // Initialize ONNX Runtime for WASM
    // Use same version and path as Supertonic worker for consistency
    // @ts-expect-error - Dynamic import from CDN
    const ortModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/ort.all.mjs')
    
    console.log('[piperWorker] ONNX module loaded:', Object.keys(ortModule || {}).slice(0, 10))
    
    if (!ortModule || !ortModule.InferenceSession) {
      throw new Error('ONNX Runtime failed to load. Try using Browser TTS instead.')
    }
    
    // Configure ONNX Runtime for WASM - must disable proxy for worker context
    ortModule.env.wasm.proxy = false
    ortModule.env.wasm.numThreads = 1
    ortModule.env.wasm.simd = true
    
    // Create inference session with WASM backend
    const session = await ortModule.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })

    postMessage({
      type: 'progress',
      status: 'Model loaded!',
      progress: 1,
    } as ProgressResponse)

    // Store TTS state
    tts = {
      session,
      config: configJson,
      sampleRate: modelConfig.sampleRate,
      ort: ortModule,
    }
    currentModelId = message.modelId

    console.log('[piperWorker] ready')
    postMessage({ type: 'ready' } as ReadyResponse)
  } catch (error) {
    console.error('[piperWorker] init error', error)
    postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to load Piper model',
    } as ErrorResponse)
  } finally {
    isInitializing = false
  }
}

async function handleGenerate(message: GenerateMessage) {
  const { requestId, text } = message

  if (cancelAll || cancelledRequests.has(requestId)) {
    cancelledRequests.delete(requestId)
    return
  }

  if (!tts) {
    postMessage({
      type: 'error',
      requestId,
      message: 'Piper model not loaded',
    } as ErrorResponse)
    return
  }

  try {
    console.log('[piperWorker] generate start', { requestId, chars: text.length })
    
    // Convert text to phoneme IDs using the config
    const phonemeIds = textToPhonemeIds(text, tts.config)
    
    if (cancelAll || cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      return
    }

    // Create input tensor
    const inputTensor = new tts.ort.Tensor('int64', BigInt64Array.from(phonemeIds.map(BigInt)), [1, phonemeIds.length])
    const inputLengths = new tts.ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1])
    const scales = new tts.ort.Tensor('float32', Float32Array.from([1.0, 1.0, 1.0]), [3]) // noise_scale, length_scale, noise_w

    // Run inference
    const feeds: Record<string, unknown> = {
      input: inputTensor,
      input_lengths: inputLengths,
      scales: scales,
    }
    
    const results = await tts.session.run(feeds)
    
    if (cancelAll || cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      return
    }

    // Get audio output
    const audioData = results.output.data as Float32Array
    
    // Convert to WAV blob
    const wavBlob = float32ToWav(audioData, tts.sampleRate)
    
    // Calculate duration
    const duration = audioData.length / tts.sampleRate

    postMessage({
      type: 'audio',
      requestId,
      audioBlob: wavBlob,
      duration,
    } as AudioResponse)
    
    console.log('[piperWorker] generate done', { requestId, duration })
  } catch (error) {
    console.error('[piperWorker] generate error', { requestId }, error)
    if (!cancelAll && !cancelledRequests.has(requestId)) {
      postMessage({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : 'Failed to generate audio',
      } as ErrorResponse)
    }
    cancelledRequests.delete(requestId)
  }
}

function handleCancel(message: CancelMessage) {
  if (message.requestId) {
    cancelledRequests.add(message.requestId)
  } else {
    cancelAll = true
    setTimeout(() => {
      cancelAll = false
      cancelledRequests.clear()
    }, 100)
  }
}

// ============================================================================
// Text to Phoneme Conversion
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textToPhonemeIds(text: string, config: any): number[] {
  // Piper uses espeak-ng phonemes, but for simplicity we'll use character-based tokenization
  // This is a simplified approach - production would use proper phonemization
  
  const phonemeIdMap: Record<string, number> = config.phoneme_id_map || {}
  const ids: number[] = []
  
  // Add start token if present
  if (phonemeIdMap['^']) {
    ids.push(phonemeIdMap['^'])
  }
  
  // Convert text to lowercase and tokenize
  const normalized = text.toLowerCase()
  
  for (const char of normalized) {
    if (phonemeIdMap[char] !== undefined) {
      ids.push(phonemeIdMap[char])
    } else if (phonemeIdMap[' '] !== undefined && char === ' ') {
      ids.push(phonemeIdMap[' '])
    }
    // Skip unknown characters
  }
  
  // Add end token if present
  if (phonemeIdMap['$']) {
    ids.push(phonemeIdMap['$'])
  }
  
  return ids
}

// ============================================================================
// Audio Encoding
// ============================================================================

function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, totalSize - 8, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Convert float32 to int16
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, int16, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

// Mark as module
export {}


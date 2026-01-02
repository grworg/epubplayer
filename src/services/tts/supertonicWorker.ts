/**
 * Supertonic TTS Web Worker - Simplified Version
 * 
 * Uses the official Supertonic helper.js directly for inference.
 * Adds instrumentation to measure memory and performance.
 */

// ============================================================================
// Worker Logger (posts structured logs to main thread)
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
    // Fallback to console if postMessage fails
    console[level](`[tts:worker] ${message}`, data)
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
  device: 'wasm' | 'webgpu'
}

interface GenerateMessage {
  type: 'generate'
  requestId: string
  text: string
  voiceId: string
  totalSteps: number
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

const MODEL_BASE_URL = 'https://huggingface.co/Supertone/supertonic/resolve/main'

// ============================================================================
// Worker State
// ============================================================================

let ort: any = null
let textToSpeech: any = null
let currentStyle: any = null
let currentVoiceId = 'F1'
let sampleRate = 44100
let isInitialized = false
let isInitializing = false
let executionBackend: 'webgpu' | 'wasm' = 'wasm'

// Instrumentation
let inferenceCount = 0
let totalInferenceTimeMs = 0

const cancelledRequests = new Set<string>()
let cancelAll = false
let generateQueue: Promise<void> = Promise.resolve()

// ============================================================================
// Instrumentation / Probing
// ============================================================================

interface MemoryProbe {
  timestamp: number
  inferenceNum: number
  jsHeapUsedMB?: number
  jsHeapTotalMB?: number
  // WebGPU doesn't expose memory info directly, but we can track our own metrics
  audioSamplesGenerated: number
  inferenceTimeMs: number
}

const memoryProbes: MemoryProbe[] = []

function probeMemory(inferenceNum: number, inferenceTimeMs: number, audioSamples: number): MemoryProbe {
  const probe: MemoryProbe = {
    timestamp: Date.now(),
    inferenceNum,
    audioSamplesGenerated: audioSamples,
    inferenceTimeMs,
  }
  
  // Try to get JS heap info (Chrome only)
  if ((performance as any).memory) {
    const mem = (performance as any).memory
    probe.jsHeapUsedMB = Math.round(mem.usedJSHeapSize / 1024 / 1024 * 100) / 100
    probe.jsHeapTotalMB = Math.round(mem.totalJSHeapSize / 1024 / 1024 * 100) / 100
  }
  
  memoryProbes.push(probe)
  
  // Keep only last 50 probes
  if (memoryProbes.length > 50) {
    memoryProbes.shift()
  }
  
  return probe
}

function logProbe(probe: MemoryProbe) {
  workerLog.debug('Memory probe', {
    inferenceNum: probe.inferenceNum,
    heapUsedMB: probe.jsHeapUsedMB,
    heapTotalMB: probe.jsHeapTotalMB,
    inferenceTimeMs: probe.inferenceTimeMs,
    audioSamples: probe.audioSamplesGenerated,
  })
}

function analyzeProbes() {
  if (memoryProbes.length < 2) return
  
  const first = memoryProbes[0]
  const last = memoryProbes[memoryProbes.length - 1]
  
  if (first.jsHeapUsedMB && last.jsHeapUsedMB) {
    const heapGrowth = last.jsHeapUsedMB - first.jsHeapUsedMB
    const avgTimeFirst5 = memoryProbes.slice(0, 5).reduce((a, b) => a + b.inferenceTimeMs, 0) / Math.min(5, memoryProbes.length)
    const avgTimeLast5 = memoryProbes.slice(-5).reduce((a, b) => a + b.inferenceTimeMs, 0) / Math.min(5, memoryProbes.length)
    
    workerLog.debug('Memory analysis', {
      heapGrowthMB: heapGrowth,
      inferences: memoryProbes.length,
      avgTimeFirst5ms: avgTimeFirst5,
      avgTimeLast5ms: avgTimeLast5,
    })
    
    if (heapGrowth > 50) {
      workerLog.warn('Significant heap growth detected - possible memory leak', { heapGrowthMB: heapGrowth })
    }
    if (avgTimeLast5 > avgTimeFirst5 * 1.5) {
      workerLog.warn('Inference slowdown detected - performance degrading', { avgTimeFirst5ms: avgTimeFirst5, avgTimeLast5ms: avgTimeLast5 })
    }
  }
}

// ============================================================================
// Audio Quality Analysis
// ============================================================================

function analyzeAudioQuality(samples: number[]): { 
  silenceRatio: number
  maxAmplitude: number
  avgAmplitude: number
  hasClipping: boolean
  suspiciousPattern: boolean
} {
  if (samples.length === 0) {
    return { silenceRatio: 1, maxAmplitude: 0, avgAmplitude: 0, hasClipping: false, suspiciousPattern: true }
  }
  
  let silentSamples = 0
  let maxAmp = 0
  let sumAmp = 0
  let clippedSamples = 0
  
  for (const sample of samples) {
    const abs = Math.abs(sample)
    if (abs < 0.001) silentSamples++
    if (abs > maxAmp) maxAmp = abs
    sumAmp += abs
    if (abs > 0.99) clippedSamples++
  }
  
  const silenceRatio = silentSamples / samples.length
  const avgAmplitude = sumAmp / samples.length
  const hasClipping = clippedSamples > samples.length * 0.01 // >1% clipped
  
  // Suspicious if >50% silence or very low average amplitude
  const suspiciousPattern = silenceRatio > 0.5 || avgAmplitude < 0.01
  
  return { silenceRatio, maxAmplitude: maxAmp, avgAmplitude, hasClipping, suspiciousPattern }
}

// ============================================================================
// ONNX Runtime Loading
// ============================================================================

async function loadOrt(): Promise<any> {
  if (ort) return ort

  // @ts-expect-error Dynamic import from CDN
  // Upgraded to 1.23.2 - may have WebGPU fixes
  const module = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.all.mjs')
  ort = module
  ort.env.wasm.proxy = false
  return ort
}

async function checkWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu
    if (!gpu) return false
    const adapter = await gpu.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}

// ============================================================================
// Supertonic Helper Classes (inline from official helper.js)
// ============================================================================

class UnicodeProcessor {
  private indexer: number[]
  
  constructor(indexer: number[]) {
    this.indexer = indexer
  }

  call(textList: string[]) {
    const processedTexts = textList.map(text => this.preprocessText(text))
    const textIdsLengths = processedTexts.map(text => text.length)
    const maxLen = Math.max(...textIdsLengths)
    
    const textIds = processedTexts.map(text => {
      const row = new Array(maxLen).fill(0)
      for (let j = 0; j < text.length; j++) {
        const codePoint = text.codePointAt(j)!
        row[j] = (codePoint < this.indexer.length) ? this.indexer[codePoint] : -1
      }
      return row
    })
    
    const textMask = this.getTextMask(textIdsLengths)
    return { textIds, textMask }
  }

  preprocessText(text: string): string {
    text = text.normalize('NFKD')
    
    // Remove emojis
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '')
    
    // Replace various dashes and symbols
    const replacements: Record<string, string> = {
      '–': '-', '‑': '-', '—': '-', '¯': ' ', '_': ' ',
      '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
      '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ',
      '#': ' ', '→': ' ', '←': ' ',
    }
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replaceAll(k, v)
    }
    
    // Remove combining diacritics
    text = text.replace(/[\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u030A\u030B\u030C\u0327\u0328\u0329\u032A\u032B\u032C\u032D\u032E\u032F]/g, '')
    
    // Remove special symbols
    text = text.replace(/[♥☆♡©\\]/g, '')
    
    // Replace known expressions
    text = text.replaceAll('@', ' at ')
    text = text.replaceAll('e.g.,', 'for example, ')
    text = text.replaceAll('i.e.,', 'that is, ')
    
    // Fix spacing
    text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!')
    text = text.replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':')
    
    // Remove duplicate quotes and extra spaces
    while (text.includes('""')) text = text.replace('""', '"')
    while (text.includes("''")) text = text.replace("''", "'")
    text = text.replace(/\s+/g, ' ').trim()
    
    // Add period if missing
    if (!/[.!?;:,'\"')\]}…。」』】〉》›»]$/.test(text)) {
      text += '.'
    }
    
    return text
  }

  getTextMask(textIdsLengths: number[]) {
    const maxLen = Math.max(...textIdsLengths)
    return textIdsLengths.map(len => {
      const row = new Array(maxLen).fill(0.0)
      for (let j = 0; j < Math.min(len, maxLen); j++) {
        row[j] = 1.0
      }
      return [row]
    })
  }
}

class TextToSpeech {
  private cfgs: any
  private textProcessor: UnicodeProcessor
  private dpOrt: any
  private textEncOrt: any
  private vectorEstOrt: any
  private vocoderOrt: any
  public sampleRate: number

  constructor(cfgs: any, textProcessor: UnicodeProcessor, dpOrt: any, textEncOrt: any, vectorEstOrt: any, vocoderOrt: any) {
    this.cfgs = cfgs
    this.textProcessor = textProcessor
    this.dpOrt = dpOrt
    this.textEncOrt = textEncOrt
    this.vectorEstOrt = vectorEstOrt
    this.vocoderOrt = vocoderOrt
    this.sampleRate = cfgs.ae.sample_rate
  }

  async call(
    text: string, 
    style: any, 
    totalStep: number, 
    speed = 1.05, 
    _silenceDuration = 0.3, 
    progressCallback?: (step: number, total: number) => void
  ): Promise<{ wav: number[]; duration: number[] }> {
    // Just call _infer with the text directly (no chunking - we handle that at service level)
    return this._infer([text], style, totalStep, speed, progressCallback)
  }

  private async _infer(
    textList: string[], 
    style: any, 
    totalStep: number, 
    speed = 1.05, 
    progressCallback?: (step: number, total: number) => void
  ): Promise<{ wav: number[]; duration: number[] }> {
    const bsz = textList.length
    
    // Process text
    const { textIds, textMask } = this.textProcessor.call(textList)
    
    const textIdsFlat = new BigInt64Array(textIds.flat().map(x => BigInt(x)))
    const textIdsShape = [bsz, textIds[0].length]
    const textIdsTensor = new ort.Tensor('int64', textIdsFlat, textIdsShape)
    
    const textMaskFlat = new Float32Array(textMask.flat(2))
    const textMaskShape = [bsz, 1, textMask[0][0].length]
    const textMaskTensor = new ort.Tensor('float32', textMaskFlat, textMaskShape)
    
    // Predict duration
    const dpOutputs = await this.dpOrt.run({
      text_ids: textIdsTensor,
      style_dp: style.dp,
      text_mask: textMaskTensor
    })
    const duration = Array.from(dpOutputs.duration.data as Float32Array)
    
    // Apply speed
    for (let i = 0; i < duration.length; i++) {
      duration[i] /= speed
    }
    
    // Encode text
    const textEncOutputs = await this.textEncOrt.run({
      text_ids: textIdsTensor,
      style_ttl: style.ttl,
      text_mask: textMaskTensor
    })
    const textEmb = textEncOutputs.text_emb
    
    // Sample noisy latent
    let { xt, latentMask } = this.sampleNoisyLatent(
      duration,
      this.sampleRate,
      this.cfgs.ae.base_chunk_size,
      this.cfgs.ttl.chunk_compress_factor,
      this.cfgs.ttl.latent_dim
    )
    
    const latentMaskFlat = new Float32Array(latentMask.flat(2))
    const latentMaskShape = [bsz, 1, latentMask[0][0].length]
    const latentMaskTensor = new ort.Tensor('float32', latentMaskFlat, latentMaskShape)
    
    const totalStepTensor = new ort.Tensor('float32', new Float32Array(bsz).fill(totalStep), [bsz])
    
    // Denoising loop
    for (let step = 0; step < totalStep; step++) {
      if (progressCallback) progressCallback(step + 1, totalStep)
      
      const currentStepTensor = new ort.Tensor('float32', new Float32Array(bsz).fill(step), [bsz])
      const xtFlat = new Float32Array(xt.flat(2))
      const xtShape = [bsz, xt[0].length, xt[0][0].length]
      const xtTensor = new ort.Tensor('float32', xtFlat, xtShape)
      
      const vectorEstOutputs = await this.vectorEstOrt.run({
        noisy_latent: xtTensor,
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: textMaskTensor,
        current_step: currentStepTensor,
        total_step: totalStepTensor
      })
      
      const denoised = Array.from(vectorEstOutputs.denoised_latent.data as Float32Array)
      
      // Reshape to 3D
      const latentDim = xt[0].length
      const latentLen = xt[0][0].length
      xt = []
      let idx = 0
      for (let b = 0; b < bsz; b++) {
        const batch: number[][] = []
        for (let d = 0; d < latentDim; d++) {
          const row: number[] = []
          for (let t = 0; t < latentLen; t++) {
            row.push(denoised[idx++])
          }
          batch.push(row)
        }
        xt.push(batch)
      }
    }
    
    // Generate waveform
    const finalXtFlat = new Float32Array(xt.flat(2))
    const finalXtShape = [bsz, xt[0].length, xt[0][0].length]
    const finalXtTensor = new ort.Tensor('float32', finalXtFlat, finalXtShape)
    
    const vocoderOutputs = await this.vocoderOrt.run({ latent: finalXtTensor })
    const wav = Array.from(vocoderOutputs.wav_tts.data as Float32Array)
    
    return { wav, duration }
  }

  private sampleNoisyLatent(duration: number[], sr: number, baseChunkSize: number, chunkCompress: number, latentDim: number) {
    const bsz = duration.length
    const maxDur = Math.max(...duration)
    const wavLenMax = Math.floor(maxDur * sr)
    const wavLengths = duration.map(d => Math.floor(d * sr))
    const chunkSize = baseChunkSize * chunkCompress
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize)
    const latentDimVal = latentDim * chunkCompress

    const xt: number[][][] = []
    for (let b = 0; b < bsz; b++) {
      const batch: number[][] = []
      for (let d = 0; d < latentDimVal; d++) {
        const row: number[] = []
        for (let t = 0; t < latentLen; t++) {
          // Box-Muller transform
          const u1 = Math.max(0.0001, Math.random())
          const u2 = Math.random()
          row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2))
        }
        batch.push(row)
      }
      xt.push(batch)
    }

    const latentLengths = wavLengths.map(len => Math.floor((len + chunkSize - 1) / chunkSize))
    const latentMask = latentLengths.map(len => {
      const row = new Array(latentLen).fill(0.0)
      for (let j = 0; j < Math.min(len, latentLen); j++) row[j] = 1.0
      return [row]
    })

    // Apply mask
    for (let b = 0; b < bsz; b++) {
      for (let d = 0; d < latentDimVal; d++) {
        for (let t = 0; t < latentLen; t++) {
          xt[b][d][t] *= latentMask[b][0][t]
        }
      }
    }

    return { xt, latentMask }
  }
}

// ============================================================================
// Loading Functions
// ============================================================================

async function loadModels(
  device: 'wasm' | 'webgpu',
  onProgress: (status: string, progress: number) => void
): Promise<TextToSpeech> {
  const ortModule = await loadOrt()
  
  // Determine backend
  let useWebGPU = false
  if (device === 'webgpu') {
    const hasWebGPU = await checkWebGPU()
    useWebGPU = hasWebGPU
    if (!hasWebGPU) {
      workerLog.warn('WebGPU requested but not available, falling back to WASM')
    }
  }
  
  executionBackend = useWebGPU ? 'webgpu' : 'wasm'
  workerLog.info('Using backend', { backend: executionBackend })
  
  const sessionOptions = useWebGPU
    ? { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }
    : { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  
  // Load config
  onProgress('Loading configuration...', 0.05)
  const configResponse = await fetch(`${MODEL_BASE_URL}/onnx/tts.json`)
  const cfgs = await configResponse.json()
  sampleRate = cfgs.ae.sample_rate
  
  // Load unicode indexer
  onProgress('Loading text processor...', 0.1)
  const indexerResponse = await fetch(`${MODEL_BASE_URL}/onnx/unicode_indexer.json`)
  const unicodeIndexer = await indexerResponse.json()
  const textProcessor = new UnicodeProcessor(unicodeIndexer)
  
  // Load ONNX models
  const models = [
    { name: 'Duration Predictor', path: 'duration_predictor.onnx', progress: 0.2 },
    { name: 'Text Encoder', path: 'text_encoder.onnx', progress: 0.4 },
    { name: 'Vector Estimator', path: 'vector_estimator.onnx', progress: 0.6 },
    { name: 'Vocoder', path: 'vocoder.onnx', progress: 0.85 },
  ]
  
  const sessions: any[] = []
  for (const model of models) {
    onProgress(`Loading ${model.name}...`, model.progress)
    const session = await ortModule.InferenceSession.create(
      `${MODEL_BASE_URL}/onnx/${model.path}`,
      sessionOptions
    )
    sessions.push(session)
  }
  
  const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = sessions
  
  onProgress('Models loaded!', 1.0)
  
  return new TextToSpeech(cfgs, textProcessor, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt)
}

async function loadVoiceStyle(voiceId: string): Promise<{ ttl: any; dp: any }> {
  workerLog.debug('Loading voice style', { voiceId })
  
  const response = await fetch(`${MODEL_BASE_URL}/voice_styles/${voiceId}.json`)
  if (!response.ok) throw new Error(`Failed to load voice style: ${voiceId}`)
  
  const voiceStyle = await response.json()
  
  const ttlDims = voiceStyle.style_ttl.dims
  const dpDims = voiceStyle.style_dp.dims
  const ttlData = new Float32Array(voiceStyle.style_ttl.data.flat(Infinity))
  const dpData = new Float32Array(voiceStyle.style_dp.data.flat(Infinity))
  
  return {
    ttl: new ort.Tensor('float32', ttlData, ttlDims),
    dp: new ort.Tensor('float32', dpData, dpDims)
  }
}

// ============================================================================
// WAV Generation
// ============================================================================

function createWavBlob(audioData: number[]): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
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
  view.setUint32(24, sampleRate, true)
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
      await handleSetVoice(message)
      break

    case 'cancel':
      if (message.requestId) {
        cancelledRequests.add(message.requestId)
      } else {
        // Cancel all and auto-reset after 100ms (matches Kokoro/Piper behavior)
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
      postMessage({ type: 'ready', backend: executionBackend })
    }
    return
  }

  isInitializing = true

  try {
    workerLog.info('Initializing Supertonic worker')

    textToSpeech = await loadModels(message.device, (status, progress) => {
      postMessage({ type: 'progress', status, progress })
    })

    postMessage({ type: 'progress', status: 'Loading voice style...', progress: 0.95 })
    currentVoiceId = message.voiceId || 'F1'
    currentStyle = await loadVoiceStyle(currentVoiceId)

    isInitialized = true
    isInitializing = false

    workerLog.info('Supertonic worker ready', { backend: executionBackend, voice: currentVoiceId })
    postMessage({ type: 'ready', backend: executionBackend })
  } catch (error) {
    workerLog.error('Supertonic init error', error)
    isInitializing = false
    postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to initialize',
    })
  }
}

async function handleGenerate(message: GenerateMessage) {
  const { requestId, text, voiceId, totalSteps, speed } = message

  if (cancelAll || cancelledRequests.has(requestId)) {
    workerLog.debug('Generation skipped - cancelled', { requestId, cancelAll, inCancelSet: cancelledRequests.has(requestId) })
    cancelledRequests.delete(requestId)
    // Send a cancelled response so the main thread doesn't wait forever
    postMessage({ type: 'cancelled', requestId })
    return
  }

  if (!isInitialized || !textToSpeech || !currentStyle) {
    postMessage({ type: 'error', requestId, message: 'Not initialized' })
    return
  }

  try {
    // Switch voice if needed
    if (voiceId !== currentVoiceId) {
      workerLog.debug('Switching voice', { from: currentVoiceId, to: voiceId })
      currentStyle = await loadVoiceStyle(voiceId)
      currentVoiceId = voiceId
    }

    inferenceCount++
    const inferenceNum = inferenceCount
    
    workerLog.debug('Starting inference', { inferenceNum, textPreview: text.substring(0, 50), backend: executionBackend })
    const startTime = performance.now()

    // THE SIMPLE CALL - just like their demo!
    const { wav, duration } = await textToSpeech.call(
      text,
      currentStyle,
      totalSteps,
      speed,
      0.3,
      (_step: number, _total: number) => {
        // Could emit progress here
      }
    )

    const inferenceTime = Math.round(performance.now() - startTime)
    totalInferenceTimeMs += inferenceTime

    // Analyze audio quality
    const quality = analyzeAudioQuality(wav)
    
    // Probe memory
    const probe = probeMemory(inferenceNum, inferenceTime, wav.length)
    logProbe(probe)
    
    // Log quality analysis
    workerLog.debug('Audio quality', {
      inferenceNum,
      silenceRatio: quality.silenceRatio,
      maxAmplitude: quality.maxAmplitude,
      avgAmplitude: quality.avgAmplitude,
      ok: !quality.suspiciousPattern,
    })
    
    // Warn if quality looks bad
    if (quality.suspiciousPattern) {
      workerLog.warn('Audio quality appears degraded', { inferenceNum, quality })
    }
    
    // Every 10 inferences, analyze trends
    if (inferenceNum % 10 === 0) {
      analyzeProbes()
    }

    if (cancelAll || cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      return
    }

    // Trim to predicted duration
    const predictedSamples = Math.floor(sampleRate * duration[0])
    const wavOut = wav.slice(0, Math.min(predictedSamples, wav.length))
    const actualDuration = wavOut.length / sampleRate

    const blob = createWavBlob(wavOut)

    workerLog.debug('Generated audio', { inferenceNum, durationSec: actualDuration, inferenceTimeMs: inferenceTime })

    postMessage({
      type: 'audio',
      requestId,
      audioBlob: blob,
      duration: actualDuration,
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

async function handleSetVoice(message: SetVoiceMessage) {
  if (!isInitialized) return

  try {
    workerLog.info('Setting voice', { voiceId: message.voiceId })
    currentStyle = await loadVoiceStyle(message.voiceId)
    currentVoiceId = message.voiceId
  } catch (error) {
    workerLog.error('Failed to set voice', { voiceId: message.voiceId, error })
    postMessage({
      type: 'error',
      message: `Failed to load voice: ${message.voiceId}`,
    })
  }
}


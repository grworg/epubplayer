/**
 * Sherpa-ONNX TTS Web Worker
 *
 * Uses pre-built WASM from k2-fsa HuggingFace Space.
 * Includes proper phonemization via bundled espeak-ng data.
 * 
 * Based on: https://huggingface.co/spaces/k2-fsa/web-assembly-tts-sherpa-onnx-en
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
}

interface GenerateMessage {
  type: 'generate'
  requestId: string
  text: string
  speakerId: number
  speed: number
}

interface CancelMessage {
  type: 'cancel'
  requestId?: string
}

type WorkerMessage = InitMessage | GenerateMessage | CancelMessage

// ============================================================================
// Constants
// ============================================================================

// Pre-built WASM files from k2-fsa HuggingFace Space
const WASM_BASE_URL = 'https://huggingface.co/spaces/k2-fsa/web-assembly-tts-sherpa-onnx-en/resolve/main'

// ============================================================================
// Worker State
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Module: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tts: any = null
let isInitialized = false
let isInitializing = false
let sampleRate = 22050

const cancelledRequests = new Set<string>()
let cancelAll = false
let generateQueue: Promise<void> = Promise.resolve()

// ============================================================================
// Sherpa-ONNX TTS Helper Functions (from official helper.js)
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function freeConfig(config: any, Module: any) {
  if ('buffer' in config) {
    Module._free(config.buffer)
  }
  if ('config' in config) {
    freeConfig(config.config, Module)
  }
  Module._free(config.ptr)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initSherpaOnnxOfflineTtsVitsModelConfig(config: any, Module: any) {
  const modelLen = Module.lengthBytesUTF8(config.model || '') + 1
  const lexiconLen = Module.lengthBytesUTF8(config.lexicon || '') + 1
  const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1
  const dataDirLen = Module.lengthBytesUTF8(config.dataDir || '') + 1
  const dictDir = ''
  const dictDirLen = Module.lengthBytesUTF8(dictDir) + 1

  const n = modelLen + lexiconLen + tokensLen + dataDirLen + dictDirLen
  const buffer = Module._malloc(n)
  const len = 8 * 4
  const ptr = Module._malloc(len)

  let offset = 0
  Module.stringToUTF8(config.model || '', buffer + offset, modelLen)
  offset += modelLen
  Module.stringToUTF8(config.lexicon || '', buffer + offset, lexiconLen)
  offset += lexiconLen
  Module.stringToUTF8(config.tokens || '', buffer + offset, tokensLen)
  offset += tokensLen
  Module.stringToUTF8(config.dataDir || '', buffer + offset, dataDirLen)
  offset += dataDirLen
  Module.stringToUTF8(dictDir, buffer + offset, dictDirLen)
  offset += dictDirLen

  offset = 0
  Module.setValue(ptr, buffer + offset, 'i8*')
  offset += modelLen
  Module.setValue(ptr + 4, buffer + offset, 'i8*')
  offset += lexiconLen
  Module.setValue(ptr + 8, buffer + offset, 'i8*')
  offset += tokensLen
  Module.setValue(ptr + 12, buffer + offset, 'i8*')
  offset += dataDirLen
  Module.setValue(ptr + 16, config.noiseScale || 0.667, 'float')
  Module.setValue(ptr + 20, config.noiseScaleW || 0.8, 'float')
  Module.setValue(ptr + 24, config.lengthScale || 1.0, 'float')
  Module.setValue(ptr + 28, buffer + offset, 'i8*')

  return { buffer, ptr, len }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initSherpaOnnxOfflineTtsModelConfig(config: any, Module: any) {
  const vitsConfig = initSherpaOnnxOfflineTtsVitsModelConfig(config.offlineTtsVitsModelConfig || {}, Module)
  
  const numThreadsLen = 4
  const debugLen = 4
  const providerLen = Module.lengthBytesUTF8(config.provider || 'cpu') + 1

  const n = numThreadsLen + debugLen + providerLen
  const buffer = Module._malloc(n)
  const len = 4 * 4 + vitsConfig.len
  const ptr = Module._malloc(len)

  let offset = 0
  Module.setValue(buffer + offset, config.numThreads || 1, 'i32')
  offset += numThreadsLen
  Module.setValue(buffer + offset, config.debug ? 1 : 0, 'i32')
  offset += debugLen
  Module.stringToUTF8(config.provider || 'cpu', buffer + offset, providerLen)

  offset = 0
  Module.setValue(ptr + offset, vitsConfig.ptr, 'i8*')
  offset += vitsConfig.len
  Module.setValue(ptr + offset, buffer, 'i32*')
  offset += 4
  Module.setValue(ptr + offset, buffer + numThreadsLen, 'i32*')
  offset += 4
  Module.setValue(ptr + offset, buffer + numThreadsLen + debugLen, 'i8*')

  return { buffer, ptr, len, config: vitsConfig }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initSherpaOnnxOfflineTtsConfig(config: any, Module: any) {
  const modelConfig = initSherpaOnnxOfflineTtsModelConfig(config.offlineTtsModelConfig || {}, Module)
  
  const ruleFstsLen = Module.lengthBytesUTF8(config.ruleFsts || '') + 1
  const ruleFarsLen = Module.lengthBytesUTF8(config.ruleFars || '') + 1
  
  const n = ruleFstsLen + ruleFarsLen + 4 + 4
  const buffer = Module._malloc(n)
  const len = modelConfig.len + 4 * 4
  const ptr = Module._malloc(len)

  let offset = 0
  Module.stringToUTF8(config.ruleFsts || '', buffer + offset, ruleFstsLen)
  offset += ruleFstsLen
  Module.stringToUTF8(config.ruleFars || '', buffer + offset, ruleFarsLen)
  offset += ruleFarsLen
  Module.setValue(buffer + offset, config.maxNumSentences || 1, 'i32')
  offset += 4
  Module.setValue(buffer + offset, config.silenceDuration || 0.2, 'float')

  offset = 0
  Module.setValue(ptr + offset, modelConfig.ptr, 'i8*')
  offset += modelConfig.len
  Module.setValue(ptr + offset, buffer, 'i8*')
  offset += 4
  Module.setValue(ptr + offset, buffer + ruleFstsLen, 'i8*')
  offset += 4
  Module.setValue(ptr + offset, buffer + ruleFstsLen + ruleFarsLen, 'i32*')
  offset += 4
  Module.setValue(ptr + offset, buffer + ruleFstsLen + ruleFarsLen + 4, 'float*')

  return { buffer, ptr, len, config: modelConfig }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createOfflineTts(Module: any) {
  const config = {
    offlineTtsModelConfig: {
      offlineTtsVitsModelConfig: {
        model: './model.onnx',
        lexicon: '',
        tokens: './tokens.txt',
        dataDir: './espeak-ng-data',
        noiseScale: 0.667,
        noiseScaleW: 0.8,
        lengthScale: 1.0,
      },
      numThreads: 1,
      debug: false,
      provider: 'cpu',
    },
    ruleFsts: '',
    ruleFars: '',
    maxNumSentences: 1,
    silenceDuration: 0.2,
  }

  const ttsConfig = initSherpaOnnxOfflineTtsConfig(config, Module)
  const handle = Module._SherpaOnnxCreateOfflineTts(ttsConfig.ptr)
  freeConfig(ttsConfig, Module)

  if (handle === 0) {
    throw new Error('Failed to create TTS instance')
  }

  const _sampleRate = Module._SherpaOnnxOfflineTtsSampleRate(handle)
  const _numSpeakers = Module._SherpaOnnxOfflineTtsNumSpeakers(handle)

  return {
    handle,
    sampleRate: _sampleRate,
    numSpeakers: _numSpeakers,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generate: function(input: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number } {
      const textLen = Module.lengthBytesUTF8(input.text) + 1
      const textPtr = Module._malloc(textLen)
      Module.stringToUTF8(input.text, textPtr, textLen)

      const audioPtr = Module._SherpaOnnxOfflineTtsGenerate(
        handle,
        textPtr,
        input.sid || 0,
        input.speed || 1.0
      )

      Module._free(textPtr)

      const numSamples = Module.HEAP32[audioPtr / 4]
      const sampleRateOut = Module.HEAP32[(audioPtr + 4) / 4]
      const samplesPtr = Module.HEAP32[(audioPtr + 8) / 4]

      const samples = new Float32Array(numSamples)
      for (let i = 0; i < numSamples; i++) {
        samples[i] = Module.HEAPF32[(samplesPtr + i * 4) / 4]
      }

      Module._SherpaOnnxDestroyOfflineTtsGeneratedAudio(audioPtr)

      return { samples, sampleRate: sampleRateOut }
    },
    free: function() {
      Module._SherpaOnnxDestroyOfflineTts(handle)
    },
  }
}

// ============================================================================
// WAV Generation
// ============================================================================

function createWavBlob(samples: Float32Array, sr: number): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sr * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = samples.length * 2

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
  view.setUint32(24, sr, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const int16Data = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    int16Data[i] = Math.floor(Math.max(-1, Math.min(1, samples[i])) * 32767)
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
      await handleInit()
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

async function handleInit() {
  if (isInitialized || isInitializing) {
    if (isInitialized && tts) {
      postMessage({ type: 'ready', numSpeakers: tts.numSpeakers })
    }
    return
  }

  isInitializing = true

  try {
    workerLog.info('Initializing Sherpa-ONNX worker')
    
    postMessage({ type: 'progress', status: 'Loading Sherpa-ONNX WASM...', progress: 0.1 })

    // Create Module object for Emscripten
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ModuleConfig: any = {}
    
    // Configure file locations
    ModuleConfig.locateFile = function(path: string, scriptDirectory: string = '') {
      workerLog.debug('Locating file', { path, scriptDirectory })
      return `${WASM_BASE_URL}/${path}`
    }

    // Progress callback
    ModuleConfig.setStatus = function(status: string) {
      workerLog.debug('Module status', { status })
      
      const downloadMatch = status.match(/Downloading data... \((\d+)\/(\d+)\)/)
      if (downloadMatch) {
        const downloaded = BigInt(downloadMatch[1])
        const total = BigInt(downloadMatch[2])
        const percent = total === 0n ? 0 : Number((downloaded * 100n) / total)
        postMessage({ 
          type: 'progress', 
          status: `Downloading model... ${percent}%`, 
          progress: 0.1 + (percent / 100) * 0.7 
        })
      } else if (status === 'Running...') {
        postMessage({ type: 'progress', status: 'Initializing TTS model...', progress: 0.85 })
      }
    }

    // Load the Emscripten module
    postMessage({ type: 'progress', status: 'Loading WASM module...', progress: 0.15 })
    
    // Import the main JS file which sets up the Module
    const mainScript = await fetch(`${WASM_BASE_URL}/sherpa-onnx-wasm-main-tts.js`)
    const scriptText = await mainScript.text()
    
    // The sherpa-onnx script expects a global Module variable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(self as any).Module = ModuleConfig
    
    // Create a wrapped version that returns a promise
    const modulePromise = new Promise<void>((resolve) => {
      ModuleConfig.onRuntimeInitialized = () => {
        workerLog.info('WASM runtime initialized')
        resolve()
      }
    })
    
    // Execute the script
    // eslint-disable-next-line no-eval
    eval(scriptText)
    
    // Wait for initialization
    await modulePromise
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Module = (self as any).Module
    
    postMessage({ type: 'progress', status: 'Creating TTS instance...', progress: 0.9 })
    
    // Create the TTS instance
    tts = createOfflineTts(Module)
    sampleRate = tts.sampleRate

    isInitialized = true
    isInitializing = false

    workerLog.info('Sherpa-ONNX worker ready', { 
      sampleRate, 
      numSpeakers: tts.numSpeakers 
    })
    
    postMessage({ 
      type: 'ready', 
      numSpeakers: tts.numSpeakers,
      sampleRate 
    })
  } catch (error) {
    workerLog.error('Sherpa-ONNX init error', error)
    isInitializing = false
    postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to initialize Sherpa-ONNX',
    })
  }
}

async function handleGenerate(message: GenerateMessage) {
  const { requestId, text, speakerId, speed } = message

  if (cancelAll || cancelledRequests.has(requestId)) {
    workerLog.debug('Generation skipped - cancelled', { requestId })
    cancelledRequests.delete(requestId)
    postMessage({ type: 'cancelled', requestId })
    return
  }

  if (!isInitialized || !tts) {
    postMessage({ type: 'error', requestId, message: 'Not initialized' })
    return
  }

  try {
    workerLog.debug('Starting generation', { 
      requestId, 
      textPreview: text.substring(0, 50), 
      speakerId,
      speed 
    })
    
    const startTime = performance.now()

    // Generate audio
    const { samples, sampleRate: sr } = tts.generate({
      text,
      sid: speakerId,
      speed,
    })

    const inferenceTime = Math.round(performance.now() - startTime)

    if (cancelAll || cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      postMessage({ type: 'cancelled', requestId })
      return
    }

    // Create WAV blob
    const blob = createWavBlob(samples, sr)
    const duration = samples.length / sr

    workerLog.debug('Generated audio', { 
      requestId, 
      durationSec: duration, 
      inferenceTimeMs: inferenceTime 
    })

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

// Mark as module
export {}


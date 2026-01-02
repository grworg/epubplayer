/**
 * TTS Web Worker
 *
 * Runs Kokoro TTS in a separate thread to keep the UI responsive.
 * Handles model loading, text generation, and returns audio blobs.
 */

// ============================================================================
// WebGPU Types (for type safety without full @webgpu/types dependency)
// ============================================================================

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance'
  featureLevel?: 'core' | 'compatibility'
}

interface GPUAdapterInfo {
  vendor: string
  architecture: string
  device: string
  description: string
}

interface GPUAdapter {
  features: Set<string>
  limits: Record<string, number>
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>
  requestAdapterInfo?(): Promise<GPUAdapterInfo>
}

interface GPUDeviceDescriptor {
  requiredFeatures?: string[]
  requiredLimits?: Record<string, number>
}

interface GPUDeviceLostInfo {
  reason: string
  message: string
}

interface GPUDevice {
  features: Set<string>
  limits: Record<string, number>
  lost: Promise<GPUDeviceLostInfo>
}

interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>
}

// ============================================================================
// Message Types
// ============================================================================

interface InitMessage {
  type: 'init'
  modelId: string
  device: 'wasm' | 'webgpu'
  dtype: string
}

interface GenerateMessage {
  type: 'generate'
  requestId: string
  text: string
  voiceId: string
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
  file?: string
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
// Kokoro Types
// ============================================================================

interface KokoroAudio {
  audio?: { length: number }
  length?: number
  toBlob?: () => Promise<Blob | ArrayBuffer>
  toWav?: () => Promise<ArrayBuffer>
}

interface KokoroTTSInstance {
  generate(text: string, options: { voice: string }): Promise<KokoroAudio>
}

interface KokoroProgressEvent {
  status?: string
  progress?: number
  file?: string
}

interface KokoroModule {
  KokoroTTS: {
    from_pretrained(
      modelId: string,
      options: {
        device: 'wasm' | 'webgpu'
        dtype: string
        progress_callback: (p: KokoroProgressEvent) => void
      }
    ): Promise<KokoroTTSInstance>
  }
}

// ============================================================================
// Worker State
// ============================================================================

let tts: KokoroTTSInstance | null = null
let isInitializing = false
const cancelledRequests = new Set<string>()
let cancelAll = false

// Kokoro/ORT inference is not reliably re-entrant; ensure generate requests run sequentially.
let generateQueue: Promise<void> = Promise.resolve()

// ============================================================================
// Logging (forward to main thread for mobile debugging)
// ============================================================================

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack }
  }
  if (typeof arg === 'function') {
    return `[Function ${arg.name || 'anonymous'}]`
  }
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
const originalConsole = {
  debug: console.debug.bind(console),
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

// Patch console methods to forward logs to main thread
function patchConsole() {
  const levels: Array<keyof typeof originalConsole> = ['debug', 'log', 'info', 'warn', 'error']
  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      try {
        originalConsole[level](...args)
      } finally {
        postLog(level, ...args)
      }
    }
  }
}

patchConsole()

// Forward uncaught errors
self.addEventListener('error', (e: ErrorEvent) => {
  postLog('error', '[ttsWorker.error]', e.message, e.error)
})

self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  postLog('error', '[ttsWorker.unhandledrejection]', e.reason)
})

// ============================================================================
// WebGPU Configuration
// ============================================================================

/**
 * Install monkey-patches on WebGPU APIs to work around driver bugs.
 *
 * Some Android devices (especially Pixel with Vulkan backends) fail on certain
 * WebGPU shader operations like TransposeShared. By forcing a "core-only" device
 * with no optional features, we may avoid triggering problematic code paths.
 */
function installWebGPUPatches() {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    console.log('[ttsWorker] WebGPU not available, skipping patches')
    return
  }

  const gpu = navigator.gpu as GPU
  const originalRequestAdapter = gpu.requestAdapter.bind(gpu)

  gpu.requestAdapter = async (options?: GPURequestAdapterOptions): Promise<GPUAdapter | null> => {
    console.log('[ttsWorker] Intercepted requestAdapter:', options)

    let adapter: GPUAdapter | null = null

    // Try compatibility mode first (Chrome 135+)
    try {
      adapter = await originalRequestAdapter({
        ...options,
        featureLevel: 'compatibility',
      })
      if (adapter) {
        console.log('[ttsWorker] ✓ Got compatibility mode adapter')
      }
    } catch {
      // Compatibility mode not available
    }

    if (!adapter) {
      adapter = await originalRequestAdapter(options)
    }

    if (!adapter) {
      return null
    }

    // Log adapter info for debugging
    try {
      const info = await adapter.requestAdapterInfo?.()
      console.log('[ttsWorker] Adapter:', info)
      console.log('[ttsWorker] Adapter features:', [...(adapter.features || [])])
    } catch {
      // Ignore
    }

    // Wrap the adapter's requestDevice to force core-only features
    const originalRequestDevice = adapter.requestDevice.bind(adapter)

    adapter.requestDevice = async (descriptor?: GPUDeviceDescriptor): Promise<GPUDevice> => {
      console.log('[ttsWorker] Intercepted requestDevice:', descriptor)

      // Force NO optional features to avoid driver bugs
      const safeDescriptor: GPUDeviceDescriptor = {
        ...descriptor,
        requiredFeatures: [],
        requiredLimits: descriptor?.requiredLimits || {},
      }

      console.log('[ttsWorker] Using safe descriptor (no optional features)')
      const device = await originalRequestDevice(safeDescriptor)

      console.log('[ttsWorker] ✓ Created device with features:', [...device.features])

      device.lost.then((info) => {
        console.warn('[ttsWorker] Device lost:', info.reason, info.message)
      })

      return device
    }

    return adapter
  }

  console.log('[ttsWorker] ✓ WebGPU patches installed')
}

/**
 * Configure external libraries for WebGPU usage.
 * Sets up transformers.js and ONNX Runtime environments.
 */
async function configureWebGPULibraries() {
  // Configure transformers.js
  try {
    // prettier-ignore
    // @ts-expect-error Dynamic import from CDN
    const transformers = await import(/* @vite-ignore */ 'https://esm.run/@huggingface/transformers')

    if (transformers.env?.backends?.onnx) {
      transformers.env.backends.onnx.wasm.proxy = false
      console.log('[ttsWorker] ✓ Configured transformers.js ONNX backend')
    }

    if (transformers.env) {
      transformers.env.useBrowserCache = true
      console.log('[ttsWorker] transformers.js env:', transformers.env)
    }
  } catch (e) {
    console.warn('[ttsWorker] Could not configure transformers.js:', e)
  }

  // Configure ONNX Runtime
  try {
    // prettier-ignore
    // @ts-expect-error Dynamic import from CDN
    const ort = await import(/* @vite-ignore */ 'https://esm.run/onnxruntime-web/webgpu')

    ort.env.debug = true
    ort.env.logLevel = 'verbose'
    ort.env.wasm.proxy = false

    console.log('[ttsWorker] ✓ Configured ORT env')
    console.log('[ttsWorker] ORT env.webgpu:', ort.env.webgpu)
  } catch (e) {
    console.warn('[ttsWorker] Could not configure ORT:', e)
  }
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
      // Queue generation to ensure only one inference runs at a time
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

// ============================================================================
// Handlers
// ============================================================================

async function handleInit(message: InitMessage) {
  if (tts || isInitializing) {
    if (tts) {
      postMessage({ type: 'ready' } as ReadyResponse)
    }
    return
  }

  isInitializing = true

  try {
    console.log('[ttsWorker] init', {
      modelId: message.modelId,
      device: message.device,
      dtype: message.dtype,
    })

    if (message.device === 'webgpu' && message.dtype !== 'fp32') {
      console.warn(
        '[ttsWorker] ⚠️ WebGPU with non-fp32 dtype may cause shader compilation errors'
      )
    }

    postMessage({
      type: 'progress',
      status: 'Loading TTS library...',
      progress: 0,
    } as ProgressResponse)

    // Set up WebGPU if using that backend
    if (message.device === 'webgpu') {
      console.log('[ttsWorker] Configuring for WebGPU execution...')
      installWebGPUPatches()
      await configureWebGPULibraries()
    }

    // Import kokoro-js from CDN
    const module = await loadKokoroModule()
    const { KokoroTTS } = module

    postMessage({
      type: 'progress',
      status: 'Loading model...',
      progress: 0.1,
    } as ProgressResponse)

    tts = await KokoroTTS.from_pretrained(message.modelId, {
      device: message.device,
      dtype: message.dtype,
      progress_callback: (p: KokoroProgressEvent) => {
        postMessage({
          type: 'progress',
          status: p.status || 'Loading...',
          progress: p.progress,
          file: p.file,
        } as ProgressResponse)
      },
    })

    console.log('[ttsWorker] ready')
    postMessage({ type: 'ready' } as ReadyResponse)
  } catch (error) {
    console.error('[ttsWorker] init error', error)

    const errorMessage = formatWebGPUError(
      error instanceof Error ? error.message : 'Failed to load TTS model',
      message.device
    )

    postMessage({
      type: 'error',
      message: errorMessage,
    } as ErrorResponse)
  } finally {
    isInitializing = false
  }
}

async function loadKokoroModule(): Promise<KokoroModule> {
  try {
    // prettier-ignore
    // @ts-expect-error Dynamic import from CDN
    const module = await import(/* @vite-ignore */ 'https://esm.run/kokoro-js@latest')
    console.log('[ttsWorker] Loaded kokoro-js@latest')
    return module as KokoroModule
  } catch {
    // prettier-ignore
    // @ts-expect-error Dynamic import from CDN
    const module = await import(/* @vite-ignore */ 'https://esm.run/kokoro-js')
    console.log('[ttsWorker] Loaded kokoro-js (default)')
    return module as KokoroModule
  }
}

async function handleGenerate(message: GenerateMessage) {
  const { requestId, text, voiceId } = message

  if (cancelAll || cancelledRequests.has(requestId)) {
    cancelledRequests.delete(requestId)
    return
  }

  if (!tts) {
    postMessage({
      type: 'error',
      requestId,
      message: 'TTS model not loaded',
    } as ErrorResponse)
    return
  }

  try {
    console.log('[ttsWorker] generate start', {
      requestId,
      chars: text.length,
      voiceId,
    })

    const audio = await tts.generate(text, { voice: voiceId })

    if (cancelAll || cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      return
    }

    const blob = await audioToBlob(audio)
    const samples = audio.audio?.length || audio.length || 0
    const duration = samples / 24000

    postMessage({
      type: 'audio',
      requestId,
      audioBlob: blob,
      duration,
    } as AudioResponse)

    console.log('[ttsWorker] generate done', { requestId, duration })
  } catch (error) {
    console.error('[ttsWorker] generate error', { requestId }, error)

    if (!cancelAll && !cancelledRequests.has(requestId)) {
      const errorMessage = formatWebGPUError(
        error instanceof Error ? error.message : 'Failed to generate audio',
        'webgpu' // Assume WebGPU for error formatting
      )

      postMessage({
        type: 'error',
        requestId,
        message: errorMessage,
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
// Helpers
// ============================================================================

async function audioToBlob(audio: KokoroAudio): Promise<Blob> {
  if (audio.toBlob) {
    const result = await audio.toBlob()
    return result instanceof Blob ? result : new Blob([result], { type: 'audio/wav' })
  }

  if (audio.toWav) {
    const wav = await audio.toWav()
    return new Blob([wav], { type: 'audio/wav' })
  }

  throw new Error('Unknown audio format from Kokoro')
}

/**
 * Format error messages for WebGPU failures with helpful suggestions.
 */
function formatWebGPUError(message: string, device: string): string {
  if (device !== 'webgpu') {
    return message
  }

  const errorStr = message.toLowerCase()

  if (errorStr.includes('vk_error') || errorStr.includes('vulkan')) {
    return `WebGPU/Vulkan error: ${message}. Try using WASM backend in settings.`
  }

  if (
    errorStr.includes('shader') ||
    errorStr.includes('pipeline') ||
    errorStr.includes('commandbuffer')
  ) {
    console.error('[ttsWorker] WebGPU shader/pipeline error detected')
    return `WebGPU error during TTS: ${message}. Try switching to WASM backend in Settings.`
  }

  return message
}

// Mark as module
export {}

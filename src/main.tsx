import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initDebug } from './debug'
import { installConsoleCapture, initLogging, createLogger } from '@/services/logging'

// Initialize structured logging system first
initLogging()

// Capture console + runtime errors for in-app debugging (useful on mobile)
// This catches any raw console.log calls and routes them to logStore
installConsoleCapture({ source: 'console' })

// Initialize debug utilities (auto-clears state in dev mode)
initDebug()

// Register PWA service worker
import { registerSW } from 'virtual:pwa-register'

const log = createLogger('app')

registerSW({
  immediate: true,
  onRegistered(r) {
    log.info('Service Worker registered', { scope: r?.scope })
  },
  onRegisterError(error) {
    log.error('Service Worker registration failed', error)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

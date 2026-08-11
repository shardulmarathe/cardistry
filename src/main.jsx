import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Automated visual review hook (scripts/inspect/captureFrames.mjs). Dev only —
// Vite tree-shakes this branch out of the production build.
if (import.meta.env.DEV) import('./devBridge.js')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

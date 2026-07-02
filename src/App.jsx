import { Analytics } from '@vercel/analytics/react'
import CanvasRoot from './scene/CanvasRoot'
import UIChrome from './ui/UIChrome'
import './App.css'

export default function App() {
  return (
    <div className="app-root">
      <CanvasRoot />
      <UIChrome />
      <Analytics />
    </div>
  )
}

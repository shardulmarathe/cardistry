import { useAppStore } from '../state/useAppStore'
import CardField from '../card/CardField'
import VisualizerDriver from '../visualizer/VisualizerDriver'
import LessonRunner from '../lessons/engine/LessonRunner'

// Picks the active driver by mode. Cards (CardField) are ALWAYS mounted so the
// deck never remounts; only which useFrame owns the cards changes.
export default function SceneController() {
  const mode = useAppStore((s) => s.mode)

  return (
    <>
      <CardField />
      {mode === 'visualizer' && <VisualizerDriver />}
      {mode === 'lesson' && <LessonRunner />}
    </>
  )
}

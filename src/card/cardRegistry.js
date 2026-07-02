// Plain module map of card id -> imperative CardHandle.
// This is intentionally NOT reactive: drivers write mesh transforms + material
// uniforms through here every frame without touching React or zustand.
const registry = new Map()

export function registerCard(id, handle) {
  registry.set(id, handle)
}

export function unregisterCard(id) {
  registry.delete(id)
}

export function getCard(id) {
  return registry.get(id)
}

export function getRegistry() {
  return registry
}

const handles = new Map()

export function registerHand(side, handle) {
  handles.set(side, handle)
}

export function unregisterHand(side) {
  handles.delete(side)
}

export function getHand(side) {
  return handles.get(side)
}

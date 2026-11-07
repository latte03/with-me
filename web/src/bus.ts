type Listener = () => void
const listeners = new Set<Listener>()

export function onChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notify(): void {
  for (const fn of listeners) fn()
}
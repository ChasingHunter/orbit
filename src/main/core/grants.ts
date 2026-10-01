// After the user grants access mid-request (request_access), the conversation that asked carries
// on by itself in a new turn, which has the newly allowed tools. Conversations register here.

type Listener = (note: string) => boolean

const listeners = new Set<Listener>()

/** A conversation listens; it returns true if it was the one running the request. */
export function onGrant(fn: Listener): void {
  listeners.add(fn)
}

export function continueAfterGrant(note: string): void {
  for (const l of listeners) if (l(note)) return
}

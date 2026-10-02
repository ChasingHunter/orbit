import { randomUUID } from 'node:crypto'

// Lets an agent working in the background ask the user something and wait for the answer.

export type Question = { id: string; question: string; options: string[]; from: string }

const pending = new Map<string, (answer: string | null) => void>()
let presenter: ((q: Question) => void) | undefined
let closer: ((id: string) => void) | undefined

export function setQuestionPresenter(fn: (q: Question) => void, close?: (id: string) => void): void {
  presenter = fn
  closer = close
}

/** Resolves with the answer, or null if nobody answered in time or the job was stopped. */
export function askUser(q: Omit<Question, 'id'>, signal: AbortSignal, timeoutMs = 30 * 60_000): Promise<string | null> {
  if (!presenter) return Promise.resolve(null)
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), timeoutMs)
    const onAbort = (): void => done(null)
    const done = (answer: string | null): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      pending.delete(id)
      // Answered, timed out or the job stopped: the card shouldn't linger in the bar.
      closer?.(id)
      resolve(answer)
    }
    signal.addEventListener('abort', onAbort)
    pending.set(id, done)
    presenter!({ id, ...q })
  })
}

export function answerQuestion(id: string, answer: string): void {
  pending.get(id)?.(answer)
}

import { randomUUID } from 'node:crypto'
import type { ApprovalRequest } from '@shared/types'

/** once: just this call. chat: this tool, for the rest of this chat. */
export type ApprovalDecision = 'once' | 'chat' | 'deny'

const pending = new Map<string, (d: ApprovalDecision) => void>()
let presenter: ((req: ApprovalRequest) => void) | undefined

/** The bar registers itself to render approval cards. */
export function setApprovalPresenter(fn: (req: ApprovalRequest) => void): void {
  presenter = fn
}

export function requestDecision(req: Omit<ApprovalRequest, 'id'>, signal: AbortSignal): Promise<ApprovalDecision> {
  if (!presenter) return Promise.resolve('deny')
  const id = randomUUID()
  return new Promise<ApprovalDecision>((resolve) => {
    const done = (d: ApprovalDecision): void => {
      pending.delete(id)
      signal.removeEventListener('abort', onAbort)
      resolve(d)
    }
    const onAbort = (): void => done('deny')
    signal.addEventListener('abort', onAbort)
    pending.set(id, done)
    presenter!({ id, ...req })
  })
}

/** Yes/no approval for callers that don't offer "for this chat" (workflow reviews). */
export async function requestApproval(req: Omit<ApprovalRequest, 'id'>, signal: AbortSignal): Promise<boolean> {
  return (await requestDecision({ ...req, allowChat: false }, signal)) !== 'deny'
}

export function resolveApproval(id: string, decision: ApprovalDecision | boolean): void {
  pending.get(id)?.(decision === true ? 'once' : decision === false ? 'deny' : decision)
}

export function denyAllApprovals(): void {
  for (const done of pending.values()) done('deny')
}

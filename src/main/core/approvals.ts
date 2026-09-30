import { randomUUID } from 'node:crypto'
import type { ApprovalRequest } from '@shared/types'

type Pending = { resolve: (ok: boolean) => void }

const pending = new Map<string, Pending>()
let presenter: ((req: ApprovalRequest) => void) | undefined

/** The bar registers itself to render approval cards. */
export function setApprovalPresenter(fn: (req: ApprovalRequest) => void): void {
  presenter = fn
}

export function requestApproval(req: Omit<ApprovalRequest, 'id'>, signal: AbortSignal): Promise<boolean> {
  if (!presenter) return Promise.resolve(false)
  const id = randomUUID()
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean): void => {
      pending.delete(id)
      signal.removeEventListener('abort', onAbort)
      resolve(ok)
    }
    const onAbort = (): void => done(false)
    signal.addEventListener('abort', onAbort)
    pending.set(id, { resolve: done })
    presenter!({ id, ...req })
  })
}

export function resolveApproval(id: string, approved: boolean): void {
  pending.get(id)?.resolve(approved)
}

export function denyAllApprovals(): void {
  for (const p of pending.values()) p.resolve(false)
}

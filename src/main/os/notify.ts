import { Notification } from 'electron'
import type { DashPage } from '@shared/dash'

// Every Orbit notification goes through here, so clicking one always leads somewhere: the bar
// (for anything waiting on you there), a dashboard page, or a custom action. Electron drops a
// notification's click handler once the object is garbage-collected, while Windows keeps showing
// it, so each one is held for an hour.

type Target = 'bar' | DashPage | (() => void)

let openBar: (() => void) | undefined
let openPage: ((page: DashPage) => void) | undefined

export function setNotifyTargets(bar: () => void, page: (p: DashPage) => void): void {
  openBar = bar
  openPage = page
}

const alive = new Set<Notification>()

export function notify(title: string, body: string, target?: Target): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  alive.add(n)
  const drop = (): void => void alive.delete(n)
  n.on('click', () => {
    drop()
    if (target === 'bar') openBar?.()
    else if (typeof target === 'function') target()
    else if (target) openPage?.(target)
  })
  n.on('close', drop)
  setTimeout(drop, 3_600_000).unref()
  n.show()
}

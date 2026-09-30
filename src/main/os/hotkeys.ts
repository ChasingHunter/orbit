import { globalShortcut } from 'electron'

export type HotkeyHandlers = Record<string, () => void>

/** (Re)binds every hotkey; returns the accelerators that failed (taken by another app). */
export function bindHotkeys(map: Record<string, string>, handlers: HotkeyHandlers): string[] {
  globalShortcut.unregisterAll()
  const failed: string[] = []
  for (const [action, accel] of Object.entries(map)) {
    const handler = handlers[action]
    if (!accel || !handler) continue
    try {
      if (!globalShortcut.register(accel, handler)) failed.push(`${action} (${accel})`)
    } catch {
      failed.push(`${action} (${accel}: invalid)`)
    }
  }
  return failed
}

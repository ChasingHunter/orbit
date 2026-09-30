import SelectionHook from 'selection-hook'

// UIA-first text selection capture (clipboard fallback handled inside selection-hook).
let hook: InstanceType<typeof SelectionHook> | undefined

export function startSelectionHook(): void {
  try {
    hook = new SelectionHook()
    // Passive: no automatic events on every mouse-up; we only read on demand.
    hook.start({ selectionPassiveMode: true, enableClipboard: true })
  } catch (err) {
    console.error('[selection] hook failed to start:', err)
    hook = undefined
  }
}

export function stopSelectionHook(): void {
  hook?.stop()
  hook?.cleanup()
}

/** Current text selection in the foreground app, if any. Call before Orbit takes focus. */
export function currentSelection(): { text: string; app: string } | undefined {
  const sel = hook?.getCurrentSelection()
  const text = sel?.text?.trim()
  return text ? { text, app: sel!.programName } : undefined
}

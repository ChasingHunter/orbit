import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { settings } from '../settingsStore'
import { tapCombo, waitForModifiersReleased } from './win32'

// Orbit triggers Wispr Flow by injecting its own hands-free hotkey (verified in spikes/wispr-inject.ps1).

const WISPR_CONFIG = join(process.env.APPDATA ?? '', 'Wispr Flow', 'config.json')

// Ctrl/Shift/Alt first, then Win, then other keys: Win is released alongside a
// non-modifier, so the Start menu never opens.
function rank(vk: number): number {
  if ((vk >= 160 && vk <= 165) || (vk >= 16 && vk <= 18)) return 0
  if (vk === 91 || vk === 92) return 1
  return 2
}

/** Reads Wispr's hotkey for an action (read-only; keybinds only). */
export function readWisprCombo(action: 'popo' | 'ptt' = 'popo'): number[] | undefined {
  if (!existsSync(WISPR_CONFIG)) return undefined
  try {
    const cfg = JSON.parse(readFileSync(WISPR_CONFIG, 'utf8'))
    const shortcuts: Record<string, string> = cfg?.prefs?.user?.shortcuts ?? {}
    const combo = Object.entries(shortcuts).find(([, v]) => v === action)?.[0]
    return combo?.split('+').map(Number).sort((a, b) => rank(a) - rank(b))
  } catch {
    return undefined
  }
}

function combo(): number[] | undefined {
  const manual = settings.current.voice.wisprCombo
  return manual.length ? [...manual].sort((a, b) => rank(a) - rank(b)) : readWisprCombo('popo')
}

/** Toggles Wispr hands-free dictation. Returns false if Wispr isn't configured. */
export async function toggleWispr(): Promise<boolean> {
  const keys = combo()
  if (!keys?.length) return false
  // The user is usually still holding Orbit's hotkey modifiers; extra held keys
  // would make Wispr see a different combo.
  await waitForModifiersReleased()
  tapCombo(keys)
  return true
}

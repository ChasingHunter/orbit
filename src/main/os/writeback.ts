import { clipboard, ClipboardItem } from 'electron'
import { focusWindow, sendKeys, VK, type Hwnd } from './win32'
import { logInfo } from '../log'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Readable = { types: readonly string[]; getType(type: string): Promise<unknown> }

/**
 * Copies every format currently on the clipboard so it can be restored later. Items whose
 * formats Chromium can't read (some apps put private formats there) are skipped, and any error
 * gives an empty snapshot: losing the old clipboard is better than losing the text being pasted.
 */
export async function snapshotClipboard(read: () => Promise<Readable[]> = () => clipboard.read()): Promise<ClipboardItem[]> {
  try {
    const items = await read().catch(() => [])
    const out: ClipboardItem[] = []
    for (const item of items) {
      const data: Record<string, Blob | string> = {}
      for (const type of item.types) {
        const value = await item.getType(type).catch(() => undefined)
        if (value instanceof Blob || typeof value === 'string') data[type] = value
      }
      if (Object.keys(data).length) out.push(new ClipboardItem(data))
    }
    return out
  } catch (err) {
    logInfo('paste: could not save the clipboard first', err)
    return []
  }
}

/**
 * Pastes text into the previously focused window, replacing its selection.
 * The user's clipboard (all formats) is restored afterwards.
 */
export async function pasteInto(hwnd: Hwnd, text: string, hideBar: () => void): Promise<void> {
  const saved = await snapshotClipboard()
  await clipboard.writeText(text)
  // Focus the target while Orbit is still foreground (Windows only lets the
  // foreground process hand focus away), then hide the bar.
  focusWindow(hwnd)
  hideBar()
  await sleep(120)
  sendKeys([VK.CONTROL, VK.V], false)
  sendKeys([VK.CONTROL, VK.V], true)
  await sleep(400)
  if (saved.length) await clipboard.write(saved).catch((err) => logInfo('paste: could not restore the clipboard', err))
}

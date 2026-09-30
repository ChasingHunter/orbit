import { clipboard, ClipboardItem } from 'electron'
import { focusWindow, sendKeys, VK, type Hwnd } from './win32'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Copies every format currently on the clipboard so it can be restored later. */
async function snapshotClipboard(): Promise<ClipboardItem[]> {
  const items = await clipboard.read().catch(() => [])
  return Promise.all(
    items.map(async (item) => {
      const data: Record<string, Blob | string> = {}
      for (const type of item.types) {
        const value = await item.getType(type).catch(() => undefined)
        if (value instanceof Blob || typeof value === 'string') data[type] = value
      }
      return new ClipboardItem(data)
    })
  )
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
  if (saved.length) await clipboard.write(saved).catch(() => {})
}

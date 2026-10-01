import { clipboard } from 'electron'
import { focusWindow, sendKeys, VK, type Hwnd } from './win32'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Pastes text into the previously focused window, replacing its selection. The text stays on the
 * clipboard afterwards: one clean Win+V entry, and you can paste it again elsewhere. (Putting the
 * old clipboard back added a second, duplicate history entry every time.)
 */
export async function pasteInto(hwnd: Hwnd, text: string, hideBar: () => void): Promise<void> {
  await clipboard.writeText(text)
  // Focus the target while Orbit is still foreground (Windows only lets the
  // foreground process hand focus away), then hide the bar.
  focusWindow(hwnd)
  hideBar()
  await sleep(120)
  sendKeys([VK.CONTROL, VK.V], false)
  sendKeys([VK.CONTROL, VK.V], true)
}

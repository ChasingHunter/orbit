import koffi from 'koffi'

// Thin user32/kernel32 bindings via koffi (FFI, prebuilt — no compiler needed).

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr'
})
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr'
})
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  u: koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT })
})

const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
const MapVirtualKeyW = user32.func('uint32 __stdcall MapVirtualKeyW(uint32 uCode, uint32 uMapType)')
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)')
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void *hWnd)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ char16_t *lpString, int nMaxCount)')
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)')
const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *h)')
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ char16_t *name, _Inout_ uint32 *size)'
)

const KEYEVENTF_EXTENDEDKEY = 0x1
const KEYEVENTF_KEYUP = 0x2
const INPUT_SIZE = koffi.sizeof(INPUT)

// RCtrl, RAlt, LWin, RWin, Apps, and the nav block need the extended-key flag.
const EXTENDED = new Set([0xa3, 0xa5, 0x5b, 0x5c, 0x5d, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e])

function key(vk: number, up: boolean): unknown {
  return {
    type: 1,
    u: {
      ki: {
        wVk: vk,
        wScan: MapVirtualKeyW(vk, 0),
        dwFlags: (EXTENDED.has(vk) ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0),
        time: 0,
        dwExtraInfo: 0
      }
    }
  }
}

/** Press keys in order (down) or release in reverse order (up), as one atomic batch. */
export function sendKeys(vks: number[], up: boolean): number {
  const seq = up ? [...vks].reverse() : vks
  const inputs = seq.map((vk) => key(vk, up))
  return SendInput(inputs.length, inputs, INPUT_SIZE)
}

export function tapCombo(vks: number[]): void {
  sendKeys(vks, false)
  sendKeys(vks, true)
}

export const VK = { SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, LWIN: 0x5b, RWIN: 0x5c, V: 0x56, LCONTROL: 0xa2 }

export function isKeyDown(vk: number): boolean {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0
}

/** Resolves once the user has physically released Ctrl/Alt/Shift/Win (or after timeout). */
export async function waitForModifiersReleased(timeoutMs = 1500): Promise<void> {
  const mods = [VK.SHIFT, VK.CONTROL, VK.MENU, VK.LWIN, VK.RWIN]
  const end = Date.now() + timeoutMs
  while (Date.now() < end && mods.some(isKeyDown)) await new Promise((r) => setTimeout(r, 15))
}

export type Hwnd = unknown

export function foregroundWindow(): Hwnd {
  return GetForegroundWindow()
}

export function focusWindow(hwnd: Hwnd): boolean {
  return hwnd ? SetForegroundWindow(hwnd) : false
}

export function windowInfo(hwnd: Hwnd): { title: string; app: string } {
  if (!hwnd) return { title: '', app: '' }
  const buf = Buffer.alloc(1024)
  const len = GetWindowTextW(hwnd, buf, 512)
  const title = buf.toString('utf16le', 0, len * 2)

  const pid = [0]
  GetWindowThreadProcessId(hwnd, pid)
  let app = ''
  const h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid[0])
  if (h) {
    const name = Buffer.alloc(1040)
    const size = [520]
    if (QueryFullProcessImageNameW(h, 0, name, size)) {
      app = name.toString('utf16le', 0, size[0] * 2).split('\\').pop() ?? ''
    }
    CloseHandle(h)
  }
  return { title, app }
}

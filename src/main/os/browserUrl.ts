import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

// Reads the address bar of the active browser tab through Windows UI Automation.
// A single PowerShell process stays running so each lookup is a quick round trip.

const BROWSERS = new Set(['chrome.exe', 'msedge.exe', 'brave.exe', 'firefox.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe'])

// Only the browser's own toolbar is searched (not the page), so this stays fast and doesn't
// switch on the browser's accessibility mode for web content.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$isEdit = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$isDoc = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$walker = New-Object System.Windows.Automation.TreeWalker((New-Object System.Windows.Automation.NotCondition($isDoc)))
function Find-Url($el, $depth) {
  if ($depth -gt 14 -or $el -eq $null) { return $null }
  if ($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) {
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $v = $vp.Current.Value
      if ($v -match '^(https?://|file:///|[\w-]+(\.[\w-]+)+(:\d+)?(/|$))') { return $v }
    }
  }
  $c = $walker.GetFirstChild($el)
  while ($c -ne $null) {
    $r = Find-Url $c ($depth + 1)
    if ($r) { return $r }
    $c = $walker.GetNextSibling($c)
  }
  return $null
}
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $url = ''
  try { $url = Find-Url ($A::FromHandle([IntPtr][Int64]$line)) 0 } catch {}
  [Console]::Out.WriteLine([string]$url)
}
`

let child: ChildProcessWithoutNullStreams | undefined
let ready: Promise<void> | undefined
const waiting: ((line: string) => void)[] = []

function start(): Promise<void> {
  if (ready && child && !child.killed) return ready
  child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true })
  child.stdin.write(SCRIPT + '\n')
  const lines = createInterface({ input: child.stdout })
  ready = new Promise((resolve) => {
    lines.on('line', (line) => {
      if (line === 'ready') return resolve()
      waiting.shift()?.(line.trim())
    })
  })
  child.on('exit', () => {
    child = undefined
    ready = undefined
    for (const w of waiting.splice(0)) w('')
  })
  return ready
}

export function isBrowser(app: string): boolean {
  return BROWSERS.has(app.toLowerCase())
}

/** Warms the helper up so the first lookup is fast. */
export function startBrowserUrlHelper(): void {
  void start().catch(() => {})
}

export function stopBrowserUrlHelper(): void {
  child?.kill()
}

/** URL in the given browser window's address bar, or undefined (timeout 1.5 s). */
export async function browserUrl(hwnd: unknown, app: string): Promise<string | undefined> {
  if (!isBrowser(app) || !hwnd) return undefined
  const handle = typeof hwnd === 'bigint' || typeof hwnd === 'number' ? String(hwnd) : String(Number((hwnd as { address?: bigint }).address ?? 0))
  await start()
  const line = await Promise.race([
    new Promise<string>((resolve) => {
      waiting.push(resolve)
      child?.stdin.write(`${handle}\n`)
    }),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), 1500))
  ])
  if (!line) return undefined
  return /^[a-z]+:\/\//i.test(line) ? line : `https://${line}`
}

<#
Step 0 spike: can Orbit trigger Wispr Flow by injecting its hotkey via SendInput?

Usage:
  powershell -ExecutionPolicy Bypass -File spikes\wispr-inject.ps1                 # hands-free toggle (popo)
  powershell -ExecutionPolicy Bypass -File spikes\wispr-inject.ps1 -Mode ptt       # hold-to-talk (ptt)
  Options: -Seconds 5 (speaking window)  -NoNotepad (inject into whatever is focused)

Pass = text you spoke appears in Notepad. Reads Wispr keybinds read-only from its config.json.
#>
param(
  [ValidateSet('popo', 'ptt')] [string]$Mode = 'popo',
  [int]$Seconds = 5,
  [switch]$NoNotepad
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Inject {
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public UNION u; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);

  const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2;

  static bool IsExtended(ushort vk) {
    // RCtrl, RAlt, LWin, RWin, Apps, arrows/nav block
    return vk == 0xA3 || vk == 0xA5 || vk == 0x5B || vk == 0x5C || vk == 0x5D || (vk >= 0x21 && vk <= 0x2E);
  }

  static INPUT Key(ushort vk, bool up) {
    var i = new INPUT { type = 1 };
    i.u.ki.wVk = vk;
    i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
    i.u.ki.dwFlags = (IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
    return i;
  }

  // Sends all keys down in given order, or all up in reverse order, as one atomic batch.
  public static uint Send(ushort[] vks, bool up) {
    var inputs = new INPUT[vks.Length];
    for (int k = 0; k < vks.Length; k++) inputs[k] = Key(up ? vks[vks.Length - 1 - k] : vks[k], up);
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@

# --- Read Wispr combo (read-only) ---
$cfgPath = Join-Path $env:APPDATA 'Wispr Flow\config.json'
$shortcuts = (Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).prefs.user.shortcuts
$comboStr = ($shortcuts.PSObject.Properties | Where-Object { $_.Value -eq $Mode } | Select-Object -First 1).Name
if (-not $comboStr) { throw "No Wispr shortcut bound to '$Mode' in $cfgPath" }

# Press order: Ctrl/Shift/Alt -> Win -> other keys, so Win is released together with a non-modifier (no Start menu).
function Rank([int]$vk) {
  if ($vk -in 160..165 -or $vk -in 16..18) { return 0 }
  if ($vk -in 91, 92) { return 1 }
  return 2
}
[uint16[]]$combo = $comboStr -split '\+' | ForEach-Object { [int]$_ } | Sort-Object { Rank $_ }
Write-Host "Wispr '$Mode' combo (VK): $($combo -join ' + ')"

# --- Target window ---
if (-not $NoNotepad) {
  $np = Start-Process notepad -PassThru
  Start-Sleep -Milliseconds 1500
  $h = (Get-Process -Id $np.Id -ErrorAction SilentlyContinue).MainWindowHandle
  if (-not $h -or $h -eq 0) {
    # Win11 Notepad re-parents to an existing process; grab the newest Notepad window
    $h = (Get-Process notepad | Where-Object MainWindowHandle -ne 0 | Sort-Object StartTime -Descending | Select-Object -First 1).MainWindowHandle
  }
  if ($h) { [Inject]::SetForegroundWindow($h) | Out-Null }
  Write-Host 'Notepad focused. Do not click elsewhere.'
} else {
  Write-Host 'Focus your target text field now...'
}
3..1 | ForEach-Object { Write-Host "  $_"; Start-Sleep 1 }

# --- Inject ---
if ($Mode -eq 'popo') {
  $n = [Inject]::Send($combo, $false) + [Inject]::Send($combo, $true)
  Write-Host ">>> START injected ($n events). SPEAK NOW for $Seconds s..." -ForegroundColor Green
  Start-Sleep $Seconds
  $n = [Inject]::Send($combo, $false) + [Inject]::Send($combo, $true)
  Write-Host ">>> STOP injected ($n events). Waiting for Wispr to paste..." -ForegroundColor Yellow
} else {
  $n = [Inject]::Send($combo, $false)
  Write-Host ">>> HOLD injected ($n events). SPEAK NOW for $Seconds s..." -ForegroundColor Green
  Start-Sleep $Seconds
  $n = [Inject]::Send($combo, $true)
  Write-Host ">>> RELEASE injected ($n events). Waiting for Wispr to paste..." -ForegroundColor Yellow
}
if ($n -eq 0) { Write-Host 'SendInput returned 0 (blocked - UIPI/elevated window?)' -ForegroundColor Red }
Start-Sleep 4

Write-Host "`nResult: did your words appear in the target window?"
Write-Host '  YES -> design works (injected keys accepted by Wispr).'
Write-Host '  Wispr pill appeared but no text -> timing/focus issue; retry with -Seconds 8.'
Write-Host '  Nothing happened -> Wispr filters injected keys; use passive-listen fallback.'

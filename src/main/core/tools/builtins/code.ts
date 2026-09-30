import { z } from 'zod'
import { spawn, execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { app } from 'electron'
import { settings } from '../../../settingsStore'
import { defineTool } from '../types'
import { checked } from './folders'
import { inFiles } from './files'
import { saveOwnBinary } from '../../changes'
import { runPython } from '../../../python/sandbox'

// Running code. Python runs in a sandbox (see python/sandbox.ts) and can't touch the user's
// files or the internet, so it's a local-risk tool. Real commands are the opposite: full user
// rights, nothing to undo. They're off until turned on, and always come with a plain
// description of what they do, shown on the approval card and kept in the log.

const MAX_IN = 50 * 1024 * 1024
const MAX_OUTPUT = 20_000

function clipOutput(s: string): string {
  if (s.length <= MAX_OUTPUT) return s
  return `${s.slice(0, MAX_OUTPUT / 2)}\n…[${s.length - MAX_OUTPUT} characters cut]…\n${s.slice(-MAX_OUTPUT / 2)}`
}

export const runPythonTool = defineTool({
  name: 'run_python',
  description:
    "Run Python in a sandbox (no internet, no user files) for maths, data, charts and conversions. Listed files are copied to /in; files saved in the working folder are kept. numpy, pandas, matplotlib load automatically. print() results.",
  input: {
    description: z.string().describe('A few plain words, e.g. "Total sales by month"'),
    code: z.string(),
    files: z.array(z.string()).optional()
  },
  risk: 'local',
  describe: ({ description }) => description,
  preview: ({ code, files }) => `${files?.length ? `Files: ${files.map((f) => basename(f)).join(', ')}\n\n` : ''}${code.length > 1500 ? `${code.slice(0, 1500)}…` : code}`,
  run: async ({ code, files = [] }, { signal }) => {
    const inputs: { name: string; data: Buffer }[] = []
    let total = 0
    for (const f of files) {
      const path = checked(f)
      total += statSync(path).size
      if (total > MAX_IN) throw new Error('Input files are over 50 MB together')
      let name = basename(path)
      for (let n = 2; inputs.some((i) => i.name === name); n++) name = `${n}-${basename(path)}`
      inputs.push({ name, data: readFileSync(path) })
    }
    const { timeoutSec, memoryMb } = settings.current.tools.python
    const r = await runPython({ code, files: inputs, timeoutMs: timeoutSec * 1000, memoryMb }, signal)
    const saved = r.files.filter((f) => f.data.length <= MAX_IN).map((f) => saveOwnBinary(inFiles(f.name.replace(/\//g, '-')), f.data))
    const parts = [
      r.output.trim() && `Output:\n${clipOutput(r.output.trim())}`,
      r.result && `Result: ${clipOutput(r.result)}`,
      r.error && `Error:\n${r.error}`,
      ...saved.map((p) => `Saved ${p}`)
    ].filter(Boolean)
    if (r.error && !r.output.trim() && !saved.length) throw new Error(r.error)
    return parts.join('\n\n') || '(no output; print() the result)'
  }
})

function home(): string {
  return app.getPath('home')
}

export const runCommand = defineTool({
  name: 'run_command',
  description:
    "Run a PowerShell command on the user's PC with their full permissions. Only when nothing else can do it (system info, installs, git, tools). Its effects can't be undone. Always give a short plain description.",
  input: {
    description: z.string().describe('What it does in plain words, e.g. "Check IP address" for ipconfig'),
    command: z.string(),
    cwd: z.string().optional().describe('Folder to run in; default is the user folder')
  },
  risk: 'destructive',
  available: () => settings.current.tools.commands.enabled,
  describe: ({ description }) => description,
  preview: ({ command, cwd }) => `${command}\n\nIn ${cwd || home()}. Runs with your full permissions; Orbit can't undo what it changes.`,
  run: async ({ command, cwd }, { signal }) => {
    const dir = cwd || home()
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`No such folder: ${dir}`)
    const timeoutMs = settings.current.tools.commands.timeoutSec * 1000
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ORBIT_|ELECTRON_)/.test(k)))
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${command}`],
        { cwd: dir, env, windowsHide: true }
      )
      let out = ''
      let why = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
      child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
      // taskkill /T also stops whatever the command started.
      const kill = (reason: string): void => {
        why = reason
        if (child.pid) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      }
      const timer = setTimeout(() => kill(`Stopped after ${timeoutMs / 1000} s (the time limit)`), timeoutMs)
      const onAbort = (): void => kill('Cancelled')
      signal.addEventListener('abort', onAbort)
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        const text = clipOutput(out.trim()) || '(no output)'
        resolve(why ? `${why}.\n${text}` : `Exit code ${code}\n${text}`)
      })
    })
  }
})

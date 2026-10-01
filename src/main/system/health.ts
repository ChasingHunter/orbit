import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import { settings } from '../settingsStore'
import { getSecret } from '../secrets'
import { isModelInstalled, MODEL } from '../voice/localStt'

// What Orbit needs on this PC, what's optional, and what's there. Everything required ships in
// the installer; the rest is optional and only matters for the feature named next to it.

const run = promisify(execFile)

export type Check = {
  id: string
  name: string
  /** ok: present. missing: needed for a feature you've turned on. optional: not set up, not in use. */
  status: 'ok' | 'missing' | 'optional'
  detail: string
  /** What it's for, in a sentence. */
  why: string
  action?: { label: string; kind: 'sign-in' | 'install-voice' | 'url' | 'key'; target?: string }
}

/**
 * Claude Code executable: the copy bundled with Orbit (pinned to the SDK version, so updates to
 * your own install can't break Orbit), or the one you installed yourself (no second copy running).
 */
export function claudeExecutable(): string | undefined {
  if (settings.current.claude.executable === 'installed' && installedClaude) return installedClaude
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe')
  }
  try {
    return join(dirname(createRequire(__filename).resolve('@anthropic-ai/claude-agent-sdk-win32-x64/package.json')), 'claude.exe')
  } catch {
    return undefined
  }
}

/**
 * Finds a Claude Code you installed yourself. The native installer puts claude.exe on PATH;
 * npm installs a claude.cmd shim that wraps a claude.exe inside the package, which the SDK can't
 * launch directly, so the real exe is read out of the shim. Cached after the first look.
 */
export async function findInstalledClaude(): Promise<string | null> {
  if (installedClaude !== undefined) return installedClaude
  installedClaude = null
  let found: string[] = []
  try {
    const { stdout } = await run('where.exe', ['claude'], { windowsHide: true, timeout: 5000 })
    found = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } catch {
    return null
  }
  const exe = found.find((f) => /\.exe$/i.test(f))
  if (exe) return (installedClaude = exe)
  const shim = found.find((f) => /\.cmd$/i.test(f))
  if (shim) {
    const m = readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]*claude\.exe)"/i)
    const target = m && join(dirname(shim), m[1])
    if (target && existsSync(target)) installedClaude = target
  }
  return installedClaude
}

async function versionOf(exe: string | null | undefined): Promise<string | null> {
  if (!exe) return null
  try {
    const { stdout } = await run(exe, ['--version'], { windowsHide: true, timeout: 15_000 })
    return stdout.trim().split(' ')[0]
  } catch {
    return null
  }
}

export async function installedClaudeVersion(): Promise<string | null> {
  return versionOf(await findInstalledClaude())
}

/** Version of the Claude Code copy that ships with Orbit. */
export async function bundledClaudeVersion(): Promise<string | null> {
  const exe = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe')
    : (() => {
        try {
          return join(dirname(createRequire(__filename).resolve('@anthropic-ai/claude-agent-sdk-win32-x64/package.json')), 'claude.exe')
        } catch {
          return null
        }
      })()
  return versionOf(exe)
}

let installedClaude: string | null | undefined

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await run('where.exe', [cmd], { windowsHide: true, timeout: 5000 })
    return stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null
  } catch {
    return null
  }
}

async function version(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, args, { windowsHide: true, timeout: 15_000, shell: true })
    return stdout.trim().split(/\r?\n/)[0]
  } catch {
    return null
  }
}

export async function claudeStatus(): Promise<{ loggedIn: boolean; email?: string; method?: string }> {
  const exe = claudeExecutable()
  if (!exe || !existsSync(exe)) return { loggedIn: false }
  try {
    const { stdout } = await run(exe, ['auth', 'status', '--json'], { windowsHide: true, timeout: 20_000 })
    const s = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; authMethod?: string }
    return { loggedIn: !!s.loggedIn, email: s.email, method: s.authMethod }
  } catch {
    return { loggedIn: false }
  }
}

/** Opens a console window running Claude Code's own sign-in (a browser page opens from there). */
export function signInToClaude(): void {
  const exe = claudeExecutable()
  if (!exe) throw new Error('Claude Code executable not found')
  spawn('cmd.exe', ['/c', 'start', '"Sign in to Claude"', 'cmd.exe', '/k', `"${exe}" auth login --claudeai && echo. && echo Signed in. You can close this window.`], {
    windowsHide: false,
    detached: true,
    shell: false,
    windowsVerbatimArguments: true
  }).unref()
}

export async function runChecks(): Promise<Check[]> {
  await findInstalledClaude()
  const usesClaude = Object.values(settings.current.models).some((m) => typeof m === 'string' && m.startsWith('claude:'))
  const [claude, uv, npx, ollamaTags] = await Promise.all([
    claudeStatus(),
    which('uvx'),
    which('npx'),
    fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
      .then((r) => r.json() as Promise<{ models?: { name: string }[] }>)
      .catch(() => null)
  ])
  const nodeVersion = npx ? await version('node', ['--version']) : null
  const voice = settings.current.voice.engine
  const speech = settings.current.speech.engine
  const searchKey = getSecret(settings.current.tools.webSearch.provider)
  const exe = claudeExecutable()

  return [
    {
      id: 'claude',
      name: 'Claude sign-in',
      status: claude.loggedIn ? 'ok' : usesClaude ? 'missing' : 'optional',
      detail: claude.loggedIn
        ? `Signed in as ${claude.email ?? 'you'} (${claude.method === 'claude.ai' ? 'subscription' : claude.method ?? 'account'}). Using ${settings.current.claude.executable === 'installed' ? 'your installed Claude Code' : "Orbit's bundled Claude Code"}.`
        : exe && existsSync(exe)
          ? 'Not signed in.'
          : 'Claude Code not found. Switch back to the bundled copy in Settings.',
      why: 'Needed for Claude models (your subscription). Orbit ships its own copy of Claude Code, so nothing else to install.',
      action: claude.loggedIn ? undefined : { label: 'Sign in to Claude', kind: 'sign-in' }
    },
    {
      id: 'voice',
      name: 'Speech-to-text model',
      status: isModelInstalled() ? 'ok' : voice === 'local' ? 'missing' : 'optional',
      detail: isModelInstalled() ? 'Parakeet is installed.' : `Not downloaded yet (${MODEL.sizeMb} MB, one time).`,
      why: 'Lets you talk to Orbit. Runs fully on this PC.',
      action: isModelInstalled() ? undefined : { label: 'Download', kind: 'install-voice' }
    },
    {
      id: 'search',
      name: 'Web search key',
      status: searchKey ? 'ok' : 'optional',
      detail: searchKey ? `${settings.current.tools.webSearch.provider} key saved.` : 'No key, so Claude models use Claude's own search: it works, but each search costs about 12k tokens of your plan. With a free key it's about 1k, and Ollama, API-key models and workflows can search too.',
      why: 'Cheaper web search (about a tenth of the tokens), and search for Ollama, API-key models and workflows. Brave and Tavily both have free tiers.',
      action: searchKey ? undefined : { label: 'Get a free Brave key', kind: 'url', target: 'https://brave.com/search/api/' }
    },
    {
      id: 'uv',
      name: 'uv (Python tool runner)',
      status: uv ? 'ok' : speech === 'pocket' ? 'missing' : 'optional',
      detail: uv ? `Found at ${uv}.` : 'Not installed.',
      why: 'Runs Pocket TTS for spoken replies and the Gmail & Calendar integration. Not needed otherwise.',
      action: uv ? undefined : { label: 'How to install uv', kind: 'url', target: 'https://docs.astral.sh/uv/getting-started/installation/' }
    },
    {
      id: 'node',
      name: 'Node.js',
      status: npx ? 'ok' : 'optional',
      detail: npx ? `Found ${nodeVersion ?? ''}.`.trim() : 'Not installed.',
      why: 'Only needed for the Slack integration and other integrations started with npx.',
      action: npx ? undefined : { label: 'Download Node.js', kind: 'url', target: 'https://nodejs.org/' }
    },
    {
      id: 'ollama',
      name: 'Ollama (local models)',
      status: ollamaTags?.models?.length ? 'ok' : 'optional',
      detail: ollamaTags
        ? ollamaTags.models?.length
          ? `Running, with ${ollamaTags.models.map((m) => m.name).slice(0, 4).join(', ')}.`
          : 'Running, but no models pulled yet (try: ollama pull qwen3:4b).'
        : 'Not running.',
      why: 'Answers when you are offline or hit your Claude limit, and runs anything you mark private.',
      action: ollamaTags ? undefined : { label: 'Get Ollama', kind: 'url', target: 'https://ollama.com/download' }
    }
  ]
}

export function openUrl(url: string): void {
  if (/^https:\/\//.test(url)) void shell.openExternal(url)
}

export function hasInstalledClaude(): boolean {
  return !!installedClaude
}

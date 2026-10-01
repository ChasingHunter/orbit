import { z } from 'zod'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { parse, resolve } from 'node:path'
import { app } from 'electron'
import { defineTool } from '../types'
import { settings } from '../../../settingsStore'
import { dataDir } from '../../../paths'
import { integrations } from '../../../integrations/manager'
import { PRESETS } from '../../../integrations/presets'
import { openDashboard } from '../../../windows/dashboard'
import { continueAfterGrant } from '../../grants'

// When something is blocked by a setting (a folder Orbit can't read or change, commands turned
// off, a service that isn't connected), the model asks here instead of telling the user to go
// find the switch. The user always gets an approval card, whatever the autonomy level, since
// this widens what Orbit may do. Approving changes the setting and Orbit carries on.

/** Folders that are never granted, whatever the request: whole drives, Windows, programs, Orbit itself. */
function forbidden(dir: string): string | undefined {
  const d = dir.toLowerCase().replace(/[\\/]+$/, '')
  if (parse(dir).root.toLowerCase().replace(/[\\/]+$/, '') === d) return 'a whole drive'
  const sys = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, dataDir, app.getPath('home') + '\\AppData']
  for (const s of sys) {
    if (!s) continue
    const p = s.toLowerCase()
    if (d === p || d.startsWith(p + '\\')) return 'a system or app folder'
    // A folder that contains one of those would hand them over too.
    if (p.startsWith(d + '\\')) return 'a folder that contains system or app folders'
  }
  if (d === app.getPath('home').toLowerCase()) return 'your whole user folder'
  return undefined
}

function folderOf(path?: string): string {
  if (!path) throw new Error('Give the folder path')
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`No such folder: ${abs}`)
  const real = realpathSync(abs)
  const dir = statSync(real).isDirectory() ? real : resolve(real, '..')
  const why = forbidden(dir)
  if (why) throw new Error(`Orbit doesn't ask for access to ${why} (${dir}). Don't ask for a broader or parent folder instead: tell the user this folder can't be granted and why.`)
  return dir
}

function findService(name?: string): (typeof PRESETS)[number] | undefined {
  const n = (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return PRESETS.find((p) => p.id.replace(/[^a-z0-9]/g, '') === n || p.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(n))
}

export const requestAccess = defineTool({
  name: 'request_access',
  description:
    "When something you need is blocked by the user's settings, ask for it here instead of telling them to change settings. write_folder: for ANY work on the user's files (create, edit, rename, move, delete); it unlocks Orbit's file tools for that folder, with backups and undo, so always prefer it to commands for file work. read_folder: to read files in a folder that isn't allowed. commands: only for things that need a real command (system info, installs, git). connect: a service that isn't connected (e.g. ClickUp). The user approves on a card; then the setting changes and you continue automatically.",
  input: {
    kind: z.enum(['read_folder', 'write_folder', 'commands', 'connect']),
    path: z.string().optional().describe('For read_folder / write_folder'),
    service: z.string().optional().describe('For connect, e.g. "ClickUp"'),
    reason: z.string().describe('One line on why, shown to the user')
  },
  risk: 'local',
  // Widening Orbit's own permissions always needs the user, even at Full.
  alwaysAsk: () => true,
  describe: ({ kind, path, service }) =>
    kind === 'read_folder'
      ? `Let Orbit read files in ${path}`
      : kind === 'write_folder'
        ? `Let Orbit change files in ${path}`
        : kind === 'commands'
          ? 'Let Orbit run commands'
          : `Connect ${findService(service)?.name ?? service}`,
  preview: ({ kind, path, service, reason }) => {
    const lines = [reason]
    if (kind === 'read_folder' || kind === 'write_folder') {
      const dir = folderOf(path)
      lines.push(kind === 'write_folder' ? `Orbit will be able to create, edit, rename and delete files in ${dir}. Every change is backed up and can be undone.` : `Orbit will be able to read files in ${dir}.`)
    } else if (kind === 'commands') lines.push('Orbit will be able to run PowerShell commands. Each one still asks you first unless your level is Full.')
    else {
      const p = findService(service)
      lines.push(p ? (p.fields.length ? `${p.name} needs a little setup; the dashboard will walk you through it.` : `Your browser opens to sign in to ${p.name}.`) : `${service} isn't in Orbit's list; the dashboard's "Add your own" can connect any MCP server.`)
    }
    lines.push('You can change this any time in the dashboard.')
    return lines.join('\n')
  },
  run: async ({ kind, path, service }) => {
    if (kind === 'read_folder' || kind === 'write_folder') {
      const dir = folderOf(path)
      settings.update((d) => {
        if (!d.files.allowedFolders.some((f) => f.toLowerCase() === dir.toLowerCase())) d.files.allowedFolders.push(dir)
        if (kind === 'write_folder' && !d.files.writableFolders.some((f) => f.toLowerCase() === dir.toLowerCase())) d.files.writableFolders.push(dir)
      })
      continueAfterGrant(`${kind === 'write_folder' ? 'Write' : 'Read'} access to ${dir} was granted`)
      return `Granted: Orbit can now ${kind === 'write_folder' ? 'read and change files in' : 'read'} ${dir}. Stop here: don't call any other tool now and don't ask for anything else. Reply with one short sentence; Orbit continues the request automatically in a moment, and then you'll have the tools for this folder.`
    }
    if (kind === 'commands') {
      settings.update((d) => {
        d.tools.commands.enabled = true
      })
      continueAfterGrant('Running commands was turned on')
      return "Granted: commands are on. Stop here: don't call any other tool now. Reply with one short sentence; Orbit continues the request automatically in a moment, with run_command available."
    }
    const p = findService(service)
    if (p && !p.fields.length) {
      await integrations.upsert(p.id, p.config, true)
      return `Started connecting ${p.name}: the user signs in in their browser. Tell them to come back and say continue once they've signed in.`
    }
    openDashboard('integrations')
    return p
      ? `${p.name} needs its own app set up first; the Integrations page is open with the steps. Tell the user to follow them, then say continue.`
      : `${service} isn't in Orbit's list. The Integrations page is open: "Add your own" connects any MCP server by its address. Tell the user that, and to say continue once it's connected.`
  }
})

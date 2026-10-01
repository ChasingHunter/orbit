import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { parse } from 'yaml'
import { settings } from '../settingsStore'
import { dataDir } from '../paths'

// Skills are folders with a SKILL.md (a name and description up top, instructions below), the
// same format Claude uses. Orbit reads its own folder and, without copying anything, the
// user's ~/.claude/skills. Orbit's own skills are on by default; Claude's start off, since most
// are written for Claude Code's tools. The model only sees names and descriptions until it
// loads one, so skills that are on cost a line each, not their whole text.

export type Skill = { key: string; name: string; description: string; source: 'orbit' | 'claude'; dir: string; enabled: boolean }

export const orbitSkillsDir = (): string => join(dataDir, 'skills')
export const claudeSkillsDir = (): string => process.env.ORBIT_CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills')

function readSkill(dir: string, source: Skill['source']): Skill | undefined {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) return undefined
  const m = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  let meta: { name?: string; description?: string } = {}
  try {
    meta = (m ? parse(m[1]) : {}) ?? {}
  } catch {
    // a broken header just means we fall back to the folder name
  }
  const name = String(meta.name ?? dir.split(/[\\/]/).pop())
  const key = `${source}:${name}`
  const { off, onFromClaude } = settings.current.skills
  const enabled = source === 'orbit' ? !off.includes(key) : onFromClaude.includes(key)
  return { key, name, description: String(meta.description ?? '').replace(/\s+/g, ' ').trim(), source, dir, enabled }
}

export function listSkills(): Skill[] {
  const out: Skill[] = []
  for (const [root, source] of [[orbitSkillsDir(), 'orbit'], [claudeSkillsDir(), 'claude']] as const) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const dir = join(root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      const s = readSkill(dir, source)
      if (s) out.push(s)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const enabledSkills = (): Skill[] => listSkills().filter((s) => s.enabled)

/** The instructions, plus the other files in the skill's folder so the model can read them on. */
export function loadSkill(name: string): string {
  const s = enabledSkills().find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!s) throw new Error(`No skill called "${name}" is turned on. Turned on: ${enabledSkills().map((x) => x.name).join(', ') || 'none'}`)
  const body = readFileSync(join(s.dir, 'SKILL.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
  const files: string[] = []
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (n !== 'SKILL.md') files.push(p)
    }
  }
  walk(s.dir)
  const extra = files.length ? `\n\nOther files in this skill (read them with read_file if the instructions point to them):\n${files.slice(0, 50).map((f) => `- ${f}`).join('\n')}` : ''
  const note = s.source === 'claude' ? "\n\n(This skill was written for Claude Code. Where it names tools Orbit doesn't have, use Orbit's own tools for the same job.)" : ''
  return `<skill name="${s.name}" folder="${relative(s.source === 'orbit' ? orbitSkillsDir() : claudeSkillsDir(), s.dir)}">\n${body}${extra}${note}\n</skill>`
}

/** Folders read_file may read: those of skills that are turned on. */
export function skillDirs(): string[] {
  return enabledSkills().map((s) => s.dir)
}

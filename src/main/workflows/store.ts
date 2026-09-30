import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import YAML from 'yaml'
import { dataDir } from '../paths'
import { stepProblems, Workflow } from './schema'

export const workflowsDir = join(dataDir, 'workflows')

export type LoadedWorkflow = { file: string; workflow?: Workflow; error?: string }

/** Turns zod/YAML errors into one readable line per problem. */
export function explain(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues: { path: PropertyKey[]; message: string }[] }).issues
    return issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`).join('; ')
  }
  return err instanceof Error ? err.message : String(err)
}

export function parseWorkflow(yamlText: string): Workflow {
  const raw = YAML.parse(yamlText)
  const problems = stepProblems(raw?.steps)
  if (problems.length) throw new Error(problems.join('; '))
  return Workflow.parse(raw)
}

class WorkflowStore extends EventEmitter {
  private watching = false

  list(): LoadedWorkflow[] {
    if (!existsSync(workflowsDir)) return []
    return readdirSync(workflowsDir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .map((file) => {
        try {
          return { file, workflow: parseWorkflow(readFileSync(join(workflowsDir, file), 'utf8')) }
        } catch (err) {
          return { file, error: explain(err) }
        }
      })
  }

  get(name: string): Workflow | undefined {
    return this.list().find((l) => l.workflow?.name === name)?.workflow
  }

  fileOf(name: string): string {
    return join(workflowsDir, `${name}.yaml`)
  }

  /** The workflow as plain data, for the visual editor. */
  rawOf(name: string): unknown {
    return YAML.parse(readFileSync(this.fileOf(name), 'utf8'))
  }

  /** Validates and writes a workflow; returns the parsed result. */
  save(yamlText: string): Workflow {
    const wf = parseWorkflow(yamlText)
    mkdirSync(workflowsDir, { recursive: true })
    writeFileSync(this.fileOf(wf.name), yamlText.endsWith('\n') ? yamlText : yamlText + '\n')
    this.emit('change')
    return wf
  }

  setEnabled(name: string, enabled: boolean): void {
    const file = this.fileOf(name)
    const doc = YAML.parseDocument(readFileSync(file, 'utf8'))
    doc.set('enabled', enabled)
    writeFileSync(file, doc.toString())
    this.emit('change')
  }

  remove(name: string): void {
    rmSync(this.fileOf(name), { force: true })
    this.emit('change')
  }

  /** Picks up hand edits to the YAML files. */
  watch(): void {
    if (this.watching) return
    this.watching = true
    mkdirSync(workflowsDir, { recursive: true })
    let timer: NodeJS.Timeout | undefined
    watch(workflowsDir, () => {
      clearTimeout(timer)
      timer = setTimeout(() => this.emit('change'), 300)
    })
  }
}

export const workflowStore = new WorkflowStore()

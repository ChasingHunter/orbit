import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { paths } from '../paths'
import { addMemory, deleteMemory, getMemory, updateMemory, type Memory, type MemoryKind } from './memory'
import { scheduler, type Schedule } from './scheduler'
import { workflowStore } from '../workflows/store'
import { onUndo, recordChange, snapshot } from './journal'

// Changes to Orbit's own things go through here so each one lands in the undo journal.
// source: "Orbit" when the model did it, "you" when it came from the dashboard.

export function saveOwnFile(path: string, content: string, source = 'Orbit'): void {
  const previous = snapshot(path)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  recordChange(`${previous === null ? 'Created' : 'Overwrote'} ${relative(paths.files, path)}`, { kind: 'file', path, previous }, source)
}

/** Saves a binary file Orbit made. Never overwrites: "report.docx" becomes "report (2).docx". Returns the path used. */
export function saveOwnBinary(path: string, data: Buffer, source = 'Orbit'): string {
  let target = path
  for (let n = 2; existsSync(target); n++) target = join(dirname(path), `${basename(path, extname(path))} (${n})${extname(path)}`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  recordChange(`Created ${relative(paths.files, target)}`, { kind: 'file', path: target, previous: null }, source)
  return target
}

export function addMemoryTracked(text: string, kind: MemoryKind = 'note', isPrivate = false, source = 'Orbit'): Memory {
  const m = addMemory(text, kind, isPrivate)
  recordChange(`Remembered "${text.slice(0, 80)}"`, { kind: 'memory-added', id: m.id }, source)
  return m
}

export function deleteMemoryTracked(id: number, source = 'Orbit'): boolean {
  const m = getMemory(id)
  if (!m) return false
  deleteMemory(id)
  recordChange(`Forgot "${m.text.slice(0, 80)}"`, { kind: 'memory-removed', memory: { kind: m.kind, text: m.text, private: m.private } }, source)
  return true
}

export function updateMemoryTracked(id: number, fields: { text?: string; kind?: MemoryKind; private?: boolean }, source = 'you'): void {
  const m = getMemory(id)
  if (!m) throw new Error(`No memory #${id}`)
  updateMemory(id, fields)
  recordChange(`Edited memory "${m.text.slice(0, 60)}"`, { kind: 'memory-edited', id, before: { kind: m.kind, text: m.text, private: m.private } }, source)
}

export function addScheduleTracked(input: Parameters<typeof scheduler.add>[0], summary: string, source = 'Orbit'): Schedule {
  const s = scheduler.add(input)
  recordChange(summary, { kind: 'schedule-added', id: s.id }, source)
  return s
}

export function removeScheduleTracked(id: string, summary: string, source = 'Orbit'): boolean {
  const row = scheduler.get(id)
  if (!row) return false
  scheduler.remove(id)
  recordChange(summary, { kind: 'schedule-removed', row: { ...row } }, source)
  return true
}

export function saveWorkflowTracked(yaml: string, source = 'Orbit'): ReturnType<typeof workflowStore.save> {
  const name = /^name:\s*(\S+)/m.exec(yaml)?.[1] ?? ''
  const file = workflowStore.fileOf(name)
  const previous = existsSync(file) ? readFileSync(file, 'utf8') : null
  const wf = workflowStore.save(yaml)
  recordChange(`${previous === null ? 'Created' : 'Changed'} workflow ${wf.name}`, { kind: 'workflow-saved', name: wf.name, file: workflowStore.fileOf(wf.name), previous }, source)
  return wf
}

export function removeWorkflowTracked(name: string, source = 'Orbit'): boolean {
  const file = workflowStore.fileOf(name)
  if (!existsSync(file)) return false
  const yaml = readFileSync(file, 'utf8')
  workflowStore.remove(name)
  recordChange(`Deleted workflow ${name}`, { kind: 'workflow-removed', file, yaml }, source)
  return true
}

// How to reverse each kind.
onUndo('memory-added', (u) => void (u.kind === 'memory-added' && deleteMemory(u.id)))
onUndo('memory-removed', (u) => {
  if (u.kind === 'memory-removed') addMemory(u.memory.text, u.memory.kind as MemoryKind, u.memory.private)
})
onUndo('memory-edited', (u) => {
  if (u.kind === 'memory-edited') updateMemory(u.id, { text: u.before.text, kind: u.before.kind as MemoryKind, private: u.before.private })
})
onUndo('schedule-added', (u) => void (u.kind === 'schedule-added' && scheduler.remove(u.id)))
onUndo('schedule-removed', (u) => {
  if (u.kind === 'schedule-removed') scheduler.restore(u.row as Schedule)
})
onUndo('workflow-saved', (u) => {
  if (u.kind !== 'workflow-saved') return
  if (u.previous === null) workflowStore.remove(u.name)
  else {
    writeFileSync(u.file, u.previous)
    workflowStore.emit('change')
  }
})
onUndo('workflow-removed', (u) => {
  if (u.kind !== 'workflow-removed') return
  mkdirSync(dirname(u.file), { recursive: true })
  writeFileSync(u.file, u.yaml)
  workflowStore.emit('change')
})

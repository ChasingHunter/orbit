import type { Edge, Node } from '@xyflow/react'

// The visual editor works on the workflow as plain data (the parsed YAML). Main validates on save.

export type Json = Record<string, unknown>
export type StepDraft = Json & { id: string }
export type Draft = Json & { name: string; steps?: StepDraft[]; prompt?: string; trigger?: Json }

export type Kind = 'tool' | 'agent' | 'approval' | 'code' | 'if' | 'foreach' | 'parallel'
export const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'tool', label: 'Tool', hint: 'Call one tool, like save_file or a Notion action' },
  { kind: 'agent', label: 'Ask a model', hint: 'Write, summarise or decide something' },
  { kind: 'approval', label: 'Review', hint: 'Pause until you approve' },
  { kind: 'code', label: 'Code', hint: 'Reshape data with a little JavaScript' },
  { kind: 'if', label: 'If / else', hint: 'Take one of two paths' },
  { kind: 'foreach', label: 'For each', hint: 'Repeat steps for every item in a list' },
  { kind: 'parallel', label: 'At the same time', hint: 'Run a few steps at once' }
]

export function kindOf(s: StepDraft): Kind {
  return (['tool', 'agent', 'approval', 'code', 'if', 'foreach', 'parallel'] as Kind[]).find((k) => k in s) ?? 'tool'
}

/** Where a step lives: e.g. ['steps', 2, 'then', 0]. */
export type Path = (string | number)[]

export function getAt(root: Json, path: Path): unknown {
  return path.reduce<unknown>((v, k) => (v == null ? v : (v as Record<string | number, unknown>)[k]), root)
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Returns a copy of `root` with the value at `path` replaced. */
export function setAt(root: Draft, path: Path, value: unknown): Draft {
  const next = clone(root)
  let cur: Record<string | number, unknown> = next
  for (const k of path.slice(0, -1)) {
    if (cur[k] == null) cur[k] = typeof k === 'number' ? [] : {}
    cur = cur[k] as Record<string | number, unknown>
  }
  const last = path[path.length - 1]
  if (value === undefined) delete cur[last]
  else cur[last] = value
  return next
}

export function insertAt(root: Draft, listPath: Path, index: number, step: StepDraft): Draft {
  const list = [...((getAt(root, listPath) as StepDraft[] | undefined) ?? [])]
  list.splice(index, 0, step)
  return setAt(root, listPath, list)
}

export function removeAt(root: Draft, path: Path): Draft {
  const listPath = path.slice(0, -1)
  const list = [...(getAt(root, listPath) as StepDraft[])]
  list.splice(path[path.length - 1] as number, 1)
  return setAt(root, listPath, list)
}

export function moveAt(root: Draft, path: Path, delta: number): { draft: Draft; path: Path } {
  const listPath = path.slice(0, -1)
  const i = path[path.length - 1] as number
  const list = [...(getAt(root, listPath) as StepDraft[])]
  const j = i + delta
  if (j < 0 || j >= list.length) return { draft: root, path }
  ;[list[i], list[j]] = [list[j], list[i]]
  return { draft: setAt(root, listPath, list), path: [...listPath, j] }
}

function allIds(root: Draft): Set<string> {
  const ids = new Set<string>()
  const walk = (steps: StepDraft[] | undefined): void => {
    for (const s of steps ?? []) {
      ids.add(s.id)
      for (const key of ['then', 'else', 'steps', 'parallel']) if (Array.isArray(s[key])) walk(s[key] as StepDraft[])
    }
  }
  walk(root.steps)
  return ids
}

export function newStep(kind: Kind, root: Draft): StepDraft {
  const ids = allIds(root)
  let n = 1
  while (ids.has(`${kind}${n}`)) n++
  const id = `${kind}${n}`
  switch (kind) {
    case 'tool':
      return { id, tool: 'notify', args: { title: 'Orbit', body: '' } }
    case 'agent':
      return { id, agent: 'Summarise this in 3 bullets.', input: '' }
    case 'approval':
      return { id, approval: { title: 'Review before it continues', preview: '' } }
    case 'code':
      return { id, code: 'return input.trim()', input: '' }
    case 'if':
      return { id, if: '', then: [], else: [] }
    case 'foreach':
      return { id, foreach: '', steps: [] }
    case 'parallel':
      return { id, parallel: [] }
  }
}

export function summary(s: StepDraft): string {
  const k = kindOf(s)
  const text = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()
  if (k === 'tool') return text(s.tool)
  if (k === 'agent') return text(s.agent)
  if (k === 'approval') return text((s.approval as Json)?.title) || 'Review'
  if (k === 'code') return text(s.code)
  if (k === 'if') return typeof s.if === 'string' ? text(s.if) || 'condition' : `ask: ${text((s.if as Json)?.ask)}`
  if (k === 'foreach') return text(s.foreach) || 'list'
  return `${(s.parallel as unknown[])?.length ?? 0} at once`
}

// ---- Layout -------------------------------------------------------------------------------

export const NODE_W = 240
const NODE_H = 64
const GAP_Y = 36
const GAP_X = 28

export type NodeData = {
  kind: Kind | 'trigger' | 'empty' | 'group'
  title: string
  subtitle: string
  path: Path
  selected?: boolean
  /** For 'empty' placeholders: the list to insert into. */
  listPath?: Path
}

type Laid = { nodes: Node<NodeData>[]; edges: Edge[]; width: number; height: number; entry: string[]; exits: string[] }

let edgeN = 0
const edge = (source: string, target: string, label?: string): Edge => ({
  id: `e${edgeN++}`,
  source,
  target,
  label,
  type: 'smoothstep',
  labelStyle: { fill: '#a1a1aa', fontSize: 11 },
  labelBgStyle: { fill: '#18181b' },
  style: { stroke: '#3f3f46', strokeWidth: 1.5 }
})

function placeholder(listPath: Path, x: number, y: number, label: string): Laid {
  const id = `empty:${listPath.join('.')}`
  return {
    nodes: [{ id, type: 'orbit', position: { x, y }, data: { kind: 'empty', title: label, subtitle: 'Click to add a step', path: [], listPath } }],
    edges: [],
    width: NODE_W,
    height: NODE_H,
    entry: [id],
    exits: [id]
  }
}

/** Lays out a list of steps top to bottom, starting at (x, y). Width is the widest row. */
function layoutList(steps: StepDraft[], listPath: Path, x: number, y: number, emptyLabel: string): Laid {
  if (!steps.length) return placeholder(listPath, x, y, emptyLabel)
  // First pass finds the widest step so every step can be centred in the column.
  const width = Math.max(NODE_W, ...steps.map((s, i) => layoutStep(s, [...listPath, i], 0, 0).width))
  const out: Laid = { nodes: [], edges: [], width, height: 0, entry: [], exits: [] }
  let cy = y
  let prevExits: string[] = []
  steps.forEach((s, i) => {
    const w = layoutStep(s, [...listPath, i], 0, 0).width
    const laid = layoutStep(s, [...listPath, i], x + (width - w) / 2, cy)
    out.nodes.push(...laid.nodes)
    out.edges.push(...laid.edges)
    for (const from of prevExits) for (const to of laid.entry) out.edges.push(edge(from, to))
    if (i === 0) out.entry = laid.entry
    prevExits = laid.exits
    out.width = Math.max(out.width, laid.width)
    cy += laid.height + GAP_Y
  })
  out.exits = prevExits
  out.height = cy - y - GAP_Y
  return out
}

function layoutStep(s: StepDraft, path: Path, x: number, y: number): Laid {
  const k = kindOf(s)
  const id = `step:${path.join('.')}`
  const head: Node<NodeData> = { id, type: 'orbit', position: { x, y }, data: { kind: k, title: s.id, subtitle: summary(s), path } }

  if (k === 'if' || k === 'parallel') {
    // Lanes sit side by side under the head. For if: yes and no. For parallel: one lane per
    // step, plus an "add" lane so more can be added.
    type Lane = { lay: (lx: number, ly: number) => Laid; edgeLabel?: string; addLane?: boolean }
    const lanes: Lane[] =
      k === 'if'
        ? [
            { lay: (lx, ly) => layoutList((s.then as StepDraft[]) ?? [], [...path, 'then'], lx, ly, 'If yes: add a step'), edgeLabel: 'yes' },
            { lay: (lx, ly) => layoutList((s.else as StepDraft[]) ?? [], [...path, 'else'], lx, ly, 'If no: add a step'), edgeLabel: 'no' }
          ]
        : [
            ...((s.parallel as StepDraft[]) ?? []).map((child, i) => ({ lay: (lx: number, ly: number) => layoutStep(child, [...path, 'parallel', i], lx, ly) })),
            { lay: (lx, ly) => placeholder([...path, 'parallel'], lx, ly, 'Add a step to run alongside'), addLane: true }
          ]
    const out: Laid = { nodes: [head], edges: [], width: 0, height: 0, entry: [id], exits: [] }
    let lx = x
    let tallest = 0
    for (const lane of lanes) {
      const laid = lane.lay(lx, y + NODE_H + GAP_Y)
      out.nodes.push(...laid.nodes)
      out.edges.push(...laid.edges)
      for (const to of laid.entry) out.edges.push(edge(id, to, lane.edgeLabel))
      if (!lane.addLane) out.exits.push(...laid.exits)
      lx += laid.width + GAP_X
      tallest = Math.max(tallest, laid.height)
    }
    out.width = Math.max(NODE_W, lx - x - GAP_X)
    // Centre the head over its lanes.
    head.position.x = x + (out.width - NODE_W) / 2
    out.height = NODE_H + GAP_Y + tallest
    if (!out.exits.length) out.exits = [id]
    return out
  }

  if (k === 'foreach') {
    const inner = layoutList((s.steps as StepDraft[]) ?? [], [...path, 'steps'], x + 24, y + NODE_H + GAP_Y, 'Steps for each item')
    const groupId = `group:${path.join('.')}`
    const width = Math.max(NODE_W, inner.width) + 48
    const height = NODE_H + GAP_Y + inner.height + 24
    const group: Node<NodeData> = {
      id: groupId,
      type: 'orbit',
      position: { x: x - 24, y: y - 16 },
      data: { kind: 'group', title: '', subtitle: '', path },
      style: { width, height: height + 16, zIndex: -1 },
      selectable: false
    }
    const edges = [...inner.edges, ...inner.entry.map((to) => edge(id, to, 'each item'))]
    return { nodes: [group, head, ...inner.nodes], edges, width: width - 24, height, entry: [id], exits: inner.exits }
  }

  return { nodes: [head], edges: [], width: NODE_W, height: NODE_H, entry: [id], exits: [id] }
}

export function layout(draft: Draft, triggerLabel: string): { nodes: Node<NodeData>[]; edges: Edge[] } {
  edgeN = 0
  const trigger: Node<NodeData> = {
    id: 'trigger',
    type: 'orbit',
    position: { x: 0, y: 0 },
    data: { kind: 'trigger', title: 'Starts', subtitle: triggerLabel, path: ['trigger'] }
  }
  if (draft.prompt !== undefined && !draft.steps?.length) {
    const agent: Node<NodeData> = {
      id: 'prompt',
      type: 'orbit',
      position: { x: 0, y: NODE_H + GAP_Y },
      data: { kind: 'agent', title: 'Prompt', subtitle: String(draft.prompt).slice(0, 80), path: ['prompt'] }
    }
    return { nodes: [trigger, agent], edges: [edge('trigger', 'prompt')] }
  }
  const body = layoutList(draft.steps ?? [], ['steps'], 0, NODE_H + GAP_Y, 'First step')
  trigger.position.x = (body.width - NODE_W) / 2
  return { nodes: [trigger, ...body.nodes], edges: [...body.edges, ...body.entry.map((to) => edge('trigger', to))] }
}

export function describeTriggerShort(t: Json | undefined): string {
  if (!t || 'manual' in t) return 'When you run it'
  if ('cron' in t) return `Schedule: ${t.cron}`
  if ('feed' in t) return `New posts: ${(t.feed as Json).url}`
  if ('page' in t) return `Page changes: ${(t.page as Json).url}`
  if ('poll' in t) return `Tool result changes: ${(t.poll as Json).tool}`
  if ('folder' in t) return `New files in ${(t.folder as Json).path}`
  return 'Webhook'
}

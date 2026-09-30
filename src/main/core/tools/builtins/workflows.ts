import { z } from 'zod'
import { requestApproval } from '../../approvals'
import { nextRunFor, scheduler } from '../../scheduler'
import { explain, parseWorkflow, workflowStore } from '../../../workflows/store'
import { workflows } from '../../../workflows/engine'
import { defineTool } from '../types'

const SPEC = `YAML format:
name: lowercase-with-dashes
description: one line
trigger: { cron: "0 8 * * 1-5" }   # local time; or { manual: true }
missed: ask                         # if the PC was off at that time: ask | run | skip
model: chat                         # quick | chat | research | provider:model
# EITHER one agentic prompt (model picks tools; optional allowlist):
prompt: "Check my calendar and unread email, write a 5-bullet brief"
tools: [gmail__search_gmail_messages, google__get_events]
# OR steps, run in order; outputs pipe with {{steps.<id>.output}}; also {{date}} {{now}} {{input}}:
steps:
  - id: fetch
    tool: slack__conversations_history      # exact tool name from your tool list
    args: { channel_id: "#news", limit: "50" }
    retries: 2
  - id: write
    agent: "Turn these messages into a newsletter with 5 sections, keep links"
    input: "{{steps.fetch.output}}"
    tools: []                               # tools this step may use (default none)
  - id: review
    approval: { title: "Newsletter for {{date}}", preview: "{{steps.write.output}}", timeout: 2h, onTimeout: fail }
  - id: send
    when: "{{steps.write.output}}"          # optional: skip unless non-empty
    tool: gmail__send_gmail_message
    args: { to: "me@example.com", subject: "Digest {{date}}", body: "{{steps.write.output}}" }
    approved: true                          # runs without asking; only for steps behind a review step or that the user explicitly wants unattended
Rules:
- To DO something (notify, send, create, post), use a tool step with the exact tool name. An agent step only writes text; it can call tools only if you list them in its tools.
- approved: true exists only on tool steps. Steps that change things and aren't approved: true ask for approval every run.
- A scheduled run's final output is shown to the user as a notification, so a final agent step works for "summarise X for me" workflows.`

export const createWorkflow = defineTool({
  name: 'create_workflow',
  description: `Create or replace a saved workflow that runs on a schedule or on demand. Use list_integrations first so tool names match what's connected. The user sees the YAML and must approve it before it's saved. ${SPEC}`,
  input: { yaml: z.string().describe('The whole workflow as YAML') },
  sideEffect: false, // approval happens below, after validation, so the user never approves YAML that won't load
  run: async ({ yaml }, { signal }) => {
    let name: string
    try {
      const wf = parseWorkflow(yaml)
      name = wf.name
      if ('cron' in wf.trigger) nextRunFor({ cron: wf.trigger.cron })
    } catch (err) {
      throw new Error(`That YAML isn't valid: ${explain(err)}. Fix it and try again.`)
    }
    const exists = !!workflowStore.get(name)
    const ok = await requestApproval({ tool: 'create_workflow', title: `${exists ? 'Replace' : 'Save'} workflow "${name}"`, input: { yaml } }, signal)
    if (!ok) return 'The user declined. Nothing was saved.'
    const wf = workflowStore.save(yaml)
    workflows.sync()
    const s = scheduler.list(true, 'workflow').find((x) => x.id === `wf:${wf.name}`)
    const next = s ? scheduler.nextRunOf(s) : null
    return `Saved "${wf.name}".${next ? ` Next run: ${next.toLocaleString()}.` : ' It runs when asked.'}`
  }
})

export const listWorkflows = defineTool({
  name: 'list_workflows',
  description: 'List saved workflows with their schedule, status and last run.',
  input: {},
  sideEffect: false,
  run: async () => {
    const all = workflowStore.list()
    if (!all.length) return 'No workflows yet.'
    return all
      .map((l) => {
        if (!l.workflow) return `${l.file}: invalid (${l.error})`
        const wf = l.workflow
        const last = workflows.runs(wf.name, 1)[0]
        const trig = 'cron' in wf.trigger ? `cron "${wf.trigger.cron}"` : 'manual'
        return `${wf.name}: ${wf.enabled ? 'on' : 'off'}, ${trig}${last ? `, last run ${last.status} ${last.started_at}` : ''}. ${wf.description}`
      })
      .join('\n')
  }
})

export const runWorkflow = defineTool({
  name: 'run_workflow',
  description: 'Run a saved workflow now and return its result. Steps that change things still ask for approval unless pre-approved.',
  input: { name: z.string(), input: z.string().optional().describe('Available to the workflow as {{input}}') },
  sideEffect: false,
  run: async ({ name, input }) => {
    const id = await workflows.run(name, 'manual', input ?? '')
    const run = workflows.runs(name, 5).find((r) => r.id === id)
    if (run?.status === 'done') return run.output ?? 'Done.'
    throw new Error(run?.error ?? 'The run did not finish')
  }
})

export const deleteWorkflow = defineTool({
  name: 'delete_workflow',
  description: 'Delete a saved workflow and its schedule.',
  input: { name: z.string() },
  sideEffect: true,
  describe: ({ name }) => `Delete workflow "${name}"`,
  run: async ({ name }) => {
    if (!workflowStore.get(name)) return `No workflow named "${name}".`
    workflowStore.remove(name)
    workflows.sync()
    return `Deleted "${name}".`
  }
})

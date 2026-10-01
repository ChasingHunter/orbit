import { z } from 'zod'
import { defineTool } from '../types'
import { act, back, closeBrowser, control, currentHost, open, scroll, snapshot } from '../../../browser/session'

// The browser as two tools: looking (open, read, scroll, back) only reads, so it runs without
// asking at the default level; acting (click, type, press, select) changes things on a site, so
// it's an external action and asks first. Password, card and pay/buy controls always ask.

export const browserLook = defineTool({
  name: 'browser_look',
  description:
    "Use Orbit's own browser window to open a page and read it (text plus numbered controls for browser_act). The user can sign in to sites there once. Prefer web_fetch for simply reading public pages.",
  input: {
    action: z.enum(['open', 'read', 'scroll_down', 'scroll_up', 'back', 'close']),
    url: z.string().optional().describe('For open')
  },
  risk: 'read',
  describe: ({ action, url }) => (action === 'open' ? `Open ${url}` : `Browser: ${action.replace('_', ' ')}`),
  run: async ({ action, url }) => {
    if (action === 'open') {
      if (!url) throw new Error('url is required to open a page')
      return open(url)
    }
    if (action === 'scroll_down' || action === 'scroll_up') return scroll(action === 'scroll_down' ? 'down' : 'up')
    if (action === 'back') return back()
    if (action === 'close') {
      await closeBrowser()
      return 'Closed the browser.'
    }
    return snapshot()
  }
})

export const browserAct = defineTool({
  name: 'browser_act',
  description:
    'Do something on the page open in browser_look: click a control, type into it (replaces its text), choose an option, or press a key (e.g. Enter). Use the numbers from the last read. Returns the page after.',
  input: {
    action: z.enum(['click', 'type', 'select', 'press']),
    id: z.number().int().optional().describe('Control number'),
    text: z.string().optional().describe('Text to type, option to choose, or key to press')
  },
  risk: 'external',
  // Passwords, card details and buttons that pay or buy ask every time, even at Full.
  alwaysAsk: ({ id }) => !!(id && control(id)?.sensitive),
  // Whatever goes into a password, card or similar field stays out of the log.
  auditInput: (input) => (input.id && control(input.id)?.sensitive && input.text ? { ...input, text: '[hidden]' } : input),
  describe: ({ action, id, text }) => {
    const c = id ? control(id) : undefined
    const what = c ? `"${c.label || c.tag}"` : `[${id}]`
    if (action === 'click') return `Click ${what}`
    if (action === 'type') return `Type into ${what}`
    if (action === 'select') return `Choose "${text}" in ${what}`
    return `Press ${text || 'Enter'}`
  },
  preview: ({ action, id, text }) => {
    const c = id ? control(id) : undefined
    const masked = c?.type === 'password' && text ? '•'.repeat(Math.min(text.length, 12)) : text
    const lines = [currentHost() && `On ${currentHost()}`, c ? `${c.tag}${c.type ? ` (${c.type})` : ''} "${c.label}"` : '', action === 'type' || action === 'select' ? `Text: ${masked ?? ''}` : '']
    if (c?.sensitive) lines.push('This is a password, payment or purchase control, so Orbit always asks first.')
    return lines.filter(Boolean).join('\n')
  },
  run: async ({ action, id, text }) => act(action, id, text)
})

import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { dataDir } from '../paths'
import { logInfo } from '../log'

// Orbit's own browser: the installed Edge (or Chrome), driven over Playwright, in a separate
// profile under %APPDATA%\Orbit\browser-profile. Your normal browser and its profile are never
// touched; sign in to sites once in this window and Orbit stays signed in. Pages are read as text
// plus a numbered list of controls, which costs far fewer tokens than screenshots.

let ctx: BrowserContext | undefined
let current: Page | undefined

export type Control = { id: number; tag: string; type: string; label: string; value?: string; sensitive: boolean }

async function context(): Promise<BrowserContext> {
  if (ctx) return ctx
  const { chromium } = await import('playwright-core')
  const userDataDir = join(dataDir, 'browser-profile')
  let last: unknown
  for (const channel of ['msedge', 'chrome']) {
    try {
      ctx = await chromium.launchPersistentContext(userDataDir, {
        channel,
        // Tests run on the user's desktop; keep their browser windows out of sight.
        headless: !!process.env.ORBIT_E2E,
        viewport: null,
        args: ['--no-first-run', '--no-default-browser-check']
      })
      break
    } catch (err) {
      last = err
    }
  }
  if (!ctx) throw new Error(`Couldn't start Edge or Chrome: ${last instanceof Error ? last.message.split('\n')[0] : String(last)}`)
  ctx.on('close', () => {
    ctx = undefined
    current = undefined
  })
  ctx.on('page', (p) => {
    // A link that opens a new tab: follow it.
    current = p
    p.on('dialog', (d) => void d.dismiss().catch(() => {}))
  })
  return ctx
}

async function page(): Promise<Page> {
  const c = await context()
  if (current && !current.isClosed()) return current
  current = c.pages().find((p) => !p.isClosed()) ?? (await c.newPage())
  current.on('dialog', (d) => void d.dismiss().catch(() => {}))
  return current
}

export function browserOpen(): boolean {
  return !!ctx
}

export async function closeBrowser(): Promise<void> {
  const c = ctx
  ctx = undefined
  current = undefined
  await c?.close().catch((err) => logInfo('browser: close failed', err))
}

/**
 * Numbers every visible control on the page (data-orbit-id) and describes it. Runs in the page, so
 * it's plain JavaScript in a string (the main process isn't compiled with browser types).
 */
const TAG_CONTROLS = String.raw`(() => {
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[contenteditable=true]'
  document.querySelectorAll('[data-orbit-id]').forEach((e) => e.removeAttribute('data-orbit-id'))
  const els = [...document.querySelectorAll(sel)].filter((e) => {
    const r = e.getBoundingClientRect()
    const st = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !e.disabled
  })
  return els.slice(0, 150).map((e, i) => {
    e.setAttribute('data-orbit-id', String(i + 1))
    const tag = e.tagName.toLowerCase()
    const type = e.getAttribute('type') || ''
    const label = (e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('placeholder') || e.innerText || e.getAttribute('title') || e.getAttribute('name') || e.getAttribute('href') || '')
      .trim().replace(/\s+/g, ' ').slice(0, 80)
    const hints = (e.getAttribute('autocomplete') || '') + ' ' + (e.getAttribute('name') || '') + ' ' + e.id + ' ' + label
    // Passwords, card details, and buttons that pay or buy: these always ask, whatever the level.
    const sensitive = type === 'password' ||
      /cc-|card.?num|cvc|cvv|security code|iban|password|passcode|\bpin\b/i.test(hints) ||
      (/^(button|a|summary)$/.test(tag) && /\b(pay|buy|purchase|checkout|place order|subscribe|confirm payment|delete account|transfer)\b/i.test(label))
    const value = tag === 'input' || tag === 'textarea' ? (type === 'password' ? '' : String(e.value || '').slice(0, 40)) : undefined
    return { id: i + 1, tag, type, label, value, sensitive }
  })
})()`

let lastControls: Control[] = []
let lastUrl = ''

/** The site the last read page was on, for approval cards. */
export function currentHost(): string {
  try {
    return new URL(lastUrl).host
  } catch {
    return ''
  }
}

/** The page as the model sees it: address, title, readable text, then the numbered controls. */
export async function snapshot(maxText = 4000): Promise<string> {
  const p = await page()
  await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {})
  lastControls = (await p.evaluate(TAG_CONTROLS)) as Control[]
  lastUrl = p.url()
  let text = ((await p.evaluate('document.body ? document.body.innerText : ""')) as string).replace(/\n{3,}/g, '\n\n').trim()
  if (text.length > maxText) text = `${text.slice(0, maxText)}\n…[more below; scroll to read on]`
  const controls = lastControls
    .map((c) => {
      const kind = c.tag === 'input' ? `input${c.type ? `(${c.type})` : ''}` : c.tag === 'a' ? 'link' : c.tag
      return `[${c.id}] ${kind} "${c.label}"${c.value ? ` value="${c.value}"` : ''}`
    })
    .join('\n')
  const title = (await p.title()).replace(/"/g, "'")
  return `<untrusted_page url="${p.url()}" title="${title}">\n${text}\n\nControls (use their numbers with browser_act):\n${controls || '(none)'}\n</untrusted_page>`
}

export async function open(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const p = await page()
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  return snapshot()
}

export async function scroll(direction: 'down' | 'up'): Promise<string> {
  const p = await page()
  await p.mouse.wheel(0, direction === 'down' ? 800 : -800)
  await p.waitForTimeout(300)
  return snapshot()
}

export async function back(): Promise<string> {
  const p = await page()
  await p.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
  return snapshot()
}

/** The control with this number on the page as last read, if any. */
export function control(id: number): Control | undefined {
  return lastControls.find((c) => c.id === id)
}

export async function act(action: 'click' | 'type' | 'press' | 'select', id: number | undefined, text: string | undefined): Promise<string> {
  const p = await page()
  if (action === 'press') {
    await p.keyboard.press(text || 'Enter')
  } else {
    if (!id || !control(id)) throw new Error(`No control [${id}] on the page. Read the page again to get fresh numbers.`)
    const el = p.locator(`[data-orbit-id="${id}"]`).first()
    if (action === 'click') await el.click({ timeout: 10_000 })
    else if (action === 'type') await el.fill(text ?? '', { timeout: 10_000 })
    else await el.selectOption({ label: text ?? '' }, { timeout: 10_000 })
  }
  await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {})
  await p.waitForTimeout(400)
  return snapshot()
}

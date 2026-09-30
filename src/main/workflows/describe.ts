import type { Trigger } from './schema'

// Turns triggers (and common cron patterns) into plain words for the dashboard.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function time(h: string, m: string): string {
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [m, h, dom, mon, dow] = parts
  const fixedTime = /^\d+$/.test(m) && /^\d+$/.test(h)
  if (mon !== '*') return cron

  if (fixedTime && dom === '*') {
    const at = time(h, m)
    if (dow === '*') return `Every day at ${at}`
    if (dow === '1-5') return `Weekdays at ${at}`
    if (dow === '0,6' || dow === '6,0') return `Weekends at ${at}`
    if (/^\d$/.test(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${at}`
    if (/^[\d,]+$/.test(dow)) return `${dow.split(',').map((d) => DAYS[Number(d) % 7].slice(0, 3)).join(', ')} at ${at}`
  }
  if (fixedTime && /^\d+$/.test(dom) && dow === '*') return `Monthly on day ${dom} at ${time(h, m)}`
  if (/^\d+$/.test(m) && h === '*' && dom === '*' && dow === '*') return `Every hour at :${m.padStart(2, '0')}`
  const everyH = h.match(/^\*\/(\d+)$/)
  if (/^\d+$/.test(m) && everyH && dom === '*' && dow === '*') return `Every ${everyH[1]} hours`
  const everyM = m.match(/^\*\/(\d+)$/)
  if (everyM && h === '*' && dom === '*' && dow === '*') return `Every ${everyM[1]} minutes`
  return cron
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function describeTrigger(t: Trigger): string {
  if ('cron' in t) return describeCron(t.cron)
  if ('manual' in t) return 'When you run it'
  if ('feed' in t) return `New posts on ${host(t.feed.url)} (checks every ${t.feed.every})`
  if ('page' in t) return `When ${host(t.page.url)}${t.page.selector ? ` (${t.page.selector})` : ''} changes (checks every ${t.page.every})`
  if ('poll' in t) return `When ${t.poll.tool} returns something new (checks every ${t.poll.every})`
  if ('folder' in t) return `New ${t.folder.pattern === '*' ? 'files' : t.folder.pattern + ' files'} in ${t.folder.path}`
  return 'When its webhook is called'
}

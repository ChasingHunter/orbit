// Turns common cron patterns into plain words for the dashboard. Falls back to the raw pattern.

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

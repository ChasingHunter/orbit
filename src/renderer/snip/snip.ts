const shot = document.getElementById('shot') as HTMLImageElement
const shade = document.getElementById('shade') as HTMLDivElement
const sel = document.getElementById('sel') as HTMLDivElement
let start: { x: number; y: number } | null = null
let finished = false

window.orbit.onSnipImage((dataUrl) => {
  shot.src = dataUrl
})

function rectFrom(e: MouseEvent): { x: number; y: number; width: number; height: number } {
  const x = Math.min(start!.x, e.clientX)
  const y = Math.min(start!.y, e.clientY)
  return { x, y, width: Math.abs(e.clientX - start!.x), height: Math.abs(e.clientY - start!.y) }
}

function done(rect: Parameters<typeof window.orbit.snipDone>[0]): void {
  if (finished) return
  finished = true
  window.orbit.snipDone(rect)
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return done(null)
  start = { x: e.clientX, y: e.clientY }
  shade.style.display = 'none'
  sel.style.display = 'block'
})
window.addEventListener('mousemove', (e) => {
  if (!start) return
  const r = rectFrom(e)
  Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
})
window.addEventListener('mouseup', (e) => {
  if (start) done(rectFrom(e))
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') done(null)
})
window.addEventListener('contextmenu', () => done(null))

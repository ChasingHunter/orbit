import type { ContextItem } from '@shared/types'

// Turns dropped, pasted or picked files into context items. Images are decoded here (Chromium
// reads PNG, JPEG, WebP, GIF, BMP, AVIF) and shrunk so the long side is at most 1568 px, which is
// what Claude scales to anyway: same answer, fewer tokens. Everything else goes to the main
// process, which copies it and pulls out the text.

const MAX_SIDE = 1568

export async function attachFiles(files: File[]): Promise<{ items: ContextItem[]; errors: string[] }> {
  const api = window.orbit
  const items: ContextItem[] = []
  const errors: string[] = []
  const paths: string[] = []
  for (const file of files) {
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      try {
        items.push(await imageItem(file))
      } catch {
        errors.push(`${file.name}: couldn't read this image`)
      }
      continue
    }
    const path = api.pathForFile(file)
    if (path) {
      paths.push(path)
    } else {
      const res = await api.attachData(file.name || 'pasted.txt', new Uint8Array(await file.arrayBuffer()))
      items.push(...res.items)
      errors.push(...res.errors)
    }
  }
  if (paths.length) {
    const res = await api.attachPaths(paths)
    items.push(...res.items)
    errors.push(...res.errors)
  }
  return { items, errors }
}

async function imageItem(file: File): Promise<ContextItem> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  // PNG keeps screenshots and diagrams crisp; photos are far smaller as JPEG.
  const png = await canvas.convertToBlob({ type: 'image/png' })
  const blob = png.size > 1_000_000 ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }) : png
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return {
    kind: 'screenshot',
    id: crypto.randomUUID(),
    name: file.name || 'pasted image',
    mediaType: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    base64: btoa(binary),
    width,
    height
  }
}

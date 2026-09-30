import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { Settings } from '@shared/settings'
import { paths } from './paths'

class SettingsStore extends EventEmitter {
  current: Settings = Settings.parse({})

  load(): void {
    if (!existsSync(paths.settings)) {
      this.save()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(paths.settings, 'utf8'))
      const parsed = Settings.safeParse(raw)
      if (parsed.success) this.current = parsed.data
      else console.error('[settings] invalid settings.json, keeping previous:', parsed.error.message)
    } catch (err) {
      console.error('[settings] could not read settings.json:', err)
    }
  }

  save(): void {
    writeFileSync(paths.settings, JSON.stringify(this.current, null, 2))
  }

  /** Hot-reload when the user hand-edits settings.json. */
  watch(): void {
    let timer: NodeJS.Timeout | undefined
    watch(paths.settings, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        this.load()
        this.emit('change', this.current)
      }, 200)
    })
  }
}

export const settings = new SettingsStore()

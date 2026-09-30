import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// %APPDATA%\Orbit: all user data lives here (plain files, easy to back up).
// ORBIT_DATA_DIR lets tests run against an isolated profile.
export const dataDir = process.env.ORBIT_DATA_DIR ?? join(app.getPath('appData'), 'Orbit')
export const paths = {
  settings: join(dataDir, 'settings.json'),
  secrets: join(dataDir, 'secrets.json'),
  audit: join(dataDir, 'logs', 'audit.jsonl'),
  persona: join(dataDir, 'persona.md'),
  files: join(dataDir, 'files'),
  attachments: join(dataDir, 'attachments'),
  /** Backups of your files taken before Orbit changes them. */
  snapshots: join(dataDir, 'snapshots'),
  // Large downloaded models; overridable so test profiles can share them.
  models: process.env.ORBIT_MODELS_DIR ?? join(dataDir, 'models')
}

export function ensureDataDirs(): void {
  for (const d of [dataDir, join(dataDir, 'logs'), paths.files]) mkdirSync(d, { recursive: true })
}

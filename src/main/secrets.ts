import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { paths } from './paths'

// API keys encrypted with Windows DPAPI (via Electron safeStorage).
// Never logged, never sent to a model, never stored in memory/settings.

type Store = Record<string, string> // name -> base64 ciphertext

function read(): Store {
  if (!existsSync(paths.secrets)) return {}
  return JSON.parse(readFileSync(paths.secrets, 'utf8'))
}

export function setSecret(name: string, value: string): void {
  const store = read()
  store[name] = safeStorage.encryptString(value).toString('base64')
  writeFileSync(paths.secrets, JSON.stringify(store, null, 2))
}

export function getSecret(name: string): string | undefined {
  const enc = read()[name]
  if (!enc) return process.env[`ORBIT_${name.toUpperCase()}_KEY`]
  return safeStorage.decryptString(Buffer.from(enc, 'base64'))
}

export function listSecretNames(): string[] {
  return Object.keys(read())
}

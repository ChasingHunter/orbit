import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { dataDir } from '../paths'

// %APPDATA%\Orbit\integrations.json: which MCP servers to connect.
// Credentials are never stored here; `secretEnv` maps env vars to names in the DPAPI secret store.

export const ServerConfig = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('http'),
    name: z.string(),
    url: z.string().url(),
    enabled: z.boolean().default(true),
    /** Extra headers whose values come from the secret store, e.g. { Authorization: "Bearer {secret:github}" }. */
    secretHeaders: z.record(z.string(), z.string()).default({})
  }),
  z.object({
    type: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    secretEnv: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true)
  })
])
export type ServerConfig = z.infer<typeof ServerConfig>

const File = z.object({ servers: z.record(z.string(), ServerConfig).default({}) })
const file = join(dataDir, 'integrations.json')

export function loadServers(): Record<string, ServerConfig> {
  if (!existsSync(file)) return {}
  try {
    return File.parse(JSON.parse(readFileSync(file, 'utf8'))).servers
  } catch (err) {
    console.error('[integrations] invalid integrations.json:', err)
    return {}
  }
}

export function saveServers(servers: Record<string, ServerConfig>): void {
  writeFileSync(file, JSON.stringify({ servers }, null, 2))
}

export const integrationsFile = file

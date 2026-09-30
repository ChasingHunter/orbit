import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { dataDir } from './paths'

// Main-process log at %APPDATA%\Orbit\logs\main.log. Uncaught errors land here
// instead of Electron's modal "A JavaScript error occurred" dialog.

const file = join(dataDir, 'logs', 'main.log')

function write(level: string, args: unknown[]): void {
  try {
    appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`)
  } catch {
    // logging must never throw
  }
}

export function installLogging(onError?: (message: string) => void): void {
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    write('ERROR', args)
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    write('WARN', args)
    origWarn(...args)
  }
  process.on('uncaughtException', (err) => {
    write('UNCAUGHT', [err])
    origError(err)
    onError?.(err.message)
  })
  process.on('unhandledRejection', (reason) => {
    write('UNHANDLED', [reason])
    origError(reason)
  })
  write('INFO', [`Orbit starting (pid ${process.pid})`])
}

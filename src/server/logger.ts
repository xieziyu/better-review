import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Logger {
  info(msg: string, ctx?: unknown): void
  warn(msg: string, ctx?: unknown): void
  error(msg: string, ctx?: unknown): void
}

export function createLogger(file: string): Logger {
  mkdirSync(dirname(file), { recursive: true })
  const write = (level: string, msg: string, ctx?: unknown) => {
    const line = JSON.stringify({ ts: Date.now(), level, msg, ctx }) + '\n'
    try {
      appendFileSync(file, line)
    } catch {
      /* ignore */
    }
    if (level === 'error' || level === 'warn') process.stderr.write(line)
  }
  return {
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
  }
}

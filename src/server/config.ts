import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

const configSchema = z.object({
  port: z.number().int().nonnegative().default(0),
  idleShutdownMinutes: z.number().int().positive().default(240),
  maxConcurrentReviews: z.number().int().positive().default(4),
  claudeStallMinutes: z.number().int().positive().default(3),
  perPRGCDays: z.number().int().nonnegative().default(7),
})

export type Config = z.infer<typeof configSchema>

export const defaultConfig: Config = configSchema.parse({})

export function loadConfig(home: string): Config {
  const file = join(home, 'config.json')
  if (!existsSync(file)) return defaultConfig
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return configSchema.parse(raw)
}

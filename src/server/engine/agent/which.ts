import { execaSync } from 'execa'

export function whichBinary(bin: string): string | null {
  try {
    const r = execaSync('which', [bin], { reject: false })
    return r.exitCode === 0 ? String(r.stdout).trim() : null
  } catch {
    return null
  }
}

import { execa } from 'execa'

import { whichBinary } from '../engine/agent/which'

export type PickerKind = 'darwin' | 'linux' | 'unsupported'

export interface PickFolderResult {
  path: string | null
}

export interface FolderPicker {
  readonly kind: PickerKind
  readonly supported: boolean
  pick(opts?: { prompt?: string }): Promise<PickFolderResult>
}

class DarwinPicker implements FolderPicker {
  readonly kind = 'darwin' as const
  readonly supported = true

  async pick({ prompt }: { prompt?: string } = {}): Promise<PickFolderResult> {
    // Escape any `"` in the prompt so the AppleScript string remains valid.
    const safePrompt = (prompt ?? 'Select repository').replaceAll('"', '\\"')
    const script = `POSIX path of (choose folder with prompt "${safePrompt}")`
    const r = await execa('osascript', ['-e', script], { reject: false })
    if (r.exitCode === 0) {
      const out = r.stdout.trim().replace(/\/+$/, '')
      return { path: out || null }
    }
    // osascript returns exit 1 with stderr containing "User canceled. (-128)"
    // when the user dismisses the dialog. Treat that as a clean cancellation.
    if (r.stderr && /User canceled/i.test(r.stderr)) return { path: null }
    throw new Error(r.stderr || `osascript failed (exit ${r.exitCode ?? '?'})`)
  }
}

class ZenityPicker implements FolderPicker {
  readonly kind = 'linux' as const
  readonly supported = true
  constructor(private bin: string) {}

  async pick({ prompt }: { prompt?: string } = {}): Promise<PickFolderResult> {
    const args = ['--file-selection', '--directory']
    if (prompt) args.push(`--title=${prompt}`)
    const r = await execa(this.bin, args, { reject: false })
    if (r.exitCode === 0) return { path: r.stdout.trim() || null }
    // zenity exits 1 on cancel with empty stdout; treat as cancellation.
    if (r.exitCode === 1 && !r.stdout.trim()) return { path: null }
    throw new Error(r.stderr || `zenity failed (exit ${r.exitCode ?? '?'})`)
  }
}

class UnsupportedPicker implements FolderPicker {
  readonly kind = 'unsupported' as const
  readonly supported = false
  async pick(): Promise<PickFolderResult> {
    throw new Error('native folder picker is not supported on this platform')
  }
}

export function detectFolderPicker(platform: NodeJS.Platform = process.platform): FolderPicker {
  if (platform === 'darwin') return new DarwinPicker()
  if (platform === 'linux') {
    const zenity = whichBinary('zenity')
    if (zenity) return new ZenityPicker(zenity)
  }
  return new UnsupportedPicker()
}

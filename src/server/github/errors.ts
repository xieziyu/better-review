export class GhCliMissingError extends Error {
  constructor() {
    super('gh CLI not found in PATH')
    this.name = 'GhCliMissingError'
  }
}
export class GhPRNotFoundError extends Error {
  constructor(target: string) {
    super(`PR not found or no access: ${target}`)
    this.name = 'GhPRNotFoundError'
  }
}
export class GhSubmitError extends Error {
  public readonly stderr: string
  constructor(stderr: string) {
    super(`gh submit failed: ${stderr.slice(0, 500)}`)
    this.stderr = stderr
    this.name = 'GhSubmitError'
  }
}
export class GhFileNotFoundError extends Error {
  constructor(path: string, ref: string) {
    super(`gh api contents 404: ${path}@${ref.slice(0, 12)}`)
    this.name = 'GhFileNotFoundError'
  }
}
export class GhFileTooLargeError extends Error {
  constructor(path: string) {
    super(`file too large for contents API: ${path}`)
    this.name = 'GhFileTooLargeError'
  }
}

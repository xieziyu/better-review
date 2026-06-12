// Session-lifecycle errors shared by cancel-session, delete-session and
// rerun-session. The API routes map them to HTTP statuses by message
// ('not found' → 404, 'not running' / 'already archived' → 409).

export class SessionNotFoundError extends Error {
  constructor() {
    super('not found')
    this.name = 'SessionNotFoundError'
  }
}

export class SessionNotRunningError extends Error {
  constructor() {
    super('not running')
    this.name = 'SessionNotRunningError'
  }
}

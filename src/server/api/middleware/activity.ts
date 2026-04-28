import type { MiddlewareHandler } from 'hono'

export function activityMiddleware(onActivity: () => void): MiddlewareHandler {
  return async (_c, next) => {
    try {
      onActivity()
    } catch {
      /* never let activity tracking break the response */
    }
    await next()
  }
}

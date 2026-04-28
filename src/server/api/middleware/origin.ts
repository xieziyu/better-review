import type { MiddlewareHandler } from 'hono'

export function originGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin')
    if (!origin) return next()
    const port = getPort()
    const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    if (!allowed.includes(origin)) {
      return c.json({ error: 'forbidden origin' }, 403)
    }
    return next()
  }
}

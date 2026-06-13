import type { AgentKind } from '../../../shared/types'
import { ClaudeAgent } from './claude'
import { CodexAgent } from './codex'
import { PiAgent } from './pi'
import type { ReviewAgent } from './types'

const REGISTRY: Record<AgentKind, ReviewAgent> = {
  claude: new ClaudeAgent(),
  codex: new CodexAgent(),
  pi: new PiAgent(),
}

export function getAgent(kind: AgentKind): ReviewAgent {
  return REGISTRY[kind]
}

export type { ReviewAgent, AgentSpawnArgs, AgentRunHandle } from './types'
export { whichBinary } from './which'

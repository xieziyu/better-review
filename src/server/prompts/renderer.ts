export interface PromptVars {
  rules: string
  prMeta: string
  diff: string
  findingsPath: string
  schemaJson: string
  localRepoPath?: string
}

// When a local repo path is set we strip just the marker tags (each is
// expected to occupy its own line, so we eat the trailing newline along with
// the marker but leave inner content untouched). When unset, we strip the
// whole block — open marker through close marker plus the trailing newline
// the close marker introduced — so the surrounding markdown re-knits without
// drift from today's prompt.
const LOCAL_REPO_BLOCK_OPEN = /\{\{#LOCAL_REPO\}\}\n?/g
const LOCAL_REPO_BLOCK_CLOSE = /\{\{\/LOCAL_REPO\}\}\n?/g
const LOCAL_REPO_BLOCK_FULL = /\{\{#LOCAL_REPO\}\}[\s\S]*?\{\{\/LOCAL_REPO\}\}\n?/g

function applyLocalRepoBlocks(template: string, localRepoPath: string | undefined): string {
  if (localRepoPath && localRepoPath.length > 0) {
    return template.replace(LOCAL_REPO_BLOCK_OPEN, '').replace(LOCAL_REPO_BLOCK_CLOSE, '')
  }
  return template.replace(LOCAL_REPO_BLOCK_FULL, '')
}

export function renderPrompt(framework: string, vars: PromptVars): string {
  return applyLocalRepoBlocks(framework, vars.localRepoPath)
    .replaceAll('{{RULES}}', vars.rules)
    .replaceAll('{{PR_META}}', vars.prMeta)
    .replaceAll('{{DIFF}}', vars.diff)
    .replaceAll('{{FINDINGS_PATH}}', vars.findingsPath)
    .replaceAll('{{SCHEMA}}', vars.schemaJson)
    .replaceAll('{{LOCAL_REPO}}', vars.localRepoPath ?? '')
}

export interface PromptVars {
  prMeta: string
  diff: string
  findingsPath: string
  schemaJson: string
}

export function renderPrompt(template: string, vars: PromptVars): string {
  return template
    .replaceAll('{{PR_META}}', vars.prMeta)
    .replaceAll('{{DIFF}}', vars.diff)
    .replaceAll('{{FINDINGS_PATH}}', vars.findingsPath)
    .replaceAll('{{SCHEMA}}', vars.schemaJson)
}

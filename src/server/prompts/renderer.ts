export interface PromptVars {
  rules: string
  prMeta: string
  diff: string
  findingsPath: string
  schemaJson: string
}

export function renderPrompt(framework: string, vars: PromptVars): string {
  return framework
    .replaceAll('{{RULES}}', vars.rules)
    .replaceAll('{{PR_META}}', vars.prMeta)
    .replaceAll('{{DIFF}}', vars.diff)
    .replaceAll('{{FINDINGS_PATH}}', vars.findingsPath)
    .replaceAll('{{SCHEMA}}', vars.schemaJson)
}

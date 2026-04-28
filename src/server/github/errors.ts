export class GhCliMissingError extends Error {
  constructor() {
    super("gh CLI not found in PATH");
    this.name = "GhCliMissingError";
  }
}
export class GhAuthError extends Error {
  constructor(msg = "gh not authenticated; run `gh auth login`") {
    super(msg);
    this.name = "GhAuthError";
  }
}
export class GhPRNotFoundError extends Error {
  constructor(target: string) {
    super(`PR not found or no access: ${target}`);
    this.name = "GhPRNotFoundError";
  }
}
export class GhSubmitError extends Error {
  public readonly stderr: string;
  constructor(stderr: string) {
    super(`gh submit failed: ${stderr.slice(0, 500)}`);
    this.stderr = stderr;
    this.name = "GhSubmitError";
  }
}

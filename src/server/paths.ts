import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  home: string;
  serverJson: string;
  configFile: string;
  dbFile: string;
  sessionsDir: string;
  promptsDir: string;
  promptHome: string;
  daemonLog: string;
}

export function resolvePaths(home?: string): Paths {
  const h = home ?? process.env.BETTER_REVIEW_HOME ?? join(homedir(), ".better-review");
  return {
    home: h,
    serverJson: join(h, "server.json"),
    configFile: join(h, "config.json"),
    dbFile: join(h, "state.db"),
    sessionsDir: join(h, "sessions"),
    promptsDir: join(h, "prompts"),
    promptHome: join(h, "review.md"),
    daemonLog: join(h, "daemon.log"),
  };
}

export function projectPromptPath(cwd: string): string {
  return join(cwd, ".better-review", "review.md");
}

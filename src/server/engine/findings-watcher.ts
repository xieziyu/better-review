import chokidar from "chokidar";
import { readFileSync } from "node:fs";
import { parseFindings, type ParseResult } from "./findings-parser";

export async function watchFindings(
  file: string,
  onParsed: (r: ParseResult) => void,
): Promise<() => Promise<void>> {
  const watcher = chokidar.watch(file, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  const handle = () => {
    try {
      const raw = readFileSync(file, "utf8");
      onParsed(parseFindings(raw));
    } catch (e) {
      onParsed({ ok: false, error: `read error: ${(e as Error).message}` });
    }
  };
  watcher.on("add", handle);
  watcher.on("change", handle);
  await new Promise<void>((res) => watcher.on("ready", () => res()));
  return async () => {
    await watcher.close();
  };
}

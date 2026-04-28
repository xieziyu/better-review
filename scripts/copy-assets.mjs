import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function rewriteImports(file) {
  const src = readFileSync(file, "utf8");
  const dir = dirname(file);
  const replaceFn = (match, q1, spec, q2) => {
    const target = resolve(dir, spec);
    let resolved = null;
    if (existsSync(`${target}.js`)) {
      resolved = `${target}.js`;
    } else if (existsSync(target) && statSync(target).isDirectory()) {
      const idx = join(target, "index.js");
      if (existsSync(idx)) resolved = idx;
    }
    if (!resolved) return match;
    let rel = relative(dir, resolved).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${q1}${rel}${q2}`;
  };
  const next = src
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, replaceFn)
    .replace(/(import\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, replaceFn)
    .replace(/(import\s+["'])(\.{1,2}\/[^"']+)(["'])/g, replaceFn);
  if (next !== src) writeFileSync(file, next);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith(".js")) rewriteImports(p);
  }
}

mkdirSync("dist/server/db/migrations", { recursive: true });
cpSync("src/server/db/migrations", "dist/server/db/migrations", { recursive: true });

if (existsSync("prompts")) {
  mkdirSync("dist/prompts", { recursive: true });
  cpSync("prompts", "dist/prompts", { recursive: true });
}

if (existsSync("dist")) {
  walk("dist/server");
  if (existsSync("dist/cli")) walk("dist/cli");
  if (existsSync("dist/shared")) walk("dist/shared");
}

if (existsSync("dist/cli/index.js")) {
  chmodSync("dist/cli/index.js", 0o755);
}

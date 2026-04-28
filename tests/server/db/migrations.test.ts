import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../../src/server/db/migrations";

describe("runMigrations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "br-mig-"));
    mkdirSync(join(dir, "migrations"), { recursive: true });
  });

  it("applies SQL files and tracks version", () => {
    writeFileSync(join(dir, "migrations", "0001_init.sql"), "CREATE TABLE foo (id INT);");
    const db = new Database(":memory:");
    runMigrations(db, join(dir, "migrations"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("foo");
    expect(tables.map((t) => t.name)).toContain("_schema_version");
  });

  it("is idempotent", () => {
    writeFileSync(join(dir, "migrations", "0001_init.sql"), "CREATE TABLE foo (id INT);");
    const db = new Database(":memory:");
    runMigrations(db, join(dir, "migrations"));
    expect(() => runMigrations(db, join(dir, "migrations"))).not.toThrow();
  });
});

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { applyMigrations, splitSql } from "../src/server/migrate";

const schemaOf = async (db: D1Database) =>
  (
    await db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' AND name NOT LIKE 'f\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all()
  ).results;

describe("runtime migrations", () => {
  it("splits on semicolons outside quotes and comments", () => {
    expect(splitSql("CREATE TABLE a (x TEXT DEFAULT 'a;b'); -- c;\n/* d; */ INSERT INTO a VALUES ('it''s;');\n-- end")).toEqual([
      "CREATE TABLE a (x TEXT DEFAULT 'a;b')",
      "-- c;\n/* d; */ INSERT INTO a VALUES ('it''s;')",
    ]);
  });

  it("does nothing where wrangler already applied every migration", async () => {
    expect(await applyMigrations(env.DB)).toEqual([]);
  });

  it("builds an empty database to the same schema, once, even when two isolates race", async () => {
    const wranglerNames = (await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>()).results.map(
      (r) => r.name,
    );
    const [a, b] = await Promise.all([applyMigrations(env.FRESH_DB), applyMigrations(env.FRESH_DB)]);
    expect([...a, ...b].sort()).toEqual(wranglerNames);
    const expected = await schemaOf(env.DB);
    expect(expected.length).toBeGreaterThan(0);
    expect(await schemaOf(env.FRESH_DB)).toEqual(expected);
    expect(await applyMigrations(env.FRESH_DB)).toEqual([]);
  });
});

// Applies migrations/*.sql from inside the Worker, so a deploy that never ran
// `wrangler d1 migrations apply` (e.g. a Workers Builds deploy command of plain
// `npx wrangler deploy`) still gets its schema. Uses wrangler's own d1_migrations
// table and file names, so either path can run first without applying anything twice.
const FILES = import.meta.glob<string>("/migrations/*.sql", { query: "?raw", import: "default", eager: true });

const MIGRATIONS = Object.entries(FILES)
  .map(([path, sql]) => ({ name: path.slice(path.lastIndexOf("/") + 1), sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

// ponytail: splits on `;` outside quotes and comments only. CREATE TRIGGER bodies (BEGIN … END) would
// be cut apart; upgrade path is porting wrangler's splitSqlIntoStatements (src/d1/splitter.ts).
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let code = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      i = sql.indexOf("\n", i);
      if (i < 0) break;
    } else if (c === "/" && sql[i + 1] === "*") {
      i = sql.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      // A doubled quote ('it''s') just closes and reopens a quoted run, so it needs no special case.
      i = sql.indexOf(c === "[" ? "]" : c, i + 1);
      code = true;
      if (i < 0) break;
    } else if (c === ";") {
      if (code) out.push(sql.slice(start, i).trim());
      start = i + 1;
      code = false;
    } else if (!/\s/.test(c)) {
      code = true;
    }
  }
  if (code) out.push(sql.slice(start).trim());
  return out;
}

export async function applyMigrations(db: D1Database): Promise<string[]> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
    )
    .run();
  const appliedNames = async () =>
    new Set((await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>()).results.map((r) => r.name));
  let applied = await appliedNames();
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    try {
      // One batch is one transaction: the migration and its d1_migrations row commit together or not at all.
      await db.batch([
        ...splitSql(m.sql).map((s) => db.prepare(s)),
        db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(m.name),
      ]);
      ran.push(m.name);
    } catch (e) {
      applied = await appliedNames();
      if (!applied.has(m.name)) throw e; // otherwise another isolate applied it first
    }
  }
  return ran;
}

let ready: Promise<void> | undefined;

export function ensureMigrated(db: D1Database): Promise<void> {
  ready ??= applyMigrations(db).then(
    (ran) => {
      if (ran.length) console.log("Applied D1 migrations:", ran.join(", "));
    },
    (e) => {
      ready = undefined;
      throw e;
    },
  );
  return ready;
}

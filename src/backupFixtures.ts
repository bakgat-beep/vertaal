// Test support for the backup tests — not used by the app itself.
//
// Describes, as plain facts, what a healthy Vertaal database looks like at
// each version, and answers the questions backupValidation.ts asks a database,
// so the tests never need a real database file.
import { KNOWN_MIGRATIONS, SQL, requiredSchema, sha384Hex, type DatabaseFacts } from "./backupValidation";

export const LATEST_VERSION = KNOWN_MIGRATIONS[KNOWN_MIGRATIONS.length - 1].version;

// A genuine Vertaal database after updates 1..version: the right tables,
// columns, indexes and triggers, and a diary with the right checksums.
export async function genuineFacts(version: number): Promise<DatabaseFacts> {
  const schema = requiredSchema(version);
  const tables: Record<string, string[]> = {
    _sqlx_migrations: ["version", "description", "installed_on", "success", "checksum", "execution_time"],
  };
  for (const [table, column] of schema.columns) (tables[table] ??= []).push(column);
  const migrations: { version: number; checksum: string }[] = [];
  for (const m of KNOWN_MIGRATIONS.filter((m) => m.version <= version)) {
    migrations.push({ version: m.version, checksum: await sha384Hex(m.sql) });
  }
  return { tables, indexes: [...schema.indexes], triggers: [...schema.triggers], migrations, unfinishedMigrations: 0 };
}

// A healthy SQLite database that has tables with Vertaal's names but nothing
// else of Vertaal's — what an unrelated program's database could look like.
export const UNRELATED_FACTS: DatabaseFacts = {
  tables: { projects: ["id", "name"], strings: ["id", "text"], translations: ["id", "text"] },
  indexes: [],
  triggers: [],
  migrations: null,
  unfinishedMigrations: 0,
};

// Answers the queries backupValidation.ts sends, from plain facts.
export function answerQuery(facts: DatabaseFacts, query: string, integrity = "ok"): unknown[] {
  switch (query) {
    case SQL.columns:
      return Object.entries(facts.tables).flatMap(([table, columns]) => columns.map((c) => ({ table_name: table, column_name: c })));
    case SQL.objects:
      return [...facts.indexes.map((name) => ({ type: "index", name })), ...facts.triggers.map((name) => ({ type: "trigger", name }))];
    case SQL.finished:
      if (facts.migrations === null) throw new Error("no such column: success");
      return facts.migrations.map((m) => ({ version: m.version, checksum: m.checksum }));
    case SQL.unfinished:
      return [{ n: facts.unfinishedMigrations }];
    case SQL.integrity:
      return [{ integrity_check: integrity }];
  }
  throw new Error(`unexpected query: ${query}`);
}

// The same facts as the text a fake database file can hold in the backup tests.
export const FAKE_DB_PREFIX = "FAKEDB:";
export const fakeDbFile = (facts: DatabaseFacts) => FAKE_DB_PREFIX + JSON.stringify(facts);
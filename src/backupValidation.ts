// Decides whether a database file is a genuine Vertaal database that THIS
// version of Vertaal can open. Used before a backup is allowed to replace the
// live database (see restoreDatabase and applyPendingRestore in backup.ts).
//
// Why this exists: "it is a healthy SQLite file with tables called projects,
// strings and translations" proves nothing. Every time Vertaal starts, its
// database plugin (sqlx) compares the database's "diary" of finished updates —
// a table called _sqlx_migrations — with the updates this version of the app
// knows. It refuses to open a database whose diary has an update it does not
// know (a backup from a NEWER Vertaal), an update that was edited after it
// was applied, or an update that never finished. A restore that slips one of
// those through replaces the live database and then Vertaal cannot start.
//
// So a backup is accepted only when ALL of these hold:
//   1. it has the diary table, with no unfinished entries;
//   2. the diary is an unbroken run 1, 2, 3 ... N of updates this app knows
//      (an OLDER backup is fine: the app brings it up to date when it starts);
//   3. every entry's checksum matches this app's own copy of that update;
//   4. every table, column, index and trigger that updates 1..N create is there;
//   5. SQLite's own integrity check passes.

// This app's own copy of every update (the .sql files in src-tauri/migrations),
// read as plain text at build time. A test (migrations.test.ts) already makes
// sure these files are numbered without gaps and all registered in lib.rs.
const migrationFiles = import.meta.glob("../src-tauri/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

export const KNOWN_MIGRATIONS: { version: number; sql: string }[] = Object.entries(migrationFiles)
  .map(([path, sql]) => ({ version: Number(path.split("/").pop()!.slice(0, 4)), sql }))
  .sort((a, b) => a.version - b.version);

// The database plugin stores, for every finished update, the SHA-384 checksum
// of the update's exact text (hex digits, capitals, as SQLite's hex() writes
// them). We work it out the same way.
export async function sha384Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// What updates 1..N create. Copied from real databases built by the real
// plugin, update by update. "since" is the first update that has the thing.
//
// Only what the app cannot run without is listed, and only things that still
// exist today. If you add an update that creates a table, column, index or
// trigger, add it here too — backupValidation.test.ts fails and says what is
// missing. (Forgetting is never dangerous for users: a shorter list only
// makes this check a little less strict.)
type TableColumns = { since: number; table: string; columns: string[] };
const TABLES: TableColumns[] = [
  { since: 1, table: "games", columns: ["game_id", "display_name", "detected_version"] },
  { since: 1, table: "strings", columns: ["key", "game_id", "source_text", "source_text_hash", "file_path", "context_label"] },
  {
    since: 1,
    table: "translations",
    columns: ["id", "string_key", "game_id", "translated_text", "status", "translated_by", "updated_at"],
  },
  {
    since: 1,
    table: "translation_history",
    columns: ["id", "string_key", "game_id", "old_text", "new_text", "changed_by", "changed_at"],
  },
  { since: 1, table: "glossary", columns: ["id", "english_term", "notes"] },
  { since: 1, table: "contributors", columns: ["id", "name", "role"] },
  { since: 1, table: "app_settings", columns: ["schema_version"] },
  { since: 2, table: "strings", columns: ["category"] },
  { since: 3, table: "strings", columns: ["subcategory"] },
  { since: 4, table: "translations", columns: ["flagged"] },
  { since: 6, table: "translations", columns: ["target_language"] },
  { since: 6, table: "translation_history", columns: ["target_language"] },
  { since: 6, table: "glossary", columns: ["translated_term", "game_id", "target_language"] },
  {
    since: 6,
    table: "projects",
    columns: ["id", "game_id", "source_language", "target_language", "mod_name", "output_path", "created_at"],
  },
  { since: 7, table: "projects", columns: ["install_path"] },
  { since: 8, table: "projects", columns: ["ai_model"] },
  { since: 9, table: "user_settings", columns: ["id", "contributor_name"] },
  { since: 10, table: "translations", columns: ["source_hash_at_translation"] },
  { since: 11, table: "projects", columns: ["git_repo_path", "git_remote_url"] },
  { since: 12, table: "user_settings", columns: ["github_token"] },
  { since: 13, table: "projects", columns: ["translation_provider_id"] },
  { since: 13, table: "provider_credentials", columns: ["provider_id", "api_key", "base_url"] },
  { since: 14, table: "projects", columns: ["retry_delay_ms", "google_translate_delay_ms"] },
  { since: 15, table: "projects", columns: ["source_language_code_override", "target_language_code_override"] },
  { since: 16, table: "projects", columns: ["project_type", "parent_game_id", "source_mod_name", "source_mod_identifier"] },
  { since: 17, table: "projects", columns: ["hidden_from_recent"] },
  { since: 18, table: "glossary", columns: ["status"] },
  { since: 19, table: "translations", columns: ["source_text_at_translation"] },
  { since: 21, table: "strings", columns: ["removed_at"] },
];

type Named = { since: number; name: string };
// idx_translations_unique is what lets a translation be saved "insert, or update
// if it already exists"; without it saving would fail.
const INDEXES: Named[] = [
  { since: 5, name: "idx_translations_unique" },
  { since: 22, name: "idx_strings_game_file_key" },
  { since: 22, name: "idx_translation_history_lookup" },
];
const TRIGGERS: Named[] = [
  { since: 20, name: "trg_translations_compact_insert" },
  { since: 20, name: "trg_translations_compact_update" },
  { since: 20, name: "trg_strings_source_changed" },
];

// Everything a healthy Vertaal database must contain once updates 1..version
// have been applied.
export function requiredSchema(version: number) {
  const columns: [string, string][] = [];
  for (const part of TABLES) if (part.since <= version) for (const c of part.columns) columns.push([part.table, c]);
  return {
    columns,
    indexes: INDEXES.filter((i) => i.since <= version).map((i) => i.name),
    triggers: TRIGGERS.filter((t) => t.since <= version).map((t) => t.name),
  };
}

// ---------------------------------------------------------------------------
// Looking at a database file

// Plain facts about a database file, gathered by a handful of read-only queries.
export type DatabaseFacts = {
  tables: Record<string, string[]>; // table name -> its column names
  indexes: string[];
  triggers: string[];
  // Finished entries of the update diary; null when there is no usable diary table.
  migrations: { version: number; checksum: string }[] | null;
  unfinishedMigrations: number; // diary entries that never finished
};

export const SQL = {
  columns:
    "SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master AS m, pragma_table_info(m.name) AS p WHERE m.type = 'table'",
  objects: "SELECT type, name FROM sqlite_master WHERE type IN ('index', 'trigger')",
  finished: "SELECT version, hex(checksum) AS checksum FROM _sqlx_migrations WHERE success = 1 ORDER BY version",
  unfinished: "SELECT COUNT(*) AS n FROM _sqlx_migrations WHERE success != 1",
  integrity: "PRAGMA integrity_check",
};

// The one thing we need from a database connection (the SQL plugin's Database has it).
export type Reader = { select: <T>(query: string) => Promise<T> };

export async function gatherFacts(db: Reader): Promise<DatabaseFacts> {
  const columnRows = await db.select<{ table_name: string; column_name: string }[]>(SQL.columns);
  const tables: Record<string, string[]> = {};
  for (const r of columnRows) (tables[r.table_name] ??= []).push(r.column_name);

  const objects = await db.select<{ type: string; name: string }[]>(SQL.objects);

  let migrations: DatabaseFacts["migrations"] = null;
  let unfinishedMigrations = 0;
  if (tables["_sqlx_migrations"]) {
    try {
      const rows = await db.select<{ version: number; checksum: string }[]>(SQL.finished);
      migrations = rows.map((r) => ({ version: Number(r.version), checksum: String(r.checksum).toUpperCase() }));
      const unfinished = await db.select<{ n: number }[]>(SQL.unfinished);
      unfinishedMigrations = Number(unfinished[0]?.n ?? 0);
    } catch {
      migrations = null; // a table with that name but not the one the plugin makes
    }
  }

  return {
    tables,
    indexes: objects.filter((o) => o.type === "index").map((o) => o.name),
    triggers: objects.filter((o) => o.type === "trigger").map((o) => o.name),
    migrations,
    unfinishedMigrations,
  };
}

// ---------------------------------------------------------------------------
// Deciding

export type ProblemCode = "not-vertaal" | "unfinished" | "newer" | "incomplete-history" | "different-build" | "missing-structure" | "damaged";

const MESSAGES: Record<Exclude<ProblemCode, "missing-structure">, string> = {
  "not-vertaal": "That file is not a valid Vertaal backup, so nothing was changed.",
  unfinished:
    "That backup was saved while an update of Vertaal's data was only partly done, so it is not safe to use. Nothing was changed.",
  newer:
    "That backup was made by a newer version of Vertaal than this one, so this version cannot open it. Update Vertaal and try again. Nothing was changed.",
  "incomplete-history": "That backup's update history is incomplete, so it is not safe to use. Nothing was changed.",
  "different-build":
    "That backup does not match this version of Vertaal's database (it was made by a different build of the app), so it cannot be opened safely. Nothing was changed.",
  damaged: "That backup file is damaged (it failed its integrity check), so nothing was changed.",
};

export const NOT_A_BACKUP_MESSAGE = MESSAGES["not-vertaal"];

export type Problem = { code: ProblemCode; message: string };

// Thrown when a file must not be used as a backup. The message is meant to be
// shown to the person using the app.
export class BackupRejectedError extends Error {
  code: ProblemCode;
  constructor(problem: Problem) {
    super(problem.message);
    this.name = "BackupRejectedError";
    this.code = problem.code;
  }
}

function problem(code: Exclude<ProblemCode, "missing-structure">): Problem {
  return { code, message: MESSAGES[code] };
}

// Checks steps 1-4 above against facts about a file. Returns null when the
// file is fine, otherwise what is wrong. `known` is this app's own copy of the
// updates (each with its checksum).
export function checkDatabaseFacts(facts: DatabaseFacts, known: { version: number; checksum: string }[]): Problem | null {
  const knownChecksums = new Map(known.map((m) => [m.version, m.checksum.toUpperCase()]));

  // 1. The diary.
  if (facts.migrations === null || facts.migrations.length === 0) return problem("not-vertaal");
  if (facts.unfinishedMigrations > 0) return problem("unfinished");

  // 2. An update this app has never heard of means a newer Vertaal made it.
  const applied = [...facts.migrations].sort((a, b) => a.version - b.version);
  if (applied.some((m) => !knownChecksums.has(m.version))) return problem("newer");
  // ...and the updates must be 1, 2, 3 ... N with none missing in between.
  if (applied.some((m, i) => m.version !== i + 1)) return problem("incomplete-history");

  // 3. Each update must be the very same text this app has.
  if (applied.some((m) => m.checksum.toUpperCase() !== knownChecksums.get(m.version))) return problem("different-build");

  // 4. The structure those updates build.
  const need = requiredSchema(applied.length);
  const missing = (detail: string): Problem => ({
    code: "missing-structure",
    message: `That file looks like a Vertaal backup but is missing part of the structure Vertaal needs (${detail}), so it is not safe to use. Nothing was changed.`,
  });
  for (const [table, column] of need.columns) {
    const have = facts.tables[table];
    if (!have) return missing(`the "${table}" table`);
    if (!have.includes(column)) return missing(`the "${column}" column of the "${table}" table`);
  }
  for (const name of need.indexes) if (!facts.indexes.includes(name)) return missing(`the "${name}" index`);
  for (const name of need.triggers) if (!facts.triggers.includes(name)) return missing(`the "${name}" trigger`);

  return null;
}

let knownWithChecksums: Promise<{ version: number; checksum: string }[]> | undefined;
function knownMigrationChecksums() {
  knownWithChecksums ??= Promise.all(KNOWN_MIGRATIONS.map(async (m) => ({ version: m.version, checksum: await sha384Hex(m.sql) })));
  return knownWithChecksums;
}

// Throws a BackupRejectedError unless the open database is a healthy Vertaal
// database this version can open. Only ever call this on a COPY of the file —
// opening a database can modify the file it opens.
export async function assertVertaalDatabase(db: Reader): Promise<void> {
  const found = checkDatabaseFacts(await gatherFacts(db), await knownMigrationChecksums());
  if (found) throw new BackupRejectedError(found);

  // Last, because it is the slow one on a big database.
  const check = await db.select<{ integrity_check: string }[]>(SQL.integrity);
  if (check[0]?.integrity_check !== "ok") throw new BackupRejectedError(problem("damaged"));
}
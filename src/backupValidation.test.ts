import { describe, it, expect } from "vitest";
import {
  KNOWN_MIGRATIONS,
  BackupRejectedError,
  assertVertaalDatabase,
  checkDatabaseFacts,
  gatherFacts,
  requiredSchema,
  sha384Hex,
  type DatabaseFacts,
} from "./backupValidation";
import { LATEST_VERSION, UNRELATED_FACTS, answerQuery, genuineFacts } from "./backupFixtures";

async function knownWithChecksums() {
  return Promise.all(KNOWN_MIGRATIONS.map(async (m) => ({ version: m.version, checksum: await sha384Hex(m.sql) })));
}

// A copy of facts that a test can damage without touching the original.
const copy = (f: DatabaseFacts): DatabaseFacts => JSON.parse(JSON.stringify(f));

const versions = Array.from({ length: LATEST_VERSION }, (_, i) => i + 1);

describe("sha384Hex", () => {
  it("matches the standard SHA-384 of 'abc' (written in capitals, like SQLite's hex())", async () => {
    expect(await sha384Hex("abc")).toBe(
      "CB00753F45A35E8BB5A03D699AC65007272C32AB0EDED1631A8B605A43FF5BED8086072BA1E7CC2358BAECA134C825A7"
    );
  });
});

describe("this app's own copy of the updates", () => {
  it("is numbered 1, 2, 3 ... with nothing missing", () => {
    expect(KNOWN_MIGRATIONS.map((m) => m.version)).toEqual(versions);
    for (const m of KNOWN_MIGRATIONS) expect(m.sql.length).toBeGreaterThan(0);
  });
});

describe("checkDatabaseFacts", () => {
  it.each(versions)("accepts a genuine Vertaal database from version %i (older backups must keep working)", async (v) => {
    expect(checkDatabaseFacts(await genuineFacts(v), await knownWithChecksums())).toBeNull();
  });

  it("accepts extra tables and columns it does not know about", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.tables["some_extra_table"] = ["a"];
    facts.tables["projects"].push("some_extra_column");
    expect(checkDatabaseFacts(facts, await knownWithChecksums())).toBeNull();
  });

  it("rejects an unrelated database that merely has tables named projects, strings and translations", async () => {
    expect(checkDatabaseFacts(UNRELATED_FACTS, await knownWithChecksums())?.code).toBe("not-vertaal");
  });

  it("rejects a database whose update diary is empty", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.migrations = [];
    expect(checkDatabaseFacts(facts, await knownWithChecksums())?.code).toBe("not-vertaal");
  });

  it("rejects an update that never finished", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.unfinishedMigrations = 1;
    expect(checkDatabaseFacts(facts, await knownWithChecksums())?.code).toBe("unfinished");
  });

  it("rejects a backup from a NEWER Vertaal (an update this version has never heard of), and says so", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.migrations!.push({ version: LATEST_VERSION + 1, checksum: "AB12" });
    const found = checkDatabaseFacts(facts, await knownWithChecksums());
    expect(found?.code).toBe("newer");
    expect(found?.message).toContain("newer version of Vertaal");
  });

  it("rejects an update number that makes no sense (such as 0)", async () => {
    const facts = copy(await genuineFacts(3));
    facts.migrations!.push({ version: 0, checksum: "AB12" });
    expect(checkDatabaseFacts(facts, await knownWithChecksums())?.code).toBe("newer");
  });

  it("rejects a diary with an update missing in the middle", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.migrations = facts.migrations!.filter((m) => m.version !== 7);
    expect(checkDatabaseFacts(facts, await knownWithChecksums())?.code).toBe("incomplete-history");
  });

  it("rejects an update whose text is not the one this app has (made by a different build)", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.migrations![6].checksum = await sha384Hex("something else");
    expect(checkDatabaseFacts(facts, await knownWithChecksums())?.code).toBe("different-build");
  });

  it("accepts checksums whatever their capitalisation", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.migrations = facts.migrations!.map((m) => ({ ...m, checksum: m.checksum.toLowerCase() }));
    expect(checkDatabaseFacts(facts, await knownWithChecksums())).toBeNull();
  });

  it("rejects a missing table, naming it", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    delete facts.tables["projects"];
    const found = checkDatabaseFacts(facts, await knownWithChecksums());
    expect(found?.code).toBe("missing-structure");
    expect(found?.message).toContain('"projects" table');
  });

  it("rejects a missing column, naming it", async () => {
    const facts = copy(await genuineFacts(LATEST_VERSION));
    facts.tables["projects"] = facts.tables["projects"].filter((c) => c !== "install_path");
    const found = checkDatabaseFacts(facts, await knownWithChecksums());
    expect(found?.code).toBe("missing-structure");
    expect(found?.message).toContain('"install_path" column of the "projects" table');
  });

  it("rejects a missing index and a missing trigger", async () => {
    const noIndex = copy(await genuineFacts(LATEST_VERSION));
    noIndex.indexes = noIndex.indexes.filter((n) => n !== "idx_translations_unique");
    expect(checkDatabaseFacts(noIndex, await knownWithChecksums())?.message).toContain('"idx_translations_unique" index');

    const noTrigger = copy(await genuineFacts(LATEST_VERSION));
    noTrigger.triggers = noTrigger.triggers.filter((n) => n !== "trg_strings_source_changed");
    expect(checkDatabaseFacts(noTrigger, await knownWithChecksums())?.message).toContain('"trg_strings_source_changed" trigger');
  });

  it("only asks for what that version had: an old backup is not rejected for lacking newer columns", async () => {
    const facts = await genuineFacts(5);
    expect(facts.tables["projects"]).toBeUndefined();
    expect(facts.tables["strings"]).not.toContain("removed_at");
    expect(checkDatabaseFacts(facts, await knownWithChecksums())).toBeNull();
  });
});

// A stand-in for an open database that answers from facts.
const readerFor = (facts: DatabaseFacts, integrity = "ok") => ({
  select: async <T>(query: string) => answerQuery(facts, query, integrity) as T,
});

describe("gatherFacts", () => {
  it("reads back exactly the facts a database holds", async () => {
    const facts = await genuineFacts(LATEST_VERSION);
    const read = await gatherFacts(readerFor(facts));
    expect(read.tables).toEqual(facts.tables);
    expect(read.indexes.sort()).toEqual([...facts.indexes].sort());
    expect(read.triggers.sort()).toEqual([...facts.triggers].sort());
    expect(read.migrations).toEqual(facts.migrations);
    expect(read.unfinishedMigrations).toBe(0);
  });

  it("treats a table called _sqlx_migrations that is not the plugin's as having no usable diary", async () => {
    const facts = copy(UNRELATED_FACTS);
    facts.tables["_sqlx_migrations"] = ["id"];
    expect((await gatherFacts(readerFor(facts))).migrations).toBeNull();
  });
});

describe("assertVertaalDatabase", () => {
  it("accepts a genuine, healthy database", async () => {
    await expect(assertVertaalDatabase(readerFor(await genuineFacts(LATEST_VERSION)))).resolves.toBeUndefined();
  });

  it("rejects the unrelated database with a BackupRejectedError", async () => {
    const attempt = assertVertaalDatabase(readerFor(UNRELATED_FACTS));
    await expect(attempt).rejects.toBeInstanceOf(BackupRejectedError);
    await expect(attempt).rejects.toThrow("not a valid Vertaal backup");
  });

  it("rejects a genuine but damaged database", async () => {
    const attempt = assertVertaalDatabase(readerFor(await genuineFacts(LATEST_VERSION), "row 3 missing"));
    await expect(attempt).rejects.toThrow("damaged");
  });
});

// ---------------------------------------------------------------------------
// The list of expected tables/columns/indexes/triggers must agree with the real
// update files, in both directions.

// Everything the update files create, found by reading their text.
function createdByMigrations() {
  const created = new Set<string>(); // "table.column", "index:name", "trigger:name"
  const renamedAway = new Set<string>();
  const statement =
    /ALTER TABLE (\w+) ADD COLUMN (\w+)|ALTER TABLE (\w+) RENAME COLUMN (\w+) TO (\w+)|CREATE TABLE (\w+) \(([\s\S]*?)\n\);|CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+) ON|DROP INDEX (?:IF EXISTS )?(\w+)|CREATE TRIGGER (\w+)/g;
  for (const m of KNOWN_MIGRATIONS) {
    for (const s of m.sql.matchAll(statement)) {
      if (s[1]) created.add(`${s[1]}.${s[2]}`);
      else if (s[3]) {
        renamedAway.add(`${s[3]}.${s[4]}`);
        created.add(`${s[3]}.${s[5]}`);
      } else if (s[6]) {
        for (const line of s[7].split("\n").map((l) => l.trim())) {
          if (!line || line.startsWith("--") || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
          created.add(`${s[6]}.${line.split(/\s+/)[0]}`);
        }
      } else if (s[8]) created.add(`index:${s[8]}`);
      else if (s[9]) created.delete(`index:${s[9]}`);
      else if (s[10]) created.add(`trigger:${s[10]}`);
    }
  }
  for (const gone of renamedAway) created.delete(gone);
  return created;
}

function listedInBackupValidation(version: number) {
  const schema = requiredSchema(version);
  return new Set([
    ...schema.columns.map(([t, c]) => `${t}.${c}`),
    ...schema.indexes.map((n) => `index:${n}`),
    ...schema.triggers.map((n) => `trigger:${n}`),
  ]);
}

describe("the expected-structure list in backupValidation.ts", () => {
  it("only lists things the update files really create, in the update it says (a wrong entry would wrongly reject good backups)", () => {
    for (const v of versions) {
      const newInV = [...listedInBackupValidation(v)].filter((x) => !listedInBackupValidation(v - 1).has(x));
      const sqlOfV = KNOWN_MIGRATIONS[v - 1].sql;
      const createdInV = new Set<string>();
      const statement =
        /ALTER TABLE (\w+) ADD COLUMN (\w+)|ALTER TABLE (\w+) RENAME COLUMN \w+ TO (\w+)|CREATE TABLE (\w+) \(([\s\S]*?)\n\);|CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+) ON|CREATE TRIGGER (\w+)/g;
      for (const s of sqlOfV.matchAll(statement)) {
        if (s[1]) createdInV.add(`${s[1]}.${s[2]}`);
        else if (s[3]) createdInV.add(`${s[3]}.${s[4]}`);
        else if (s[5]) for (const line of s[6].split("\n")) createdInV.add(`${s[5]}.${line.trim().split(/\s+/)[0]}`);
        else if (s[7]) createdInV.add(`index:${s[7]}`);
        else if (s[8]) createdInV.add(`trigger:${s[8]}`);
      }
      const wrong = newInV.filter((x) => !createdInV.has(x));
      expect(wrong, `listed as new in update ${v} but not created by it`).toEqual([]);
    }
  });

  it("lists everything the update files create (so a new update must be added to the list)", () => {
    const listed = listedInBackupValidation(LATEST_VERSION);
    const missing = [...createdByMigrations()].filter((x) => !listed.has(x));
    expect(
      missing,
      "A migration creates these but src/backupValidation.ts does not list them yet — add them there (see the comment above TABLES)"
    ).toEqual([]);
  });
});
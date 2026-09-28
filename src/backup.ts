import { copyFile, exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import { appConfigDir, appDataDir, join } from "@tauri-apps/api/path";
import Database from "@tauri-apps/plugin-sql";
import { getDb } from "./db";

// Where things live. The database (and the scratch/staging files below) sit in
// the app's config folder — that is where the database plugin puts vertaal.db.
const DB_FILENAME = "vertaal.db";
// A private work copy used while making a backup or checking a backup file.
const WORK_FILENAME = "vertaal-backup-work.db";
// A backup that has been checked and is waiting to be put in place the next
// time Vertaal starts (see applyPendingRestore).
const PENDING_FILENAME = "vertaal-restore-pending.db";

const MAX_BACKUPS_TO_KEEP = 5;
const MAX_PRE_RESTORE_BACKUPS_TO_KEEP = 2;
const PRE_RESTORE_SUFFIX = "-pre-restore.db";

// Saved secrets never go into a backup file: a backup gets copied to cloud
// drives, emailed for support, etc. After restoring a backup, API keys and the
// GitHub token have to be entered again.
const SCRUB_SECRETS_SQL = [
  "UPDATE provider_credentials SET api_key = NULL",
  "UPDATE user_settings SET github_token = NULL",
];

async function configPath(filename: string): Promise<string> {
  return await join(await appConfigDir(), filename);
}

async function removeIfExists(path: string) {
  if (await exists(path)) await remove(path);
}

// A database in WAL mode keeps -wal and -shm side files next to it.
async function removeDbFiles(path: string) {
  for (const p of [path, `${path}-wal`, `${path}-shm`]) {
    await removeIfExists(p);
  }
}

// Opens one of our own scratch files (given by file name only, inside the
// config folder) with the same database plugin the app uses.
async function openScratch(filename: string) {
  return await Database.load(`sqlite:${filename}`);
}

async function vacuumInto(destPath: string) {
  await removeIfExists(destPath);
  const db = await getDb();
  const escapedDest = destPath.replace(/'/g, "''");
  await db.execute(`VACUUM INTO '${escapedDest}'`);
}

// Makes a copy of the live database at destPath with all saved secrets
// removed. Works on a private scratch copy first, so a failure part-way never
// leaves a half-made or un-scrubbed file at the destination.
async function writeScrubbedCopy(destPath: string) {
  const workPath = await configPath(WORK_FILENAME);
  try {
    await removeDbFiles(workPath);
    await vacuumInto(workPath);

    const scratch = await openScratch(WORK_FILENAME);
    try {
      // "Secure delete" makes SQLite blank out overwritten data instead of
      // leaving the old bytes lying in unused space inside the file.
      await scratch.execute("PRAGMA secure_delete = ON").catch(() => {});
      for (const statement of SCRUB_SECRETS_SQL) await scratch.execute(statement);
      // Fold any pending changes into the main file so copying it is enough.
      await scratch.execute("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => {});
    } finally {
      await scratch.close();
    }

    await removeIfExists(destPath);
    await copyFile(workPath, destPath);
  } finally {
    await removeDbFiles(workPath).catch(() => {});
  }
}

export async function backupDatabase(destPath?: string): Promise<string> {
  if (destPath) {
    await writeScrubbedCopy(destPath);
    return destPath;
  }

  const backupsDir = await join(await appDataDir(), "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = await join(backupsDir, `vertaal-backup-${timestamp}.db`);
  await writeScrubbedCopy(backupPath);
  await cleanupOldBackups(backupsDir);
  return backupPath;
}

// Checks that a file really is a healthy Vertaal database. Only ever looks at
// a COPY (already placed at the scratch file), never at the user's original —
// opening a database can modify the file it opens.
async function assertLooksLikeVertaalDatabase() {
  const notABackup = "That file is not a valid Vertaal backup, so nothing was changed.";
  let scratch;
  try {
    scratch = await openScratch(WORK_FILENAME);
    const tables = (await scratch.select("SELECT name FROM sqlite_master WHERE type = 'table'")) as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    for (const required of ["projects", "strings", "translations"]) {
      if (!names.has(required)) throw new Error(notABackup);
    }
    const check = (await scratch.select("PRAGMA integrity_check")) as { integrity_check: string }[];
    if (check[0]?.integrity_check !== "ok") {
      throw new Error("That backup file is damaged (it failed its integrity check), so nothing was changed.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("so nothing was changed")) throw err;
    throw new Error(notABackup);
  } finally {
    await scratch?.close().catch(() => {});
  }
}

// Prepares a restore. NOTHING is replaced while Vertaal is running — the
// running app has the database open, and swapping the file underneath it does
// not work reliably. Instead:
//   1. the chosen file is checked (it must be a healthy Vertaal database),
//   2. your current data is saved to a safety backup,
//   3. the checked file is put aside as "pending".
// The next time Vertaal starts, applyPendingRestore() puts it in place before
// the database is opened. Returns the safety backup's location.
export async function restoreDatabase(sourcePath: string): Promise<string> {
  const workPath = await configPath(WORK_FILENAME);
  const pendingPath = await configPath(PENDING_FILENAME);

  // 1. Check a copy of the file (the copy is thrown away afterwards).
  try {
    await removeDbFiles(workPath);
    await copyFile(sourcePath, workPath);
    await assertLooksLikeVertaalDatabase();
  } finally {
    await removeDbFiles(workPath).catch(() => {});
  }

  // Put the checked copy aside as the pending restore. (Re-copy from the
  // original: the checked copy was opened, which may have changed it.)
  await removeIfExists(pendingPath);
  await copyFile(sourcePath, pendingPath);

  // 2. Safety backup of what exists right now.
  const backupsDir = await join(await appDataDir(), "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyPath = await join(backupsDir, `vertaal-backup-${timestamp}${PRE_RESTORE_SUFFIX}`);
  try {
    await writeScrubbedCopy(safetyPath);
  } catch (err) {
    // No safety backup means no restore: take the pending file away again.
    await removeIfExists(pendingPath).catch(() => {});
    throw err;
  }
  await cleanupOldBackups(backupsDir);
  return safetyPath;
}

export type PendingRestoreResult = { status: "none" } | { status: "applied" } | { status: "failed"; message: string };

// Runs at the very start of every launch, BEFORE anything opens the database.
// If a restore is waiting, the backup is copied over the database now (nothing
// has the file open yet), the old database's leftover -wal/-shm files are
// removed, and the pending file is deleted. If anything goes wrong the pending
// file stays, so the next launch simply tries again.
export async function applyPendingRestore(): Promise<PendingRestoreResult> {
  const pendingPath = await configPath(PENDING_FILENAME);
  if (!(await exists(pendingPath))) return { status: "none" };

  const livePath = await configPath(DB_FILENAME);
  try {
    await copyFile(pendingPath, livePath);
    await removeIfExists(`${livePath}-wal`);
    await removeIfExists(`${livePath}-shm`);
    await remove(pendingPath);
    return { status: "applied" };
  } catch (err) {
    return { status: "failed", message: String(err) };
  }
}

async function cleanupOldBackups(backupsDir: string) {
  const entries = await readDir(backupsDir);
  const names = entries
    .filter((e) => e.name?.startsWith("vertaal-backup-") && e.name.endsWith(".db"))
    .map((e) => e.name as string)
    .sort(); // timestamps in the filename sort chronologically as plain text

  // Safety backups made before a restore are kept apart from the routine
  // ones, so a busy week of automatic backups can't push them out.
  const preRestore = names.filter((n) => n.endsWith(PRE_RESTORE_SUFFIX));
  const routine = names.filter((n) => !n.endsWith(PRE_RESTORE_SUFFIX));

  const toDelete = [
    ...routine.slice(0, Math.max(0, routine.length - MAX_BACKUPS_TO_KEEP)),
    ...preRestore.slice(0, Math.max(0, preRestore.length - MAX_PRE_RESTORE_BACKUPS_TO_KEEP)),
  ];
  for (const name of toDelete) {
    await remove(await join(backupsDir, name));
  }
}
import { copyFile, exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { getDb } from "./db";

const DB_FILENAME = "vertaal.db";
const MAX_BACKUPS_TO_KEEP = 5;

async function vacuumInto(destPath: string) {
  if (await exists(destPath)) {
    await remove(destPath);
  }
  const db = await getDb();
  const escapedDest = destPath.replace(/'/g, "''");
  await db.execute(`VACUUM INTO '${escapedDest}'`);
}

export async function backupDatabase(destPath?: string): Promise<string> {
  const dataDir = await appDataDir();

  if (destPath) {
    await vacuumInto(destPath);
    return destPath;
  }

  const backupsDir = await join(dataDir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = await join(backupsDir, `vertaal-backup-${timestamp}.db`);
  await vacuumInto(backupPath);
  await cleanupOldBackups(backupsDir);
  return backupPath;
}

export async function restoreDatabase(sourcePath: string): Promise<string> {
  const dataDir = await appDataDir();
  const dbPath = await join(dataDir, DB_FILENAME);

  const backupsDir = await join(dataDir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestoreBackupPath = await join(backupsDir, `vertaal-backup-${timestamp}-pre-restore.db`);
  await vacuumInto(preRestoreBackupPath);
  await cleanupOldBackups(backupsDir);

  await copyFile(sourcePath, dbPath);
  return preRestoreBackupPath;
}

async function cleanupOldBackups(backupsDir: string) {
  const entries = await readDir(backupsDir);
  const backupFiles = entries
    .filter((e) => e.name?.startsWith("vertaal-backup-") && e.name.endsWith(".db"))
    .map((e) => e.name as string)
    .sort(); // timestamps in the filename sort chronologically as plain text

  const excess = backupFiles.length - MAX_BACKUPS_TO_KEEP;
  for (let i = 0; i < excess; i++) {
    await remove(await join(backupsDir, backupFiles[i]));
  }
}
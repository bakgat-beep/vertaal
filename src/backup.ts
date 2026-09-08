import { copyFile, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

const DB_FILENAME = "vertaal.db";
const MAX_BACKUPS_TO_KEEP = 5;

export async function backupDatabase(destPath?: string): Promise<string> {
  const dataDir = await appDataDir();
  const dbPath = await join(dataDir, DB_FILENAME);

  if (destPath) {
    await copyFile(dbPath, destPath);
    return destPath;
  }

  const backupsDir = await join(dataDir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = await join(backupsDir, `vertaal-backup-${timestamp}.db`);
  await copyFile(dbPath, backupPath);
  await cleanupOldBackups(backupsDir);
  return backupPath;
}

// Replaces the live database with a chosen backup file. Before doing so, it
// takes its own automatic backup of whatever was live — so if the wrong file
// gets picked, that's recoverable too. Returns the path of that safety copy.
export async function restoreDatabase(sourcePath: string): Promise<string> {
  const dataDir = await appDataDir();
  const dbPath = await join(dataDir, DB_FILENAME);

  const backupsDir = await join(dataDir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestoreBackupPath = await join(backupsDir, `vertaal-backup-${timestamp}-pre-restore.db`);
  await copyFile(dbPath, preRestoreBackupPath);
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
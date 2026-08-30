import { Command } from "@tauri-apps/plugin-shell";

async function runGit(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const cmd = Command.create("run-git", args, { cwd });
    const result = await cmd.execute();
    const output = (result.stdout + result.stderr).trim();
    return { ok: result.code === 0, output };
  } catch (err) {
    return { ok: false, output: String(err) };
  }
}

export async function checkGitAvailable(): Promise<string | null> {
  const { ok, output } = await runGit(["--version"], ".");
  return ok ? output : null;
}

export async function initRepo(folderPath: string): Promise<{ ok: boolean; output: string }> {
  return runGit(["init"], folderPath);
}

export async function cloneRepo(url: string, destFolder: string): Promise<{ ok: boolean; output: string }> {
  // Clones into destFolder itself (".") rather than creating a nested subfolder,
  // so destFolder is expected to already exist and be empty.
  return runGit(["clone", url, "."], destFolder);
}

export async function setRemote(folderPath: string, url: string): Promise<{ ok: boolean; output: string }> {
  const existing = await runGit(["remote"], folderPath);
  if (existing.output.includes("origin")) {
    return runGit(["remote", "set-url", "origin", url], folderPath);
  }
  return runGit(["remote", "add", "origin", url], folderPath);
}

export async function commitAll(folderPath: string, message: string): Promise<{ ok: boolean; output: string }> {
  await runGit(["add", "."], folderPath);
  return runGit(["commit", "-m", message], folderPath);
}

function withTokenEmbedded(remoteUrl: string, token: string): string {
  return remoteUrl.replace(/^https:\/\//, `https://${token}@`);
}

export async function push(folderPath: string, token: string | null, remoteUrl: string): Promise<{ ok: boolean; output: string }> {
  const target = token ? withTokenEmbedded(remoteUrl, token) : "origin";
  return runGit(["push", target, "HEAD"], folderPath);
}

export async function pull(folderPath: string, token: string | null, remoteUrl: string): Promise<{ ok: boolean; output: string }> {
  const target = token ? withTokenEmbedded(remoteUrl, token) : "origin";
  return runGit(["pull", target], folderPath);
}
import { Command } from "@tauri-apps/plugin-shell";

function redactCredentials(args: string[], output: string): string {
  let redacted = output;
  for (const arg of args) {
    const match = arg.match(/^https:\/\/([^@/]+)@/);
    if (match) {
      const credential = match[1];
      redacted = redacted.split(credential).join("***");
    }
  }
  return redacted;
}

async function runGit(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const cmd = Command.create("run-git", args, { cwd });
    const result = await cmd.execute();
    const output = redactCredentials(args, (result.stdout + result.stderr).trim());
    return { ok: result.code === 0, output };
  } catch (err) {
    return { ok: false, output: redactCredentials(args, String(err)) };
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

// A commit needs SOME identity configured, and on a fresh Git install (no
// global user.name/user.email set anywhere) a plain "git commit" fails
// outright with "Author identity unknown". Rather than depend on whatever
// happens to be configured on this machine, every commit carries its own
// identity, taken from the name already saved in Vertaal (see settings.ts) —
// so commits are correctly attributed to the person who made them, and never
// fail for this reason. -c options only apply to this one command; nothing
// on the machine's own Git configuration is touched.
function gitIdentityArgs(contributorName: string | null): string[] {
  const name = contributorName?.trim() || "Vertaal User";
  const emailSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  return ["-c", `user.name=${name}`, "-c", `user.email=${emailSlug}@users.noreply.vertaal.local`];
}

export async function commitAll(
  folderPath: string,
  message: string,
  contributorName: string | null
): Promise<{ ok: boolean; output: string }> {
  await runGit(["add", "."], folderPath);
  return runGit([...gitIdentityArgs(contributorName), "commit", "-m", message], folderPath);
}

function withTokenEmbedded(remoteUrl: string, token: string): string {
  return remoteUrl.replace(/^https:\/\//, `https://${token}@`);
}

export async function push(folderPath: string, token: string | null, remoteUrl: string): Promise<{ ok: boolean; output: string }> {
  const target = token ? withTokenEmbedded(remoteUrl, token) : "origin";
  return runGit(["push", target, "HEAD"], folderPath);
}

const CONFLICT_PATTERN = /CONFLICT|Automatic merge failed/i;
// What Git says when the shared repository has no commits in it yet (nobody
// has synced anything at all so far) — normal for a brand-new project, not a
// real failure, and specifically NOT a sign that pushing next would fail.
const EMPTY_REMOTE_PATTERN = /couldn't find remote ref/i;

// Downloads and merges in collaborators' changes. Each contributor writes
// their own file (see fileNames.ts), so two people's changes essentially
// never touch the same lines, and Git merges them automatically without any
// help. On the rare occasion a real conflict does happen (most likely two
// contributors who share the same name, so their files collided) the merge
// is safely CANCELLED — restoring exactly what was here before this call —
// rather than left half-done with conflict markers in a file and no way
// back, which is what plain "git pull" would otherwise leave behind.
export async function pull(
  folderPath: string,
  token: string | null,
  remoteUrl: string,
  contributorName: string | null
): Promise<{ ok: boolean; output: string }> {
  const target = token ? withTokenEmbedded(remoteUrl, token) : "origin";
  // --no-rebase: always a merge, regardless of this machine's own git config
  // (pull.rebase) — the recovery step below assumes a merge is in progress.
  // "HEAD" as the thing to pull (rather than nothing, or a guessed branch
  // name) works whether or not this folder has ever fetched before, and
  // whatever the shared repository's default branch is actually called.
  // --allow-unrelated-histories: two collaborators' very first Sync each
  // starts from their own independent clone with no shared commit yet — Git
  // otherwise refuses to merge those on the grounds they might be two
  // unrelated projects, which isn't the case here.
  // Identity: merging two contributors' files can itself produce a MERGE
  // commit (whenever it's not a simple fast-forward), which needs an
  // identity exactly like any other commit — see gitIdentityArgs above.
  const result = await runGit(
    [...gitIdentityArgs(contributorName), "pull", "--no-rebase", "--allow-unrelated-histories", target, "HEAD"],
    folderPath
  );

  if (!result.ok && EMPTY_REMOTE_PATTERN.test(result.output)) {
    return { ok: true, output: "Nothing to pull yet — the shared repository is empty." };
  }

  if (!result.ok && CONFLICT_PATTERN.test(result.output)) {
    await runGit(["merge", "--abort"], folderPath);
    return {
      ok: false,
      output:
        `${result.output}\n\nThe automatic merge could not be completed, so it has been safely cancelled — ` +
        "nothing on your computer was changed. This usually means two collaborators are sharing the same name; " +
        "try giving yourself a more distinct one in App Settings, then Pull again.",
    };
  }
  return result;
}
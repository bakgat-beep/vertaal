import { Command } from "@tauri-apps/plugin-shell";

// Removes anything that looks like a password from text before it is shown.
// Two cases: a password written into a web address (https://secret@host), and
// the token itself, which is passed in separately.
function redactCredentials(args: string[], output: string, token: string | null = null): string {
  let redacted = output;
  for (const arg of args) {
    const match = arg.match(/^https:\/\/([^@/]+)@/);
    if (match) {
      const credential = match[1];
      redacted = redacted.split(credential).join("***");
    }
  }
  if (token) redacted = redacted.split(token).join("***");
  return redacted;
}

// The name of the environment variable that carries the GitHub token to Git.
// An environment variable is private to the one Git process we start, whereas
// command-line arguments can be seen by any program on the computer that lists
// running processes (Task Manager's "command line" column, for example).
export const TOKEN_ENV_NAME = "VERTAAL_GIT_TOKEN";

// Git settings that make Git ask a tiny helper for the password instead of us
// writing the password into the command. The first "credential.helper=" (empty)
// clears any helper already configured on this computer, so ours is the only
// one asked. The helper itself just prints the token from the environment
// variable; the token never appears in the command, in the saved remote address
// or in Git's own config files.
export function tokenCredentialArgs(): string[] {
  return [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=!f() { echo username=x-access-token; echo "password=$${TOKEN_ENV_NAME}"; }; f`,
  ];
}

async function runGit(
  args: string[],
  cwd: string,
  token: string | null = null
): Promise<{ ok: boolean; output: string }> {
  try {
    // GIT_TERMINAL_PROMPT=0: if the password is wrong, fail with a message
    // rather than waiting for someone to type into a window that isn't there.
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
    if (token) env[TOKEN_ENV_NAME] = token;
    const fullArgs = token ? [...tokenCredentialArgs(), ...args] : args;
    const cmd = Command.create("run-git", fullArgs, { cwd, env });
    const result = await cmd.execute();
    const output = redactCredentials(fullArgs, (result.stdout + result.stderr).trim(), token);
    return { ok: result.code === 0, output };
  } catch (err) {
    return { ok: false, output: redactCredentials(args, String(err), token) };
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
  // If staging fails, stop here. Committing anyway could save an older,
  // half-staged set of files and then report success, so this change would
  // quietly be left out of what gets shared.
  const staged = await runGit(["add", "."], folderPath);
  if (!staged.ok) {
    return { ok: false, output: `Could not prepare the files to be saved (git add failed): ${staged.output}` };
  }
  return runGit([...gitIdentityArgs(contributorName), "commit", "-m", message], folderPath);
}

export async function push(folderPath: string, token: string | null, remoteUrl: string): Promise<{ ok: boolean; output: string }> {
  // The address is used as it is; the token (if any) travels separately, see
  // tokenCredentialArgs above.
  const target = token ? remoteUrl : "origin";
  return runGit(["push", target, "HEAD"], folderPath, token);
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
  const target = token ? remoteUrl : "origin";
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
    folderPath,
    token
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
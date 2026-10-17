import { Command } from "@tauri-apps/plugin-shell";

// Removes anything that looks like a password from text before it is shown.
// Three cases: a password written into a web address in a command we ran
// (https:// or http://), the same thing inside whatever Git prints back (Git
// likes to repeat the address it was using), and the token itself, which is
// passed in separately.
function redactCredentials(args: string[], output: string, token: string | null = null): string {
  let redacted = output;
  for (const arg of args) {
    const match = arg.match(/^https?:\/\/([^@/]+)@/i);
    if (match) {
      const credential = match[1];
      redacted = redacted.split(credential).join("***");
    }
  }
  redacted = redacted.replace(/(https?:\/\/)[^\s/@'"]+@/gi, "$1***@");
  if (token) redacted = redacted.split(token).join("***");
  return redacted;
}

// Reads a web address ("scheme://...") if it is one. Addresses in the "git@host:path"
// form are not web addresses and return null.
function parseWebAddress(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

// A password, or a token used as a "user name", written into a web address
// (https://name:secret@host/...) would be saved in plain text in the repository's
// own settings and echoed in messages. Vertaal keeps the token separately (see
// App Settings), so addresses like that are refused. Returns a plain-words
// problem, or null when the address is fine. The message never repeats the address.
export function checkRemoteUrl(url: string): string | null {
  const u = parseWebAddress(url);
  if (u && (u.username || u.password)) {
    return (
      "This address has a user name or password written into it (the part before the @). " +
      "That would be saved in plain text and could leak. Remove it and use the plain address, for example " +
      "https://github.com/owner/repository.git. Your GitHub token is kept separately in the Collaboration settings."
    );
  }
  return null;
}

// The GitHub token is only ever handed to Git for an https address on
// github.com itself. Before, it was sent to whatever address was typed in,
// which would have given the token to any other site (or a look-alike such as
// github.com.evil.com, or an unencrypted http:// address).
export function tokenCanBeSentTo(url: string): boolean {
  const u = parseWebAddress(url);
  return (
    !!u &&
    u.protocol === "https:" &&
    u.hostname === "github.com" &&
    !u.username &&
    !u.password &&
    (u.port === "" || u.port === "443")
  );
}

// Decides how push and pull talk to the remote: refuses addresses with a
// password in them, and only passes the token on when it is allowed to go there.
function prepareRemote(
  token: string | null,
  remoteUrl: string
): { problem: string | null; token: string | null; target: string; tokenHeldBack: boolean } {
  const problem = remoteUrl.trim() ? checkRemoteUrl(remoteUrl) : null;
  if (problem) return { problem, token: null, target: "origin", tokenHeldBack: false };
  const useToken = !!token && tokenCanBeSentTo(remoteUrl);
  return {
    problem: null,
    token: useToken ? token : null,
    target: useToken ? remoteUrl.trim() : "origin",
    tokenHeldBack: !!token && !useToken,
  };
}

const TOKEN_HELD_BACK_NOTE =
  "\n\nNote: your GitHub token was not used, because it is only sent to https://github.com addresses. " +
  "If this repository is on GitHub, check the address in the Collaboration settings.";

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

// Every git command Vertaal runs has its own entry in the app's permission list
// (src-tauri/capabilities/default.json), named here as `scope`, that spells out
// exactly which arguments are allowed. There is no entry that allows "any git
// command", so git options that can run other programs (-c core.sshCommand=...,
// --upload-pack=...) are refused by the app itself. The commands that use the
// GitHub token have a second entry, "<scope>-token", which also carries the four
// credential arguments. If a command here changes, its entry there must change
// too: src/gitPermissions.test.ts checks that they agree.
async function runGit(
  scope: string,
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
    const cmd = Command.create(token ? `${scope}-token` : scope, fullArgs, { cwd, env });
    const result = await cmd.execute();
    const output = redactCredentials(fullArgs, (result.stdout + result.stderr).trim(), token);
    return { ok: result.code === 0, output };
  } catch (err) {
    return { ok: false, output: redactCredentials(args, String(err), token) };
  }
}

export async function checkGitAvailable(): Promise<string | null> {
  const { ok, output } = await runGit("git-version", ["--version"], ".");
  return ok ? output : null;
}

export async function initRepo(folderPath: string): Promise<{ ok: boolean; output: string }> {
  return runGit("git-init", ["init"], folderPath);
}

export async function cloneRepo(url: string, destFolder: string): Promise<{ ok: boolean; output: string }> {
  const problem = checkRemoteUrl(url);
  if (problem) return { ok: false, output: problem };
  // Clones into destFolder itself (".") rather than creating a nested subfolder,
  // so destFolder is expected to already exist and be empty.
  return runGit("git-clone", ["clone", url, "."], destFolder);
}

export async function setRemote(folderPath: string, url: string): Promise<{ ok: boolean; output: string }> {
  const problem = checkRemoteUrl(url);
  if (problem) return { ok: false, output: problem };
  const existing = await runGit("git-remote-list", ["remote"], folderPath);
  if (existing.output.includes("origin")) {
    return runGit("git-remote-set-url", ["remote", "set-url", "origin", url], folderPath);
  }
  return runGit("git-remote-add", ["remote", "add", "origin", url], folderPath);
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

// Saves (commits) ONLY the files named here. It used to run "git add ." which
// stages everything in the folder, so any other file sitting there (notes,
// a settings file with a password in it, someone's unrelated work) would be
// uploaded to the shared repository by the next Sync. Now:
//  - "git add -- <files>" stages just those files ("--" means "everything after
//    this is a file name", so a name that starts with a dash can't be read as
//    an option).
//  - "git commit -- <files>" commits just those files, even if something else
//    happened to be staged in the folder already.
// An empty list is refused outright, so this can never fall back to "everything".
export async function commitFiles(
  folderPath: string,
  message: string,
  contributorName: string | null,
  files: string[]
): Promise<{ ok: boolean; output: string }> {
  if (files.length === 0) {
    return { ok: false, output: "Nothing was named to be saved, so nothing was committed." };
  }
  // If staging fails, stop here. Committing anyway could save an older,
  // half-staged set of files and then report success, so this change would
  // quietly be left out of what gets shared.
  const staged = await runGit("git-add", ["add", "--", ...files], folderPath);
  if (!staged.ok) {
    return { ok: false, output: `Could not prepare the files to be saved (git add failed): ${staged.output}` };
  }
  return runGit("git-commit", [...gitIdentityArgs(contributorName), "commit", "-m", message, "--", ...files], folderPath);
}

// Files in the folder that Git sees as new or changed but that Sync does NOT
// share (everything except the files in `shared`). Used only to show a
// warning, so if Git can't answer, the answer is simply "none".
export async function listUnsharedFiles(folderPath: string, shared: string[]): Promise<string[]> {
  const result = await runGit("git-status", ["status", "--porcelain", "-z", "-uall"], folderPath);
  if (!result.ok) return [];
  // Each entry is "XY path": two status letters, a space, then the path,
  // separated by NUL characters (-z avoids any quoting of odd names). runGit
  // trims the whole output, which can eat the leading space of the FIRST entry
  // (" M name" becomes "M name"), so a one-letter prefix is accepted too.
  const sharedSet = new Set(shared);
  const names: string[] = [];
  for (const entry of result.output.split("\0")) {
    if (!entry) continue;
    const match = entry.match(/^[ MADRCUT?!]{2} (.+)$/) ?? entry.match(/^[MADRCUT?!] (.+)$/);
    const name = match ? match[1] : entry;
    if (!sharedSet.has(name)) names.push(name);
  }
  return names;
}

export async function push(folderPath: string, token: string | null, remoteUrl: string): Promise<{ ok: boolean; output: string }> {
  // The address is used as it is; the token (if any) travels separately, see
  // tokenCredentialArgs above, and only for github.com (see prepareRemote).
  const remote = prepareRemote(token, remoteUrl);
  if (remote.problem) return { ok: false, output: remote.problem };
  const result = await runGit("git-push", ["push", remote.target, "HEAD"], folderPath, remote.token);
  return remote.tokenHeldBack && !result.ok ? { ...result, output: result.output + TOKEN_HELD_BACK_NOTE } : result;
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
  const remote = prepareRemote(token, remoteUrl);
  if (remote.problem) return { ok: false, output: remote.problem };
  const target = remote.target;
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
    "git-pull",
    [...gitIdentityArgs(contributorName), "pull", "--no-rebase", "--allow-unrelated-histories", target, "HEAD"],
    folderPath,
    remote.token
  );

  if (!result.ok && EMPTY_REMOTE_PATTERN.test(result.output)) {
    return { ok: true, output: "Nothing to pull yet — the shared repository is empty." };
  }

  if (!result.ok && CONFLICT_PATTERN.test(result.output)) {
    await runGit("git-merge-abort", ["merge", "--abort"], folderPath);
    return {
      ok: false,
      output:
        `${result.output}\n\nThe automatic merge could not be completed, so it has been safely cancelled — ` +
        "nothing on your computer was changed. This usually means two collaborators are sharing the same name; " +
        "try giving yourself a more distinct one in App Settings, then Pull again.",
    };
  }
  return remote.tokenHeldBack && !result.ok ? { ...result, output: result.output + TOKEN_HELD_BACK_NOTE } : result;
}
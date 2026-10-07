// Why the "Create Project" button can't be clicked yet, in plain words — or
// null when everything needed is filled in. Checked in the same top-to-bottom
// order as the form, so the message always points at the first thing to fix.

export interface CreateProjectInputs {
  selectedGameId: string | null;
  effectiveTargetLanguage: string;
  // true = valid, false = no localisation files found, null = not chosen yet
  installPathValid: boolean | null;
  checkingPath: boolean;
  projectType: "vanilla" | "mod";
  sourceModName: string;
  // The language the game text is read from (a language code such as
  // "english" or "french"), and, when the chosen target is one of the game's
  // own languages, that language's code. Used to stop a project translating a
  // language into itself.
  sourceLanguage?: string;
  nativeTargetCode?: string | null;
}

export function createProjectBlocker(i: CreateProjectInputs): string | null {
  if (i.selectedGameId === null) return "Choose a game above.";
  if (i.effectiveTargetLanguage.length === 0) return "Type the name of the language you're translating into.";
  const source = (i.sourceLanguage ?? "").toLowerCase();
  if (source !== "" && (i.effectiveTargetLanguage.toLowerCase() === source || i.nativeTargetCode === source)) {
    return "The target language can't be the same as the source language - choose a different target.";
  }
  if (i.checkingPath) return "Still checking the folder — one moment.";
  if (i.installPathValid === null) {
    return i.projectType === "mod"
      ? "Click Browse… to choose the folder of the mod you're translating."
      : "Click Browse… to choose the game's install folder.";
  }
  if (i.installPathValid === false) {
    return "The folder you chose has no localisation files — click Browse… and pick a different one.";
  }
  if (i.projectType === "mod" && i.sourceModName.trim().length === 0) {
    return "Enter the name of the mod you're translating.";
  }
  return null;
}
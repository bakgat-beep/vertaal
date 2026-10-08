// True when the text in a translation box is not what is saved yet. Uses the
// exact same comparison the saving code uses (see saveDraft), so the
// "edited, not saved yet" marker appears if and only if a save would change
// something. A missing value counts as an empty box.
export function hasUnsavedEdit(boxText: string | undefined | null, savedText: string | undefined | null): boolean {
  return (boxText ?? "") !== (savedText ?? "");
}
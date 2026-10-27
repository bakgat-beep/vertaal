// The sentence that tells you what a merge of someone's shared file did. There
// are three places that merge a file (the project screen's Import, the Welcome
// screen's "Import into", and Collaboration's Pull + Merge); all three use this
// one wording, so none of them can leave out something you need to know - such
// as confirmed strings that were saved as flagged drafts.
export interface MergeCounts {
  applied: number;
  skippedLocalNewer: number;
  skippedKeptYourWork: number;
  skippedNoLocalString: number;
  flaggedForGameCodes: number;
  glossaryAdded: number;
  glossaryUpdated: number;
}

export function describeMerge(summary: MergeCounts): string {
  return (
    `${summary.applied} applied, ${summary.skippedLocalNewer} skipped (your version was newer), ` +
    `${summary.skippedKeptYourWork} skipped (an AI draft would have replaced your own work), ` +
    `${summary.skippedNoLocalString} skipped (string not found locally), ` +
    `${summary.glossaryAdded} glossary term(s) added, ${summary.glossaryUpdated} updated.` +
    (summary.flaggedForGameCodes > 0
      ? ` ${summary.flaggedForGameCodes} confirmed translation(s) had game codes that don't match the original, ` +
        "so they were saved as flagged drafts - see Flagged."
      : "")
  );
}
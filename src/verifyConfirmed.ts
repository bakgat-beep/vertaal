import { getDb } from "./db";
import type { Project } from "./types";
import { checkTokenIntegrity, type TokenIntegrityIssue } from "./tokenIntegrity";

export interface ConfirmedStringProblem {
  key: string;
  gameId: string;
  issues: TokenIntegrityIssue[];
}

export interface VerifyConfirmedResult {
  checked: number;
  problems: ConfirmedStringProblem[];
  // Of `problems`, how many were flagged BY THIS RUN (the rest already had
  // their flag set from an earlier verify or manual review).
  flaggedNow: number;
}

// Scans every confirmed string in the project for a protected code (a
// variable, an icon, a formatting code, a line break — see parser.ts) that
// appears a different number of times in the translation than in the source.
// Any string with a problem is flagged, so it drops out of the exported mod
// until reviewed. A string that is already flagged is still reported, just
// not counted in flaggedNow.
export async function verifyConfirmedStrings(project: Project): Promise<VerifyConfirmedResult> {
  const db = await getDb();
  const rows = (await db.select(
    `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
            t.translated_text as translated_text, t.flagged as flagged
     FROM strings s
     JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
     WHERE s.game_id = $1 AND t.target_language = $2 AND t.status = 'human-confirmed'
       AND t.translated_text IS NOT NULL AND t.translated_text != ''`,
    [project.game_id, project.target_language]
  )) as { key: string; game_id: string; source_text: string; translated_text: string; flagged: number }[];

  const problems: ConfirmedStringProblem[] = [];
  const toFlag: { key: string; gameId: string }[] = [];

  for (const row of rows) {
    const issues = checkTokenIntegrity(row.source_text, row.translated_text);
    if (issues.length === 0) continue;
    problems.push({ key: row.key, gameId: row.game_id, issues });
    if (!row.flagged) toFlag.push({ key: row.key, gameId: row.game_id });
  }

  for (const t of toFlag) {
    await db.execute(
      "UPDATE translations SET flagged = 1 WHERE string_key = $1 AND game_id = $2 AND target_language = $3",
      [t.key, t.gameId, project.target_language]
    );
  }

  return { checked: rows.length, problems, flaggedNow: toFlag.length };
}
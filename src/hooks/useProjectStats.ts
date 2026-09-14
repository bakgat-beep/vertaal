import { useState } from "react";
import type { Project } from "../types";
import { type CategoryCount } from "../App";
import { getDb } from "../db";

// Holds project-wide stats (statusCounts) and the sidebar category/subcategory
// tree (categories, expandedCategories), plus the functions that load and
// toggle them. loadCategories is exposed separately from refreshCounts
// because useEditorRows' loadPage needs to refresh just the category tree
// after every page load, without re-querying the full status counts too.
export function useProjectStats(currentProject: Project | null) {
  const [statusCounts, setStatusCounts] = useState({
    untranslated: 0,
    aiDraft: 0,
    confirmed: 0,
    total: 0,
    outdated: 0,
    issues: 0,
    flagged: 0,
  });

  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  async function loadCategories() {
    if (!currentProject) return;
    const db = await getDb();
    const rows = (await db.select(
      `SELECT s.category as category, s.subcategory as subcategory,
              COUNT(*) as total,
              SUM(CASE WHEN t.status IS NULL OR t.status = 'untranslated' THEN 1 ELSE 0 END) as untranslated
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
       WHERE s.category IS NOT NULL AND s.game_id = $2
       GROUP BY s.category, s.subcategory
       ORDER BY total DESC`,
      [currentProject.target_language, currentProject.game_id]
    )) as { category: string; subcategory: string | null; total: number; untranslated: number }[];

    const grouped: Record<string, CategoryCount> = {};
    for (const row of rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = { category: row.category, total: 0, untranslated: 0, subcategories: [] };
      }
      grouped[row.category].total += row.total;
      grouped[row.category].untranslated += row.untranslated;
      grouped[row.category].subcategories.push({
        subcategory: row.subcategory ?? "general",
        total: row.total,
        untranslated: row.untranslated,
      });
    }

    setCategories(Object.values(grouped).sort((a, b) => b.total - a.total));
  }

  function toggleCategoryExpanded(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function refreshCounts() {
    if (!currentProject) return;
    const db = await getDb();
    const result = (await db.select(
      `SELECT
         (SELECT COUNT(*) FROM strings WHERE game_id = $1) as total,
         (SELECT COUNT(*) FROM translations WHERE status = 'human-confirmed' AND game_id = $1 AND target_language = $2) as confirmed,
         (SELECT COUNT(*) FROM translations WHERE status = 'ai-suggested' AND game_id = $1 AND target_language = $2) as ai_draft,
         (SELECT COUNT(*) FROM translations t JOIN strings s ON t.string_key = s.key AND t.game_id = s.game_id
           WHERE t.game_id = $1 AND t.target_language = $2
           AND t.source_hash_at_translation IS NOT NULL AND t.source_hash_at_translation != s.source_text_hash) as outdated,
         (SELECT COUNT(*) FROM translations WHERE game_id = $1 AND target_language = $2
           AND status IN ('human-confirmed', 'ai-suggested', 'human-draft')
           AND (translated_text IS NULL OR TRIM(translated_text) = '')) as issues,
         (SELECT COUNT(*) FROM translations WHERE game_id = $1 AND target_language = $2 AND flagged = 1) as flagged`,
      [currentProject.game_id, currentProject.target_language]
    )) as { total: number; confirmed: number; ai_draft: number; outdated: number; issues: number; flagged: number }[];

    const r = result[0];
    setStatusCounts({
      total: r.total,
      confirmed: r.confirmed,
      aiDraft: r.ai_draft,
      untranslated: r.total - r.confirmed - r.ai_draft,
      outdated: r.outdated,
      issues: r.issues,
      flagged: r.flagged,
    });
    await loadCategories();
  }

  return {
    statusCounts,
    categories,
    expandedCategories,
    refreshCounts,
    loadCategories,
    toggleCategoryExpanded,
  };
}
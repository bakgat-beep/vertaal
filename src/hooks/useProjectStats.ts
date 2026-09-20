import { useState } from "react";
import type { Project } from "../types";
import { type CategoryCount } from "../App";
import { getDb } from "../db";
import { SQL_UNTRANSLATED, SQL_DRAFT, SQL_CONFIRMED, SQL_OUTDATED, SQL_ISSUES } from "../statusFilters";

// Holds project-wide stats (statusCounts) and the sidebar category/subcategory
// tree (categories, expandedCategories), plus the functions that load and
// toggle them. loadCategories is exposed separately from refreshCounts
// because useEditorRows' loadPage needs to refresh just the category tree
// after every page load, without re-querying the full status counts too.
export function useProjectStats(currentProject: Project | null) {
  const [statusCounts, setStatusCounts] = useState({
    untranslated: 0,
    drafts: 0,
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
              SUM(CASE WHEN ${SQL_UNTRANSLATED} THEN 1 ELSE 0 END) as untranslated
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

  // Every number here is counted from the strings themselves (joined to their
  // translation, if any) using the shared definitions in statusFilters.ts, so
  // each count always matches the list you get by clicking it.
  async function refreshCounts() {
    if (!currentProject) return;
    const db = await getDb();
    const result = (await db.select(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN ${SQL_UNTRANSLATED} THEN 1 ELSE 0 END), 0) AS untranslated,
         COALESCE(SUM(CASE WHEN ${SQL_DRAFT} THEN 1 ELSE 0 END), 0) AS drafts,
         COALESCE(SUM(CASE WHEN ${SQL_CONFIRMED} THEN 1 ELSE 0 END), 0) AS confirmed,
         COALESCE(SUM(CASE WHEN ${SQL_OUTDATED} THEN 1 ELSE 0 END), 0) AS outdated,
         COALESCE(SUM(CASE WHEN ${SQL_ISSUES} THEN 1 ELSE 0 END), 0) AS issues,
         COALESCE(SUM(CASE WHEN t.flagged = 1 THEN 1 ELSE 0 END), 0) AS flagged
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $2
       WHERE s.game_id = $1`,
      [currentProject.game_id, currentProject.target_language]
    )) as {
      total: number;
      untranslated: number;
      drafts: number;
      confirmed: number;
      outdated: number;
      issues: number;
      flagged: number;
    }[];

    setStatusCounts(result[0]);
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
import { useRef, useState } from "react";
import type { Project } from "../types";
import { type CategoryCount } from "../App";
import { getDb } from "../db";
import { SQL_UNTRANSLATED, SQL_DRAFT, SQL_CONFIRMED, SQL_OUTDATED, SQL_ISSUES, SQL_FLAGGED } from "../statusFilters";

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

  // Which project is open right now. A count that finishes loading after you
  // have switched to another project is thrown away instead of being shown.
  const openProjectIdRef = useRef<number | null>(null);
  openProjectIdRef.current = currentProject?.id ?? null;

  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  async function loadCategories() {
    if (!currentProject) return;
    const db = await getDb();
    // "left" counts everything not yet CONFIRMED — a draft (typed or
    // AI-suggested) still counts as left, since it hasn't been checked by a
    // person. (Before, this counted only fully-blank strings, so a category
    // full of unreviewed AI drafts read as "0 left" / 100% complete.)
    const rows = (await db.select(
      `SELECT s.category as category, s.subcategory as subcategory,
              COUNT(*) as total,
              SUM(CASE WHEN ${SQL_CONFIRMED} THEN 1 ELSE 0 END) as confirmed
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
       WHERE s.category IS NOT NULL AND s.removed_at IS NULL AND s.game_id = $2
       GROUP BY s.category, s.subcategory
       ORDER BY total DESC`,
      [currentProject.target_language, currentProject.game_id]
    )) as { category: string; subcategory: string | null; total: number; confirmed: number }[];

    const grouped: Record<string, CategoryCount> = {};
    for (const row of rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = { category: row.category, total: 0, left: 0, subcategories: [] };
      }
      const left = row.total - row.confirmed;
      grouped[row.category].total += row.total;
      grouped[row.category].left += left;
      grouped[row.category].subcategories.push({
        subcategory: row.subcategory ?? "general",
        total: row.total,
        left,
      });
    }

    if (currentProject.id !== openProjectIdRef.current) return;
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
  //
  // { statusOnly: true } refreshes just the numbers at the top of the sidebar
  // and skips the (slower) category tree.
  async function refreshCounts(options?: { statusOnly?: boolean }) {
    if (!currentProject) return;
    const db = await getDb();
    const result = (await db.select(
      `SELECT
         COALESCE(SUM(CASE WHEN s.removed_at IS NULL THEN 1 ELSE 0 END), 0) AS total,
         COALESCE(SUM(CASE WHEN ${SQL_UNTRANSLATED} THEN 1 ELSE 0 END), 0) AS untranslated,
         COALESCE(SUM(CASE WHEN ${SQL_DRAFT} THEN 1 ELSE 0 END), 0) AS drafts,
         COALESCE(SUM(CASE WHEN ${SQL_CONFIRMED} THEN 1 ELSE 0 END), 0) AS confirmed,
         COALESCE(SUM(CASE WHEN ${SQL_OUTDATED} THEN 1 ELSE 0 END), 0) AS outdated,
         COALESCE(SUM(CASE WHEN ${SQL_ISSUES} THEN 1 ELSE 0 END), 0) AS issues,
         COALESCE(SUM(CASE WHEN ${SQL_FLAGGED} THEN 1 ELSE 0 END), 0) AS flagged
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

    if (currentProject.id !== openProjectIdRef.current) return;
    setStatusCounts(result[0]);
    if (!options?.statusOnly) await loadCategories();
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
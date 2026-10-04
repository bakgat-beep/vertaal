// Glossary "Usage" column: how many strings contain each term.
//
// Counting is slow on a big game (about 4-5 seconds for one page of 50 terms
// on a ~225,000-string game), so two things matter:
//   1. Never count the same term twice while the Glossary is open. Saving,
//      deleting or flipping pages used to recount the whole page every time.
//      Counts are remembered in `cache`, keyed by game + term text.
//   2. Never let an old, slower run overwrite a newer page's numbers. Each
//      run asks `isStale()` before showing anything, so a run that has been
//      replaced by a newer one quietly stops updating the screen (it still
//      files its answers in the cache, since they are still correct).

export type UsageCache = Map<string, number>;

export function usageCacheKey(gameId: string, englishTerm: string): string {
  return `${gameId}\u0000${englishTerm}`;
}

export async function resolveUsageCounts(
  gameId: string,
  terms: { id: number; english_term: string }[],
  cache: UsageCache,
  countFn: (englishTerm: string) => Promise<number>,
  isStale: () => boolean,
  onProgress: (counts: Record<number, number>) => void
): Promise<void> {
  const counts: Record<number, number> = {};
  const missing: { id: number; english_term: string }[] = [];

  for (const t of terms) {
    const cached = cache.get(usageCacheKey(gameId, t.english_term));
    if (cached === undefined) missing.push(t);
    else counts[t.id] = cached;
  }
  onProgress({ ...counts });

  await Promise.all(
    missing.map(async (t) => {
      let n: number;
      try {
        n = await countFn(t.english_term);
      } catch {
        // One term failing to count shouldn't stop the rest; its cell just
        // keeps showing "…".
        return;
      }
      cache.set(usageCacheKey(gameId, t.english_term), n);
      if (isStale()) return;
      counts[t.id] = n;
      onProgress({ ...counts });
    })
  );
}
// For work that finishes later (a folder search, a lookup) and might finish
// AFTER the person has moved on to something else. Each time the work starts,
// call next() and keep the number it gives you; when the work finishes, only
// show its result if isCurrent(thatNumber) is still true. Anything that makes
// an earlier run out of date (picking another game, choosing a folder by hand)
// calls next() too, which cancels all runs started before it.
export function makeLatestGuard() {
  let latest = 0;
  return {
    next(): number {
      latest += 1;
      return latest;
    },
    isCurrent(run: number): boolean {
      return run === latest;
    },
  };
}
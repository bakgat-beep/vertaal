// A tiny "one at a time, in the order requested" queue for database writes.
//
// Why this exists: in the editor, clicking a button while a text box is focused
// makes the text box "blur" (which saves the draft) an instant BEFORE the click
// itself runs (which might confirm the row). Both are database writes that used
// to start independently, so in rare cases the confirm could finish first and
// then be overwritten by the older draft save (or the confirm could act on
// out-of-date text). Running every row write through this queue guarantees
// they finish in exactly the order they were requested.
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    // Runs `task` after every previously queued task has finished (whether
    // those succeeded or failed — one failed save must not block later ones).
    // Returns the task's own result, so callers can still `await` it.
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },

    // Resolves once everything queued so far has finished. Call this before
    // reading the database (e.g. loading a page) so you never read stale data.
    flush(): Promise<void> {
      return tail.then(() => undefined);
    },
  };
}
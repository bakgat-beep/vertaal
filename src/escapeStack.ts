// Which thing should the Escape key close? Whatever was opened LAST: a
// confirmation box asked from inside the Glossary panel closes first, and
// only a second press closes the panel itself. Each open dialog, panel or
// menu registers a handler here while it is open; pressing Escape runs only
// the most recently registered one.
type Handler = () => void;
const stack: Handler[] = [];

// Registers a handler and returns a function that removes it again.
export function pushEscapeHandler(handler: Handler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

// Runs the most recently registered handler, if any. Returns whether one ran
// (so the caller knows the key press was used).
export function dispatchEscape(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

let listenerInstalled = false;

// One listener for the whole app, installed the first time anything needs it.
export function ensureEscapeListener(): void {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dispatchEscape()) event.preventDefault();
  });
}
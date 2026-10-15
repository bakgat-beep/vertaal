// A button's handler that fails must tell the person, not just stop. An error
// that escapes an async click handler ends up only in a developer console, so
// the status bar keeps showing its last message and it looks like nothing
// happened. Wrapping a handler with reportErrors turns a failure into a
// message in the status bar.

// The readable part of whatever was thrown (an Error, plain text, ...).
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === undefined || err === null) return "unknown error";
  const text = String(err);
  return text === "" ? "unknown error" : text;
}

// Runs the action; if it throws, reports "<what> failed: <reason>" through
// setStatus instead of letting the error escape. Never throws itself.
export async function reportErrors(
  setStatus: (message: string) => void,
  what: string,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (err) {
    setStatus(`${what} failed: ${describeError(err)}`);
  }
}
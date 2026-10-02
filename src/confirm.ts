// A drop-in, dark-themed replacement for window.confirm(), so every
// confirmation in the app matches the rest of its styling instead of
// popping up a native white Windows dialog. Usage stays the same shape as
// before — `const proceed = await confirm("..."); if (!proceed) return;` —
// so call sites barely change; only the resulting UI does.
export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  // Shows the Confirm button in red — for something destructive (a delete),
  // not for an ordinary "are you sure" like exporting or overwriting a draft.
  destructive?: boolean;
}

export interface ConfirmRequest extends Required<ConfirmOptions> {
  message: string;
  resolve: (value: boolean) => void;
}

type Listener = (request: ConfirmRequest | null) => void;
let current: ConfirmRequest | null = null;
const listeners = new Set<Listener>();

export function subscribeConfirmRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentConfirmRequest(): ConfirmRequest | null {
  return current;
}

function setCurrent(request: ConfirmRequest | null) {
  current = request;
  for (const listener of listeners) listener(current);
}

export function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // Only one confirmation is ever shown at a time. A second call while one
    // is already open — which shouldn't normally happen — resolves the
    // earlier one as cancelled rather than leaving it to hang forever.
    if (current) current.resolve(false);
    setCurrent({
      message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      destructive: options.destructive ?? false,
      resolve: (value) => {
        setCurrent(null);
        resolve(value);
      },
    });
  });
}
import { useEffect, useState } from "react";
import { subscribeConfirmRequest, getCurrentConfirmRequest, type ConfirmRequest } from "./confirm";
import { useEscapeKey } from "./hooks/useEscapeKey";

// Renders whatever confirm() is currently waiting on, styled to match the
// rest of the app instead of a native popup. Mounted once, at the top level
// (see main.tsx), so it's available everywhere — including from plain
// non-component code like useBatchTranslation.ts.
export default function ConfirmDialogHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(getCurrentConfirmRequest());

  useEffect(() => subscribeConfirmRequest(setRequest), []);
  useEscapeKey(() => request?.resolve(false), request !== null);

  if (!request) return null;

  return (
    <div
      className="welcome-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) request.resolve(false); // clicking the backdrop cancels
      }}
    >
      <div className="welcome-window confirm-dialog-window" role="alertdialog" aria-modal="true">
        <p className="confirm-dialog-message">{request.message}</p>
        <div className="welcome-footer">
          {/* For a destructive action, Cancel gets the focus/default Enter
              behaviour, not Confirm — an accidental Enter press should never
              delete something. */}
          <button onClick={() => request.resolve(false)} autoFocus={request.destructive}>
            {request.cancelLabel}
          </button>
          <button
            className={request.destructive ? "build-mod-button confirm-dialog-destructive" : "build-mod-button"}
            onClick={() => request.resolve(true)}
            autoFocus={!request.destructive}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
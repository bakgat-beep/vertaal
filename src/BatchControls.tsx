// Two small pieces of the editor screen, kept in their own file so they can be
// tested on their own: the "Previous / Next" page buttons, and the progress
// counter with its Stop button that appears while a batch is running.
import { Icon } from "./Icon";

export function Pager({
  offset,
  rowCount,
  pageSize,
  onPrevious,
  onNext,
}: {
  offset: number;
  rowCount: number;
  pageSize: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pager">
      <button onClick={onPrevious} disabled={offset === 0}>
        <Icon name="arrowLeft" className="icon-before" />
        Previous {pageSize}
      </button>
      <span className="pager-range">
        {rowCount > 0 ? `Strings ${offset + 1}–${offset + rowCount}` : "No more strings here"}
      </span>
      <button onClick={onNext} disabled={rowCount < pageSize}>
        Next {pageSize}
        <Icon name="arrowRight" className="icon-after" />
      </button>
    </div>
  );
}

// Shown in the toolbar only while a batch (AI translation, confirming, ...) runs.
export function BatchProgress({
  running,
  done,
  total,
  onStop,
}: {
  running: boolean;
  done: number;
  total: number;
  onStop: () => void;
}) {
  if (!running) return null;
  return (
    <>
      <div className="toolbar-divider" />
      <span style={{ color: "var(--text-dim)" }}>
        {done}/{total}
      </span>
      <button onClick={onStop} title="Stop the batch operation currently running">
        Stop
      </button>
    </>
  );
}

import { diffWords, isWhitespaceOnlyChange, SOURCE_TEXT_UNKNOWN } from "./sourceChange";

interface Props {
  // The source text the translation was made against, and what the source says now.
  before: string;
  after: string;
}

// Shows exactly what changed in a string's source text since it was
// translated: the earlier wording with removed words marked, and the current
// wording with added words marked. Even a one-character change is visible.
export default function SourceDiff({ before, after }: Props) {
  if (before === SOURCE_TEXT_UNKNOWN) {
    return (
      <p className="source-diff-note">
        The earlier wording wasn't recorded (this string was already marked as changed before Vertaal began keeping
        it), so what changed can't be shown. Re-check it against the current text, then confirm it to clear this
        warning.
      </p>
    );
  }

  const parts = diffWords(before, after);
  return (
    <div className="source-diff">
      {isWhitespaceOnlyChange(before, after) && (
        <p className="source-diff-note">Only spacing or line breaks changed (shown highlighted below).</p>
      )}
      <div className="source-diff-label">When you translated it</div>
      <div className="source-diff-text">
        {parts
          .filter((p) => p.kind !== "added")
          .map((p, i) => (
            <span key={i} className={p.kind === "removed" ? "diff-removed" : undefined}>
              {p.text}
            </span>
          ))}
      </div>
      <div className="source-diff-label">Now</div>
      <div className="source-diff-text">
        {parts
          .filter((p) => p.kind !== "removed")
          .map((p, i) => (
            <span key={i} className={p.kind === "added" ? "diff-added" : undefined}>
              {p.text}
            </span>
          ))}
      </div>
    </div>
  );
}
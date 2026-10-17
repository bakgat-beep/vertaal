// A short status message that starts with a drawn icon instead of a text
// symbol. The messages are still written as plain strings that begin with
// "✓ " (done), "✗ " (failed) or "⚠ " (careful); this picks that mark off the
// front and draws the matching icon, so Windows never substitutes its own
// coloured picture for the character.
import { Icon, type IconName } from "./Icon";

const MARKS: Record<string, IconName> = { "✓": "check", "✗": "cross", "⚠": "warning" };

export function splitStatusMark(text: string): { icon: IconName | null; text: string } {
  const icon = MARKS[text.charAt(0)];
  if (!icon) return { icon: null, text };
  return { icon, text: text.slice(1).replace(/^ +/, "") };
}

export function StatusText({ text }: { text: string }) {
  const { icon, text: rest } = splitStatusMark(text);
  return (
    <>
      {icon && <Icon name={icon} className="icon-before" />}
      {rest}
    </>
  );
}

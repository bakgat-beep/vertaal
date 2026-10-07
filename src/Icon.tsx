// Small line icons drawn as SVG, so they look the same on every computer.
// (Emoji and symbol characters are drawn by Windows with its own colour
// pictures, which clash with the rest of the app and change between versions.)
// Each icon takes its colour from the surrounding text, so a warning inside an
// amber message is amber, with no extra styling.
import type { CSSProperties, ReactElement } from "react";

export type IconName = "warning" | "flag" | "check" | "cross" | "pencil" | "ban" | "chevron" | "dot";

const PATHS: Record<IconName, ReactElement> = {
  warning: (
    <>
      <path d="M8 1.8 15 14H1z" />
      <path d="M8 6.2v4" />
      <path d="M8 12.2v.1" />
    </>
  ),
  flag: (
    <>
      <path d="M3.5 14.5V2" />
      <path d="M3.5 2.5h8.5l-2 3.2 2 3.2H3.5" />
    </>
  ),
  check: <path d="m3 8.5 3.2 3.2L13 4.5" />,
  cross: <path d="m4 4 8 8M12 4l-8 8" />,
  pencil: (
    <>
      <path d="m10.5 3 2.5 2.5L5.5 13H3v-2.5z" />
      <path d="m9 4.5 2.5 2.5" />
    </>
  ),
  ban: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m3.8 12.2 8.4-8.4" />
    </>
  ),
  chevron: <path d="m6 3.5 4.5 4.5L6 12.5" />,
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
};

export function Icon({
  name,
  size = 14,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}
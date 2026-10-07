// Two small checks on what a translation provider sends back.

// A game string may start or end with spaces or tabs that matter ("Gold: ",
// "  - "). Providers tend to drop them (and chat models add stray line breaks
// at the ends), so the reply is tidied at both ends and the SOURCE's own
// leading and trailing spaces/tabs are put back.
export function restoreOuterSpacing(source: string, translated: string): string {
  const lead = source.match(/^[ \t]*/)![0];
  const trail = source.match(/[ \t]*$/)![0];
  const core = translated.trim();
  if (core === "") return translated.trim();
  return `${lead}${core}${trail}`;
}

// AI chat models sometimes answer with more than the translation: "Here is the
// translation:", a code block, the whole reply wrapped in quotes, or several
// lines for a one-line string. Placed into a game file, that chatter becomes
// game text. Returns a plain-words reason when a reply looks like that, or null
// when it looks like just a translation. Deliberately cautious: it only objects
// to patterns that essentially never belong in a translated game string. A
// string the AI "chatted" about is retried, and flagged for a person if it keeps
// happening.
const PREAMBLE =
  /^\s*(here is|here's|here are|sure[,.! ]|certainly[,.! ]|of course[,.! ]|okay[,.! ]|translation\s*:|the translation|translated text\s*:|i have translated|as an ai|i'm sorry|i cannot|i can't)/i;

export function describeChattyReply(source: string, reply: string): string | null {
  const text = reply.trim();
  if (text.includes("```") && !source.includes("```")) {
    return "the AI wrapped its answer in a code block";
  }
  if (PREAMBLE.test(text) && !PREAMBLE.test(source)) {
    return "the AI added an introduction or an explanation instead of just the translation";
  }
  if (/[\r\n]/.test(text) && !/[\r\n]/.test(source.trim())) {
    return "the AI returned several lines for a one-line string";
  }
  const quoted = /^(["“„«].*["”»])$/s.test(text);
  const sourceQuoted = /^\s*(["“„«].*["”»])\s*$/s.test(source);
  if (quoted && !sourceQuoted) {
    return "the AI put the whole translation inside quotation marks";
  }
  return null;
}
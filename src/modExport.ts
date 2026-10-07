// Makes a piece of text safe to put between the quotes of a value in a
// descriptor.mod / .mod file. A backslash and a double quote must be escaped,
// and a line break would end the line early, so it becomes a space. Without
// this, a mod name such as  My "Best" Mod  produced a broken file that the
// game's launcher could not read.
export function escapeDescriptorString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\t]+/g, " ");
}

export function buildCompanionDescriptor(outputModName: string, sourceModName: string): string {
  const escapedOutput = escapeDescriptorString(outputModName);
  const escapedSource = escapeDescriptorString(sourceModName);
  return (
    `version="0.1.0"\n` +
    `tags={\n\t"Translation"\n}\n` +
    `name="${escapedOutput}"\n` +
    `dependencies={\n\t"${escapedSource}"\n}\n`
  );
}
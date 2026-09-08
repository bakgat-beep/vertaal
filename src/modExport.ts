export function buildCompanionDescriptor(outputModName: string, sourceModName: string): string {
  const escapedOutput = outputModName.replace(/"/g, '\\"');
  const escapedSource = sourceModName.replace(/"/g, '\\"');
  return (
    `version="0.1.0"\n` +
    `tags={\n\t"Translation"\n}\n` +
    `name="${escapedOutput}"\n` +
    `dependencies={\n\t"${escapedSource}"\n}\n`
  );
}
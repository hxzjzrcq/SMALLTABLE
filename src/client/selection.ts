export function selectTokens(
  current: readonly string[],
  id: string | null,
  additive = false,
): string[] {
  if (id === null) return additive ? [...current] : [];
  if (!additive) return [id];
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

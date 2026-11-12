/** The text on a multi-select button: "All clients", the one name, or "{n} clients". */
export function selectionSummary(names: string[], noun: { all: string; plural: string }): string {
  if (names.length === 0) return noun.all
  if (names.length === 1) return names[0]
  return `${names.length} ${noun.plural}`
}

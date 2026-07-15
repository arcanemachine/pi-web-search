import type { DocumentSnapshot } from "./types.js";

export interface DocumentPage {
  content: string;
  start: number;
  end: number;
  total: number;
}

export function readSnapshotPage(
  snapshot: DocumentSnapshot,
  start: number,
  maxChars: number,
): DocumentPage {
  const characters = [...snapshot.content];
  const safeStart = Math.min(Math.max(0, start), characters.length);
  let end = Math.min(characters.length, safeStart + maxChars);

  if (end < characters.length && maxChars >= 20) {
    const minimumBoundary = safeStart + Math.floor(maxChars * 0.6);
    const candidate = characters.slice(safeStart, end);
    let paragraph = -1;
    let line = -1;
    for (let index = candidate.length - 1; index >= 0; index -= 1) {
      if (candidate[index] !== "\n") continue;
      if (line < 0) line = index + 1;
      if (index > 0 && candidate[index - 1] === "\n") {
        paragraph = index + 1;
        break;
      }
    }
    const preferred = paragraph >= 0 ? paragraph : line;
    if (preferred >= minimumBoundary - safeStart) end = safeStart + preferred;
  }

  return {
    content: characters.slice(safeStart, end).join(""),
    start: safeStart,
    end,
    total: characters.length,
  };
}

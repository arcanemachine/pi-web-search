import type { GrepMatch } from "../contracts.js";
import type { DocumentLine, DocumentSnapshot } from "./types.js";

interface MatchPosition {
  ordinal: number;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

interface MatchWindow {
  startLine: number;
  endLine: number;
  matches: MatchPosition[];
}

export interface MatchPage {
  matches: GrepMatch[];
  totalMatches: number;
  consumedMatches: number;
  truncated: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineIndexAt(lines: DocumentLine[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].startOffset <= offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function lineIndexAtCharacter(lines: DocumentLine[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].startCharacter <= offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function characterOffset(snapshot: DocumentSnapshot, offset: number): number {
  const line = snapshot.lines[lineIndexAt(snapshot.lines, offset)];
  return (
    line.startCharacter +
    [...snapshot.content.slice(line.startOffset, offset)].length
  );
}

function selectedMatches(
  snapshot: DocumentSnapshot,
  query: string,
  caseSensitive: boolean,
  startOrdinal: number,
  maxMatches: number,
): { selected: MatchPosition[]; total: number } {
  const expression = new RegExp(
    escapeRegExp(query),
    caseSensitive ? "gu" : "giu",
  );
  const selected: MatchPosition[] = [];
  let total = 0;
  for (const match of snapshot.content.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    if (total >= startOrdinal && selected.length < maxMatches) {
      selected.push({
        ordinal: total,
        start,
        end,
        startLine: lineIndexAt(snapshot.lines, start),
        endLine: lineIndexAt(snapshot.lines, Math.max(start, end - 1)),
      });
    }
    total += 1;
  }
  return { selected, total };
}

function mergeWindows(
  selected: MatchPosition[],
  beforeLines: number,
  afterLines: number,
  lineCount: number,
): MatchWindow[] {
  const windows: MatchWindow[] = [];
  for (const match of selected) {
    const startLine = Math.max(0, match.startLine - beforeLines);
    const endLine = Math.min(lineCount - 1, match.endLine + afterLines);
    const previous = windows.at(-1);
    if (previous && startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, endLine);
      previous.matches.push(match);
    } else {
      windows.push({ startLine, endLine, matches: [match] });
    }
  }
  return windows;
}

export function matchSnapshot(
  snapshot: DocumentSnapshot,
  query: string,
  caseSensitive: boolean,
  beforeLines: number,
  afterLines: number,
  startOrdinal: number,
  maxMatches: number,
  maxChars: number,
): MatchPage {
  const found = selectedMatches(
    snapshot,
    query,
    caseSensitive,
    startOrdinal,
    maxMatches,
  );
  const windows = mergeWindows(
    found.selected,
    beforeLines,
    afterLines,
    snapshot.lines.length,
  );
  const contentCharacters = [...snapshot.content];
  const records: GrepMatch[] = [];
  let remainingChars = maxChars;
  let consumedMatches = 0;
  let truncated = false;
  const queryCharacters = [...query].length;

  for (const window of windows) {
    if (remainingChars < queryCharacters) break;
    const firstLine = snapshot.lines[window.startLine];
    const lastLine = snapshot.lines[window.endLine];
    const rawStart = firstLine.startCharacter;
    const rawEnd = lastLine.endCharacter;
    const rawLength = rawEnd - rawStart;
    const firstMatchStart = characterOffset(snapshot, window.matches[0].start);
    const quoteLength = Math.min(rawLength, remainingChars);
    if (quoteLength < rawLength) truncated = true;
    const includedMatches = [] as MatchPosition[];
    let lastMatchEnd = firstMatchStart;
    for (const match of window.matches) {
      const candidateEnd = characterOffset(snapshot, match.end);
      if (
        includedMatches.length > 0 &&
        candidateEnd - firstMatchStart > quoteLength
      ) {
        break;
      }
      includedMatches.push(match);
      lastMatchEnd = candidateEnd;
    }
    if (includedMatches.length === 0) break;
    let quoteStart = rawStart;
    if (rawLength > quoteLength) {
      const focusLength = Math.max(0, lastMatchEnd - firstMatchStart);
      const leading = Math.max(0, Math.floor((quoteLength - focusLength) / 2));
      quoteStart = Math.max(rawStart, firstMatchStart - leading);
      quoteStart = Math.min(quoteStart, rawEnd - quoteLength);
    }
    const quoteEnd = quoteStart + quoteLength;
    const quoteStartLine = lineIndexAtCharacter(snapshot.lines, quoteStart);
    const quoteEndLine = (() => {
      for (let index = window.endLine; index >= window.startLine; index -= 1) {
        if (snapshot.lines[index].startCharacter < quoteEnd) return index;
      }
      return window.startLine;
    })();
    const firstMatch = includedMatches[0];
    const lastMatch = includedMatches.at(-1) ?? firstMatch;
    records.push({
      line: snapshot.lines[quoteStartLine].number,
      endLine: snapshot.lines[quoteEndLine].number,
      startOffset: characterOffset(snapshot, firstMatch.start),
      endOffset: characterOffset(snapshot, lastMatch.end),
      quoteStartOffset: quoteStart,
      quoteEndOffset: quoteEnd,
      quote: contentCharacters.slice(quoteStart, quoteEnd).join(""),
      matchCount: includedMatches.length,
      ...(snapshot.lines[firstMatch.startLine].heading
        ? { heading: snapshot.lines[firstMatch.startLine].heading }
        : {}),
    });
    remainingChars -= quoteLength;
    consumedMatches += includedMatches.length;
    if (includedMatches.length < window.matches.length) break;
  }

  return {
    matches: records,
    totalMatches: found.total,
    consumedMatches,
    truncated,
  };
}

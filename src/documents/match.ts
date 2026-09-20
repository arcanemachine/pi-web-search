import type { FindTextMatch } from "../contracts.js";
import type { DocumentLine, DocumentSnapshot } from "./types.js";

interface MatchPosition {
  startCharacter: number;
  endCharacter: number;
  startLine: number;
  endLine: number;
}

interface MatchWindow {
  startLine: number;
  endLine: number;
  matches: MatchPosition[];
}

export interface MatchPage {
  matches: FindTextMatch[];
  totalMatches: number;
  consumedMatches: number;
  nextOffset?: number;
  truncated: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineIndexAtCodeUnit(lines: DocumentLine[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].startCodeUnit <= offset) {
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

function characterOffset(
  snapshot: DocumentSnapshot,
  codeUnitOffset: number,
): number {
  const line =
    snapshot.lines[lineIndexAtCodeUnit(snapshot.lines, codeUnitOffset)];
  return (
    line.startCharacter +
    [...snapshot.content.slice(line.startCodeUnit, codeUnitOffset)].length
  );
}

function selectedMatches(
  snapshot: DocumentSnapshot,
  query: string,
  caseSensitive: boolean,
  startOffset: number,
  maxMatches: number,
): { selected: MatchPosition[]; total: number; nextOffset?: number } {
  const expression = new RegExp(
    escapeRegExp(query),
    caseSensitive ? "gu" : "giu",
  );
  const selected: MatchPosition[] = [];
  let total = 0;
  let nextOffset: number | undefined;
  for (const match of snapshot.content.matchAll(expression)) {
    const startCodeUnit = match.index;
    const endCodeUnit = startCodeUnit + match[0].length;
    const startCharacter = characterOffset(snapshot, startCodeUnit);
    const endCharacter = characterOffset(snapshot, endCodeUnit);
    if (startCharacter < startOffset) continue;
    if (selected.length < maxMatches) {
      selected.push({
        startCharacter,
        endCharacter,
        startLine: lineIndexAtCodeUnit(snapshot.lines, startCodeUnit),
        endLine: lineIndexAtCodeUnit(
          snapshot.lines,
          Math.max(startCodeUnit, endCodeUnit - 1),
        ),
      });
    } else if (nextOffset === undefined) {
      nextOffset = startCharacter;
    }
    total += 1;
  }
  return { selected, total, nextOffset };
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
  startOffset: number,
  maxMatches: number,
  maxChars: number,
): MatchPage {
  const found = selectedMatches(
    snapshot,
    query,
    caseSensitive,
    startOffset,
    maxMatches,
  );
  const windows = mergeWindows(
    found.selected,
    beforeLines,
    afterLines,
    snapshot.lines.length,
  );
  const contentCharacters = [...snapshot.content];
  const records: FindTextMatch[] = [];
  let remainingChars = maxChars;
  let consumedMatches = 0;
  let nextOffset = found.nextOffset;
  const noteNextOffset = (candidate: number): void => {
    if (nextOffset === undefined || candidate < nextOffset)
      nextOffset = candidate;
  };
  let truncated = found.nextOffset !== undefined;
  const queryCharacters = [...query].length;

  for (const window of windows) {
    if (remainingChars < queryCharacters) {
      noteNextOffset(window.matches[0].startCharacter);
      truncated = true;
      break;
    }
    const firstLine = snapshot.lines[window.startLine];
    const lastLine = snapshot.lines[window.endLine];
    const rawStart = firstLine.startCharacter;
    const rawEnd = lastLine.endCharacter;
    const rawLength = rawEnd - rawStart;
    const firstMatchStart = window.matches[0].startCharacter;
    const quoteLength = Math.min(rawLength, remainingChars);
    if (quoteLength < rawLength) truncated = true;
    const includedMatches: MatchPosition[] = [];
    let lastMatchEnd = firstMatchStart;
    for (const match of window.matches) {
      if (
        includedMatches.length > 0 &&
        match.endCharacter - firstMatchStart > quoteLength
      ) {
        break;
      }
      includedMatches.push(match);
      lastMatchEnd = match.endCharacter;
    }
    if (includedMatches.length === 0) {
      noteNextOffset(window.matches[0].startCharacter);
      truncated = true;
      break;
    }
    if (includedMatches.length < window.matches.length) {
      noteNextOffset(window.matches[includedMatches.length].startCharacter);
      truncated = true;
    }
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
      startOffset: firstMatch.startCharacter,
      endOffset: lastMatch.endCharacter,
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
  }

  return {
    matches: records,
    totalMatches: found.total,
    consumedMatches,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    truncated: truncated || consumedMatches < found.total,
  };
}

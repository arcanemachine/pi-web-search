import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiWebSearchConfig } from "../config.js";
import { CursorService } from "../documents/cursor.js";
import { DocumentService } from "../documents/service.js";
import type { DocumentToolRuntime } from "./document-shared.js";
import { registerFindTextInUrlContentTool } from "./find-text-in-url-content.js";
import { registerReadUrlContentTool } from "./read-url-content.js";
import { registerSummarizeUrlContentTool } from "./summarize-url-content.js";

export interface DocumentToolDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
  cursorSecret?: Uint8Array;
}

export interface DocumentToolsController {
  register(): void;
  synchronizeActivation(): void;
}

const SUMMARIZER_TOOL_NAME = "summarize_url_content";

function synchronizeSummarizerActivation(
  pi: ExtensionAPI,
  enabled: boolean,
): void {
  const active = pi.getActiveTools();
  const next = enabled
    ? active.filter(
        (name, index) =>
          name !== SUMMARIZER_TOOL_NAME ||
          active.indexOf(SUMMARIZER_TOOL_NAME) === index,
      )
    : active.filter((name) => name !== SUMMARIZER_TOOL_NAME);
  if (enabled && !next.includes(SUMMARIZER_TOOL_NAME)) {
    next.push(SUMMARIZER_TOOL_NAME);
  }
  if (
    next.length !== active.length ||
    next.some((name, index) => name !== active[index])
  ) {
    pi.setActiveTools(next);
  }
}

export function createDocumentToolsController(
  pi: ExtensionAPI,
  getConfig: () => PiWebSearchConfig,
  dependencies: DocumentToolDependencies = {
    fetch: globalThis.fetch,
    now: Date.now,
  },
): DocumentToolsController {
  let runtimeConfig: PiWebSearchConfig | undefined;
  let runtime: DocumentToolRuntime | undefined;

  function getRuntime(): DocumentToolRuntime {
    const config = getConfig();
    if (!runtime || runtimeConfig !== config) {
      runtimeConfig = config;
      runtime = {
        config,
        service: new DocumentService(config, {
          fetch: dependencies.fetch,
          now: dependencies.now,
        }),
        cursors: new CursorService(dependencies.cursorSecret),
      };
    }
    return runtime;
  }

  return {
    register() {
      getRuntime();
      registerReadUrlContentTool(pi, getRuntime);
      registerFindTextInUrlContentTool(pi, getRuntime);
      registerSummarizeUrlContentTool(pi, getRuntime);
    },
    synchronizeActivation() {
      synchronizeSummarizerActivation(
        pi,
        getRuntime().config.summarizationEnabled,
      );
    },
  };
}

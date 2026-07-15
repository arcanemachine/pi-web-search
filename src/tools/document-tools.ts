import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiWebSearchConfig } from "../config.js";
import { CursorService } from "../documents/cursor.js";
import { DocumentService } from "../documents/service.js";
import type { DocumentToolRuntime } from "./document-shared.js";
import { registerGrepUrlContentTool } from "./grep-url-content.js";
import { registerReadUrlContentTool } from "./read-url-content.js";

export interface DocumentToolDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
  cursorSecret?: Uint8Array;
}

export interface DocumentToolsController {
  register(): void;
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
      registerGrepUrlContentTool(pi, getRuntime);
    },
  };
}

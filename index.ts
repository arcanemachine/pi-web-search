import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createConfigStore } from "./src/config.js";
import { createDocumentToolsController } from "./src/tools/document-tools.js";
import { createSearchToolController } from "./src/tools/search-web.js";

export default function piWebSearchExtension(pi: ExtensionAPI): void {
  const config = createConfigStore();
  const documentTools = createDocumentToolsController(pi, () => config.get());
  const searchTool = createSearchToolController(pi, () => config.get());
  documentTools.register();
  searchTool.register();

  pi.on("session_start", (_event, ctx) => {
    config.refresh(ctx.cwd, true);
    documentTools.register();
    searchTool.register();
    documentTools.synchronizeActivation();
  });
}

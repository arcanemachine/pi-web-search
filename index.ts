import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createConfigStore } from "./src/config.js";
import { registerExistingGrepTool } from "./src/tools/existing-tools.js";
import { createSearchToolController } from "./src/tools/search-web.js";

export default function piWebSearchExtension(pi: ExtensionAPI): void {
  const config = createConfigStore();
  registerExistingGrepTool(pi, () => config.get());
  const searchTool = createSearchToolController(pi, () => config.get());
  searchTool.register();

  pi.on("session_start", (_event, ctx) => {
    config.refresh(ctx.cwd, true);
    searchTool.register();
  });
}

import type {
  OutcomeEnvelope,
  SearchBackendName,
  SearchOutcomeData,
  SearchRequest,
} from "../contracts.js";

export interface SearchBackendContext {
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface SearchBackend {
  readonly name: SearchBackendName;
  search(
    request: SearchRequest,
    context: SearchBackendContext,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>>;
}

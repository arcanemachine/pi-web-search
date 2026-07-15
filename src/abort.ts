export interface AbortScope {
  signal: AbortSignal;
  cleanup(): void;
}

export function createAbortScope(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): AbortScope {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });

  const timer = setTimeout(
    () =>
      controller.abort(new Error(`Operation timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  timer.unref?.();

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

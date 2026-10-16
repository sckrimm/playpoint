export interface TestnetEvidence {
  observedMs: number;
  lastObservedMs: number;
  workerId: string;
  restarts: number;
  gapRecoveries: number;
  completedCycles: number;
}

export const emptyTestnetEvidence = (): TestnetEvidence => ({
  observedMs: 0, lastObservedMs: 0, workerId: "", restarts: 0, gapRecoveries: 0, completedCycles: 0,
});

export function nextTestnetEvidence(previous: TestnetEvidence, now: number, workerId: string): TestnetEvidence {
  if (!Number.isFinite(now) || now <= previous.lastObservedMs || !workerId) return previous;
  const elapsed = now - previous.lastObservedMs;
  const sameWorker = workerId === previous.workerId;
  const continuous = previous.lastObservedMs > 0 && sameWorker && elapsed <= 30_000;
  return { ...previous,
    observedMs: previous.observedMs + (continuous ? elapsed : 0),
    lastObservedMs: now, workerId,
    restarts: previous.restarts + (previous.workerId && !sameWorker ? 1 : 0),
    gapRecoveries: previous.gapRecoveries + (previous.lastObservedMs > 0 && sameWorker && elapsed > 30_000 ? 1 : 0),
  };
}

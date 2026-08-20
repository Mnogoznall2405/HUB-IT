const metrics = {
  started: 0,
  overlap: 0,
  cooldownSkip: 0,
};

export function recordMailRefreshStarted() {
  metrics.started += 1;
}

export function recordMailRefreshOverlap() {
  metrics.overlap += 1;
}

export function recordMailRefreshCooldownSkip() {
  metrics.cooldownSkip += 1;
}

export function getMailRefreshMetrics() {
  return {
    started: metrics.started,
    overlap: metrics.overlap,
    cooldownSkip: metrics.cooldownSkip,
  };
}

export function resetMailRefreshMetrics() {
  metrics.started = 0;
  metrics.overlap = 0;
  metrics.cooldownSkip = 0;
}

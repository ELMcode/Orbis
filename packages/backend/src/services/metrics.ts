/** Minimal Prometheus-compatible process metrics with no external runtime. */
const requests = new Map<string, number>();
const durations = new Map<string, { count: number; sumSeconds: number }>();

function key(method: string, statusCode: number) {
  return `${method}:${statusCode}`;
}

export function observeRequest(method: string, statusCode: number, durationMs: number) {
  const metricKey = key(method, statusCode);
  requests.set(metricKey, (requests.get(metricKey) ?? 0) + 1);
  const duration = durations.get(metricKey) ?? { count: 0, sumSeconds: 0 };
  duration.count += 1;
  duration.sumSeconds += Math.max(0, durationMs) / 1000;
  durations.set(metricKey, duration);
}

export function renderHttpMetrics(): string[] {
  const lines = [
    '# HELP orbis_http_requests_total HTTP requests completed by method and status.',
    '# TYPE orbis_http_requests_total counter',
  ];
  for (const [metricKey, count] of requests) {
    const [method, status] = metricKey.split(':');
    lines.push(`orbis_http_requests_total{method="${method}",status="${status}"} ${count}`);
  }
  lines.push(
    '# HELP orbis_http_request_duration_seconds HTTP request duration by method and status.',
    '# TYPE orbis_http_request_duration_seconds summary',
  );
  for (const [metricKey, duration] of durations) {
    const [method, status] = metricKey.split(':');
    const labels = `method="${method}",status="${status}"`;
    lines.push(`orbis_http_request_duration_seconds_sum{${labels}} ${duration.sumSeconds.toFixed(6)}`);
    lines.push(`orbis_http_request_duration_seconds_count{${labels}} ${duration.count}`);
  }
  return lines;
}

import type { TestContext } from 'node:test';
export function captureLogs(t: TestContext) {
  const lines: string[] = [];
  for (const method of ['log', 'error'] as const)
    t.mock.method(console, method, (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
  return {
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    events: () => lines.map((line) => JSON.parse(line).event as string),
  };
}

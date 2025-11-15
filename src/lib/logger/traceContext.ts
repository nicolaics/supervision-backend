import { AsyncLocalStorage } from 'node:async_hooks';
import { ulid } from 'ulid';

interface TraceContext {
  traceId: string;
  startTime: number;
}

const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Generate a new trace ID using ULID
 */
export function generateTraceId(): string {
  return ulid();
}

/**
 * Get the current trace ID from context
 */
export function getTraceId(): string | undefined {
  const context = asyncLocalStorage.getStore();
  return context?.traceId;
}

/**
 * Run a function within a trace context
 */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  const context: TraceContext = {
    traceId,
    startTime: Date.now(),
  };
  return asyncLocalStorage.run(context, fn);
}

/**
 * Run an async function within a trace context
 */
export async function runWithTraceAsync<T>(
  traceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const context: TraceContext = {
    traceId,
    startTime: Date.now(),
  };
  return asyncLocalStorage.run(context, fn);
}

/**
 * Get the trace context
 */
export function getTraceContext(): TraceContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the elapsed time since trace started
 */
export function getElapsedTime(): number | undefined {
  const context = asyncLocalStorage.getStore();
  if (!context) return undefined;
  return Date.now() - context.startTime;
}


import { Repository, EntityTarget } from 'typeorm';
import { logger } from './logger';
import { getTraceId } from './traceContext';
import { maskSensitiveFields } from './sensitiveFields';

/**
 * Log query result with masking
 */
export function logQueryResult<T>(
  operation: string,
  result: T,
  executionTime?: number
): void {
  const traceId = getTraceId();
  const maskedResult = maskQueryResult(result);

  logger.debug('Database Query Result', {
    traceId,
    operation,
    resultCount: Array.isArray(result) ? result.length : result ? 1 : 0,
    executionTime: executionTime ? `${executionTime}ms` : undefined,
    result: maskedResult,
  });
}

/**
 * Mask sensitive data in query results
 */
function maskQueryResult<T>(result: T): unknown {
  if (!result) return result;

  if (Array.isArray(result)) {
    // For arrays, mask each item but limit the size for logging
    const masked = result.slice(0, 10).map((item) =>
      typeof item === 'object' && item !== null
        ? maskSensitiveFields(item as Record<string, unknown>)
        : item
    );

    if (result.length > 10) {
      return {
        items: masked,
        totalCount: result.length,
        note: 'Only first 10 items shown',
      };
    }

    return masked;
  }

  if (typeof result === 'object') {
    return maskSensitiveFields(result as Record<string, unknown>);
  }

  return result;
}

/**
 * Wrap a repository operation with logging
 */
export async function withQueryLogging<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const executionTime = Date.now() - startTime;
    logQueryResult(operation, result, executionTime);
    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const traceId = getTraceId();
    
    logger.error('Database Query Error', error instanceof Error ? error : new Error(String(error)), {
      traceId,
      operation,
      executionTime: `${executionTime}ms`,
    });
    throw error;
  }
}

/**
 * Create a logged repository wrapper
 */
export function createLoggedRepository<T>(
  repository: Repository<T>
): Repository<T> & {
  findWithLogging: typeof repository.find;
  findOneWithLogging: typeof repository.findOne;
  saveWithLogging: typeof repository.save;
} {
  return {
    ...repository,
    async findWithLogging(...args: Parameters<typeof repository.find>) {
      return withQueryLogging('find', () => repository.find(...args));
    },
    async findOneWithLogging(...args: Parameters<typeof repository.findOne>) {
      return withQueryLogging('findOne', () => repository.findOne(...args));
    },
    async saveWithLogging(...args: Parameters<typeof repository.save>) {
      return withQueryLogging('save', () => repository.save(...args));
    },
  } as Repository<T> & {
    findWithLogging: typeof repository.find;
    findOneWithLogging: typeof repository.findOne;
    saveWithLogging: typeof repository.save;
  };
}


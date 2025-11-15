import { Logger as TypeORMLogger, LogLevel as TypeORMLogLevel } from 'typeorm';
import { logger } from './logger';
import { getTraceId } from './traceContext';
import { maskSensitiveFields } from './sensitiveFields';

/**
 * Custom TypeORM logger that logs all queries and results
 * with trace ID support and sensitive field masking
 */
export class CustomTypeORMLogger implements TypeORMLogger {
  private logQueries: boolean;
  private logResults: boolean;
  private logErrors: boolean;

  constructor(
    options: {
      logQueries?: boolean;
      logResults?: boolean;
      logErrors?: boolean;
    } = {}
  ) {
    this.logQueries = options.logQueries ?? true;
    this.logResults = options.logResults ?? true;
    this.logErrors = options.logErrors ?? true;
  }

  logQuery(query: string, parameters?: unknown[]): void {
    if (!this.logQueries) return;

    const traceId = getTraceId();
    const maskedParams = parameters
      ? maskSensitiveFields({ parameters } as Record<string, unknown>)
      : undefined;

    logger.debug('Database Query', {
      traceId,
      query: this.sanitizeQuery(query),
      parameters: maskedParams,
    });
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[]
  ): void {
    if (!this.logErrors) return;

    const traceId = getTraceId();
    const errorObj = error instanceof Error ? error : new Error(error);
    const maskedParams = parameters
      ? maskSensitiveFields({ parameters } as Record<string, unknown>)
      : undefined;

    logger.error('Database Query Error', errorObj, {
      traceId,
      query: this.sanitizeQuery(query),
      parameters: maskedParams,
    });
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]): void {
    const traceId = getTraceId();
    const maskedParams = parameters
      ? maskSensitiveFields({ parameters } as Record<string, unknown>)
      : undefined;

    logger.warn('Slow Database Query', undefined, {
      traceId,
      executionTime: `${time}ms`,
      query: this.sanitizeQuery(query),
      parameters: maskedParams,
    });
  }

  logSchemaBuild(message: string): void {
    logger.debug('Database Schema Build', { message });
  }

  logMigration(message: string): void {
    logger.info('Database Migration', { message });
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    const traceId = getTraceId();
    const logMessage = typeof message === 'string' ? message : JSON.stringify(message);

    switch (level) {
      case 'log':
      case 'info':
        logger.info('TypeORM Log', { traceId, message: logMessage });
        break;
      case 'warn':
        logger.warn('TypeORM Warning', undefined, { traceId, message: logMessage });
        break;
    }
  }

  /**
   * Log query results (called after query execution)
   * This is a custom method we'll call manually from query interceptors
   */
  logQueryResult(query: string, result: unknown, executionTime?: number): void {
    if (!this.logResults) return;

    const traceId = getTraceId();
    const maskedResult = this.maskQueryResult(result);

    logger.debug('Database Query Result', {
      traceId,
      query: this.sanitizeQuery(query),
      resultCount: Array.isArray(result) ? result.length : result ? 1 : 0,
      executionTime: executionTime ? `${executionTime}ms` : undefined,
      result: maskedResult,
    });
  }

  /**
   * Sanitize SQL query by removing excessive whitespace
   */
  private sanitizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }

  /**
   * Mask sensitive data in query results
   */
  private maskQueryResult(result: unknown): unknown {
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
}

/**
 * TypeORM query result interceptor
 * This wraps repository methods to log results
 */
export function createQueryResultInterceptor() {
  return {
    afterLoad: (entity: unknown, options: { queryRunner?: unknown }) => {
      // This is called after entity is loaded
      // We can log it here if needed
    },
  };
}


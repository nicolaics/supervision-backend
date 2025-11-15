import { NextRequest, NextResponse } from 'next/server';
import { StatusCodes } from 'http-status-codes';
import { generateTraceId, runWithTraceAsync, getTraceId } from './traceContext';
import { logger } from './logger';
import { maskSensitiveFields } from './sensitiveFields';

/**
 * Extract request headers (excluding sensitive ones)
 */
function getRequestHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.some((sensitive) => lowerKey.includes(sensitive))) {
      headers[key] = '***MASKED***';
    } else {
      headers[key] = value;
    }
  });

  return headers;
}

/**
 * Extract request body safely (for logging)
 */
async function getRequestBody(request: NextRequest): Promise<unknown> {
  try {
    const clonedRequest = request.clone();
    const body = await clonedRequest.json().catch(() => null);
    return body ? maskSensitiveFields(body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract query parameters
 */
function getQueryParams(request: NextRequest): Record<string, string> {
  const params: Record<string, string> = {};
  const url = new URL(request.url);
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return maskSensitiveFields(params as Record<string, unknown>) as Record<string, string>;
}

/**
 * Log API request entry
 */
export async function logApiRequestEntry(request: NextRequest): Promise<string> {
  const traceId = request.headers.get('x-trace-id') || generateTraceId();

  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;
  const queryParams = getQueryParams(request);
  const headers = getRequestHeaders(request);
  const body = await getRequestBody(request);

  logger.info('API Request Entry', {
    traceId,
    method,
    path: pathname,
    queryParams,
    headers,
    body,
    userAgent: request.headers.get('user-agent'),
    ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
  });

  return traceId;
}

/**
 * Log API request exit
 */
export function logApiRequestExit(
  request: NextRequest,
  response: NextResponse,
  startTime: number,
  error?: Error
): void {
  const traceId = getTraceId();
  const duration = Date.now() - startTime;
  const status = response.status;
  const statusText = response.statusText;

  // Try to get response body (may not always be available)
  const responseBody: unknown = null;
  try {
    // Note: NextResponse body might not be easily accessible here
    // This is a limitation of Next.js API routes
  } catch {
    // Ignore
  }

  if (error) {
    logger.error('API Request Exit (Error)', error, {
      traceId,
      method: request.method,
      path: new URL(request.url).pathname,
      status,
      statusText,
      duration: `${duration}ms`,
    });
  } else {
    const logLevel = status >= StatusCodes.INTERNAL_SERVER_ERROR ? 'error' : status >= StatusCodes.BAD_REQUEST ? 'warn' : 'info';
    const logMessage = `API Request Exit (${status >= StatusCodes.BAD_REQUEST ? 'Error' : 'Success'})`;

    if (logLevel === 'error') {
      logger.error(logMessage, undefined, {
        traceId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        statusText,
        duration: `${duration}ms`,
        responseBody,
      });
    } else if (logLevel === 'warn') {
      logger.warn(logMessage, {
        traceId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        statusText,
        duration: `${duration}ms`,
      });
    } else {
      logger.info(logMessage, {
        traceId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        statusText,
        duration: `${duration}ms`,
      });
    }
  }
}

/**
 * Wrapper for API route handlers that adds logging
 */
export function withApiLogging<T>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest): Promise<NextResponse<T>> => {
    const startTime = Date.now();
    const traceId = await logApiRequestEntry(request);

    try {
      const response = await runWithTraceAsync(traceId, async () => {
        const result = await handler(request);
        
        // Add trace ID to response headers
        result.headers.set('x-trace-id', traceId);
        
        return result;
      });

      logApiRequestExit(request, response, startTime);
      return response;
    } catch (error) {
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          traceId,
        },
        { status: StatusCodes.INTERNAL_SERVER_ERROR }
      ) as NextResponse<T>;
      errorResponse.headers.set('x-trace-id', traceId);

      logApiRequestExit(request, errorResponse, startTime, error instanceof Error ? error : new Error(String(error)));
      return errorResponse;
    }
  };
}


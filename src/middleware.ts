import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CORS middleware for Next.js API routes
 * Handles preflight requests and adds CORS headers to all responses
 */
export function middleware(request: NextRequest) {
  // Only apply CORS to API routes
  if (!request.nextUrl.pathname.startsWith('/api/v1')) {
    return NextResponse.next();
  }

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 200 });
    addCorsHeaders(response, request);
    return response;
  }

  // For other requests, create a response and add CORS headers
  const response = NextResponse.next();
  addCorsHeaders(response, request);
  return response;
}

/**
 * Add CORS headers to the response
 */
function addCorsHeaders(response: NextResponse, request: NextRequest) {
  // Get the origin from the request
  const origin = request.headers.get('origin');
  
  // Get allowed origins from environment variable or use defaults
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const defaultOrigins = [
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:3000',
  ];
  
  const allowedOrigins = envOrigins 
    ? envOrigins.split(',').map(origin => origin.trim())
    : defaultOrigins;

  // Check if origin is allowed
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);
  
  // In development, allow the requesting origin if it's in the allowed list, or use wildcard
  // In production, only allow origins from the allowed list
  const allowOrigin = process.env.NODE_ENV === 'production' 
    ? (isAllowedOrigin ? origin : allowedOrigins[0] || '*')
    : (isAllowedOrigin ? origin : origin || '*');

  // Set CORS headers
  response.headers.set('Access-Control-Allow-Origin', allowOrigin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-trace-id');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours
}

// Configure which routes the middleware should run on
export const config = {
  matcher: '/api/v1/:path*',
};


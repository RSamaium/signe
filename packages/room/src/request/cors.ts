export function cors(res: Response, options: CorsOptions = {}) {
  const newHeaders = new Headers(res.headers);
  
  // Set default CORS headers
  const requestOrigin = options.origin || '*';
  newHeaders.set('Access-Control-Allow-Origin', requestOrigin);
  
  if (options.credentials) {
    newHeaders.set('Access-Control-Allow-Credentials', 'true');
  }
  
  if (options.exposedHeaders && options.exposedHeaders.length) {
    newHeaders.set('Access-Control-Expose-Headers', options.exposedHeaders.join(', '));
  }
  
  // Handle preflight requests
  if (options.methods && options.methods.length) {
    newHeaders.set('Access-Control-Allow-Methods', options.methods.join(', '));
  } else {
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  }
  
  if (options.allowedHeaders && options.allowedHeaders.length) {
    newHeaders.set('Access-Control-Allow-Headers', options.allowedHeaders.join(', '));
  } else {
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }
  
  if (options.maxAge) {
    newHeaders.set('Access-Control-Max-Age', options.maxAge.toString());
  } else {
    // Default max-age to 86400 seconds (24 hours)
    newHeaders.set('Access-Control-Max-Age', '86400');
  }
  
  return new Response(res.body, {
    status: res.status,
    headers: newHeaders
  });
}

export interface CorsOptions {
  origin?: string;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Creates a CORS interceptor with the specified options
 * @param options CORS configuration options
 * @returns An interceptor function that can be used with ServerResponse
 */
export function createCorsInterceptor(options: CorsOptions = {}): (res: Response) => Response {
  return (res: Response) => cors(res, options);
}
export class ServerResponse {
    private interceptors: ((res: Response) => Promise<Response> | Response)[];
    private statusCode: number = 200;
    private responseBody: any = {};
    private responseHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    /**
     * Creates a new ServerResponse instance
     * @param interceptors Array of interceptor functions that can modify the response
     */
    constructor(interceptors: ((res: Response) => Promise<Response> | Response)[] = []) {
        this.interceptors = interceptors;
    }

    /**
     * Sets the status code for the response
     * @param code HTTP status code
     * @returns this instance for chaining
     */
    status(code: number): ServerResponse {
        this.statusCode = code;
        return this;
    }

    /**
     * Sets the response body and returns this instance (chainable method)
     * 
     * @param body Response body
     * @returns this instance for chaining
     */
    body(body: any): ServerResponse {
        this.responseBody = body;
        return this;
    }

    /**
     * Adds a header to the response
     * @param name Header name
     * @param value Header value
     * @returns this instance for chaining
     */
    header(name: string, value: string): ServerResponse {
        this.responseHeaders[name] = value;
        return this;
    }

    /**
     * Adds multiple headers to the response
     * @param headers Object containing headers
     * @returns this instance for chaining
     */
    setHeaders(headers: Record<string, string>): ServerResponse {
        this.responseHeaders = { ...this.responseHeaders, ...headers };
        return this;
    }

    /**
     * Add an interceptor to the chain
     * @param interceptor Function that takes a Response and returns a modified Response
     * @returns this instance for chaining
     */
    use(interceptor: (res: Response) => Promise<Response> | Response): ServerResponse {
        this.interceptors.push(interceptor);
        return this;
    }

    /**
     * Builds and returns the Response object after applying all interceptors
     * @returns Promise<Response> The final Response object
     * @private Internal method used by terminal methods
     */
    private async buildResponse(): Promise<Response> {
        // Create initial response
        let response = new Response(JSON.stringify(this.responseBody), {
            status: this.statusCode,
            headers: this.responseHeaders
        });

        // Apply all interceptors sequentially
        for (const interceptor of this.interceptors) {
            try {
                const interceptedResponse = interceptor(response);
                if (interceptedResponse instanceof Promise) {
                    response = await interceptedResponse;
                } else {
                    response = interceptedResponse;
                }
            } catch (error) {
                console.error('Error in interceptor:', error);
                // Continue with the current response if an interceptor fails
            }
        }

        return response;
    }

    /**
     * Sets the response body to the JSON-stringified version of the provided value
     * and sends the response (terminal method)
     * 
     * @param body Response body to be JSON stringified
     * @returns Promise<Response> The final Response object
     */
    async json(body: any): Promise<Response> {
        this.responseBody = body;
        this.responseHeaders['Content-Type'] = 'application/json';
        return this.buildResponse();
    }

    /**
     * Sends the response with the current configuration (terminal method)
     * 
     * @param body Optional body to set before sending
     * @returns Promise<Response> The final Response object
     */
    async send(body?: any): Promise<Response> {
        if (body !== undefined) {
            this.responseBody = body;
        }
        return this.buildResponse();
    }

    /**
     * Sends a plain text response (terminal method)
     * 
     * @param text Text to send
     * @returns Promise<Response> The final Response object
     */
    async text(text: string): Promise<Response> {
        this.responseBody = text;
        this.responseHeaders['Content-Type'] = 'text/plain';
        
        // Create a text response without JSON stringifying the body
        let response = new Response(text, {
            status: this.statusCode,
            headers: this.responseHeaders
        });
        
        // Apply interceptors
        for (const interceptor of this.interceptors) {
            try {
                const interceptedResponse = interceptor(response);
                if (interceptedResponse instanceof Promise) {
                    response = await interceptedResponse;
                } else {
                    response = interceptedResponse;
                }
            } catch (error) {
                console.error('Error in interceptor:', error);
            }
        }
        
        return response;
    }

    /**
     * Redirects to the specified URL (terminal method)
     * 
     * @param url URL to redirect to
     * @param statusCode HTTP status code (default: 302)
     * @returns Promise<Response> The final Response object
     */
    async redirect(url: string, statusCode: number = 302): Promise<Response> {
        this.statusCode = statusCode;
        this.responseHeaders['Location'] = url;
        return this.buildResponse();
    }

    /**
     * Creates a success response with status 200
     * @param body Response body
     * @returns Promise<Response> The final Response object
     */
    async success(body: any = {}): Promise<Response> {
        return this.status(200).json(body);
    }

    /**
     * Creates an error response with status 400
     * @param message Error message
     * @param details Additional error details
     * @returns Promise<Response> The final Response object
     */
    async badRequest(message: string, details: any = {}): Promise<Response> {
        return this.status(400).json({
            error: message,
            ...details
        });
    }

    /**
     * Creates an error response with status 403
     * @param message Error message
     * @returns Promise<Response> The final Response object
     */
    async notPermitted(message: string = "Not permitted"): Promise<Response> {
        return this.status(403).json({ error: message });
    }

    /**
     * Creates an error response with status 401
     * @param message Error message
     * @returns Promise<Response> The final Response object
     */
    async unauthorized(message: string = "Unauthorized"): Promise<Response> {
        return this.status(401).json({ error: message });
    }

    /**
     * Creates an error response with status 404
     * @param message Error message
     * @returns Promise<Response> The final Response object
     */
    async notFound(message: string = "Not found"): Promise<Response> {
        return this.status(404).json({ error: message });
    }

    /**
     * Creates an error response with status 500
     * @param message Error message
     * @returns Promise<Response> The final Response object
     */
    async serverError(message: string = "Internal Server Error"): Promise<Response> {
        return this.status(500).json({ error: message });
    }
}
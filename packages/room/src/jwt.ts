/**
 * JWT Authentication Class for Cloudflare Workers
 * Uses Web Crypto API for JWT signing and verification
 */

interface JWTOptions {
    expiresIn?: string | number;
}

interface JWTHeader {
    alg: string;
    typ: string;
}

interface JWTPayload {
    [key: string]: unknown;
    iat?: number;
    exp?: number;
}

export class JWTAuth {
    private secret: string;
    private encoder: TextEncoder;
    private decoder: TextDecoder;

    /**
     * Constructor for the JWTAuth class
     * @param {string} secret - The secret key used for signing and verifying tokens
     */
    constructor(secret: string) {
        if (!secret || typeof secret !== 'string') {
            throw new Error('Secret is required and must be a string');
        }
        this.secret = secret;
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
    }

    /**
     * Convert the secret to a CryptoKey for HMAC operations
     * @returns {Promise<CryptoKey>} - The CryptoKey for HMAC operations
     */
    private async getSecretKey(): Promise<CryptoKey> {
        const keyData: Uint8Array = this.encoder.encode(this.secret);
        return await crypto.subtle.importKey(
            'raw', // format
            keyData, // key data
            {
                name: 'HMAC',
                hash: { name: 'SHA-256' },
            },
            false, // extractable
            ['sign', 'verify'] // key usages
        );
    }

    /**
     * Base64Url encode a buffer
     * @param {ArrayBuffer} buffer - The buffer to encode
     * @returns {string} - The base64url encoded string
     */
    private base64UrlEncode(buffer: ArrayBuffer): string {
        const base64: string = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }

    /**
     * Base64Url decode a string
     * @param {string} base64Url - The base64url encoded string
     * @returns {ArrayBuffer} - The decoded buffer
     */
    private base64UrlDecode(base64Url: string) {
        const padding: string = '='.repeat((4 - (base64Url.length % 4)) % 4);
        const base64: string = base64Url.replace(/-/g, '+').replace(/_/g, '/') + padding;
        const rawData: string = atob(base64);
        const buffer: Uint8Array = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; i++) {
            buffer[i] = rawData.charCodeAt(i);
        }

        return buffer.buffer;
    }

    /**
     * Sign a payload and create a JWT token
     * @param {JWTPayload} payload - The payload to include in the token
     * @param {JWTOptions} [options={}] - Options for the token
     * @param {string | number} [options.expiresIn='1h'] - Token expiration time
     * @returns {Promise<string>} - The JWT token
     */
    public async sign(payload: JWTPayload, options: JWTOptions = {}): Promise<string> {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Payload must be an object');
        }

        // Set default expiration if not provided
        const expiresIn: string | number = options.expiresIn || '1h';

        // Calculate expiration time
        let exp: number | undefined;
        if (typeof expiresIn === 'number') {
            exp = Math.floor(Date.now() / 1000) + expiresIn;
        } else if (typeof expiresIn === 'string') {
            const match: RegExpMatchArray | null = expiresIn.match(/^(\d+)([smhd])$/);
            if (match) {
                const value: number = parseInt(match[1]);
                const unit: string = match[2];
                const seconds: number = {
                    's': value,
                    'm': value * 60,
                    'h': value * 60 * 60,
                    'd': value * 60 * 60 * 24
                }[unit]!;
                exp = Math.floor(Date.now() / 1000) + seconds;
            } else {
                throw new Error('Invalid expiresIn format. Use a number (seconds) or a string like "1h", "30m", etc.');
            }
        }

        // Create full payload with claims
        const fullPayload: JWTPayload = {
            ...payload,
            iat: Math.floor(Date.now() / 1000),
            exp
        };

        // Create header
        const header: JWTHeader = {
            alg: 'HS256',
            typ: 'JWT'
        };

        // Encode header and payload
        // @ts-expect-error - TS doesn't have a built-in TextEncoder
        const encodedHeader: string = this.base64UrlEncode(this.encoder.encode(JSON.stringify(header)));
        //   @ts-expect-error - TS doesn't have a built-in TextEncoder
        const encodedPayload: string = this.base64UrlEncode(this.encoder.encode(JSON.stringify(fullPayload)));

        // Create signature base
        const signatureBase: string = `${encodedHeader}.${encodedPayload}`;

        // Get key and sign
        const key: CryptoKey = await this.getSecretKey();
        const signature: ArrayBuffer = await crypto.subtle.sign(
            { name: 'HMAC' },
            key,
            this.encoder.encode(signatureBase)
        );

        // Encode signature and create token
        const encodedSignature: string = this.base64UrlEncode(signature);
        return `${signatureBase}.${encodedSignature}`;
    }

    /**
     * Verify a JWT token and return the decoded payload
     * @param {string} token - The JWT token to verify
     * @returns {Promise<JWTPayload>} - The decoded payload if verification succeeds
     * @throws {Error} - If verification fails
     */
    public async verify(token: string): Promise<JWTPayload> {
        if (!token || typeof token !== 'string') {
            throw new Error('Token is required and must be a string');
        }

        // Split token into parts
        const parts: string[] = token.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid token format');
        }

        const [encodedHeader, encodedPayload, encodedSignature] = parts;

        // Decode header and payload
        try {
            // @ts-expect-error - TS doesn't have a built-in TextDecoder
            const header: JWTHeader = JSON.parse(this.decoder.decode(this.base64UrlDecode(encodedHeader)));
            // @ts-expect-error - TS doesn't have a built-in TextDecoder
            const payload: JWTPayload = JSON.parse(this.decoder.decode(this.base64UrlDecode(encodedPayload)));

            // Check algorithm
            if (header.alg !== 'HS256') {
                throw new Error(`Unsupported algorithm: ${header.alg}`);
            }

            // Check expiration
            const now: number = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                throw new Error('Token has expired');
            }

            // Verify signature
            const key: CryptoKey = await this.getSecretKey();
            const signatureBase: string = `${encodedHeader}.${encodedPayload}`;
            const signature: ArrayBuffer = this.base64UrlDecode(encodedSignature) as ArrayBuffer;

            const isValid: boolean = await crypto.subtle.verify(
                { name: 'HMAC' },
                key,
                signature,
                this.encoder.encode(signatureBase)
            );

            if (!isValid) {
                throw new Error('Invalid signature');
            }

            return payload;
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Token verification failed: ${error.message}`);
            }
            throw new Error('Token verification failed: Unknown error');
        }
    }
}
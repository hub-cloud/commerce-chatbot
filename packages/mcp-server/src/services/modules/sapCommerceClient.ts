import axios, { AxiosInstance } from 'axios';
import https from 'https';
import crypto from 'crypto';
import { withRetry } from '../../utils/retryUtils.js';
import { logger } from '../../utils/logger.js';
import { AuthToken, SapCommerceConfig, TimestampedRequestConfig } from '../types/interfaces.js';

export class SapCommerceClient {
    private readonly client: AxiosInstance;
    private authToken: AuthToken | null = null;
    private readonly config: SapCommerceConfig;

    constructor(config: SapCommerceConfig) {
        this.config = config;
        
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false, // Disable certificate verification
            secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
        });

        this.client = axios.create({
            baseURL: this.config.baseUrl,
            timeout: config.timeout || 15000, // Increased to 15 seconds to account for retries
            httpsAgent,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        // Add request timing interceptor
        this.client.interceptors.request.use(async (request: TimestampedRequestConfig) => {
            request.timestamp = Date.now();

            // Add baseSite to URL if not auth request
            if (!request.url?.includes('authorizationserver')) {
                const site = this.config.baseSite || 'electronics';
                request.url = `/${site}${request.url}`;

                // Add auth token if available (but NOT for auth requests to avoid infinite recursion)
                const token = await this.getAuthToken();
                if (token) {
                    request.headers.Authorization = `Bearer ${token.access_token}`;
                }
            }

            // DETAILED REQUEST LOGGING
            logger.info(`\n${'='.repeat(80)}`);
            logger.info(`📤 OUTGOING REQUEST`);
            logger.info(`${'='.repeat(80)}`);
            logger.info(`Method: ${request.method?.toUpperCase()}`);
            logger.info(`URL: ${this.config.baseUrl}${request.url}`);
            logger.info(`Headers: ${JSON.stringify(request.headers, null, 2)}`);
            if (request.params) {
                logger.info(`Query Params: ${JSON.stringify(request.params, null, 2)}`);
            }
            if (request.data) {
                logger.info(`Request Body: ${JSON.stringify(request.data, null, 2)}`);
            }
            logger.info(`${'='.repeat(80)}\n`);

            return request;
        });

        // Add response logging interceptor
        this.client.interceptors.response.use(
            (response) => {
                const duration = Date.now() - (response.config as TimestampedRequestConfig).timestamp!;

                // DETAILED RESPONSE LOGGING
                logger.info(`\n${'='.repeat(80)}`);
                logger.info(`📥 INCOMING RESPONSE (SUCCESS)`);
                logger.info(`${'='.repeat(80)}`);
                logger.info(`Status: ${response.status} ${response.statusText}`);
                logger.info(`Duration: ${duration}ms`);
                logger.info(`URL: ${response.config.url}`);
                logger.info(`Response Headers: ${JSON.stringify(response.headers, null, 2)}`);
                logger.info(`Response Body: ${JSON.stringify(response.data, null, 2)}`);
                logger.info(`${'='.repeat(80)}\n`);

                return response;
            },
            (error) => {
                if (error.config) {
                    const duration = Date.now() - (error.config as TimestampedRequestConfig).timestamp!;
                    const status = error.response?.status || 'FAILED';

                    // DETAILED ERROR LOGGING
                    logger.error(`\n${'='.repeat(80)}`);
                    logger.error(`📥 INCOMING RESPONSE (ERROR)`);
                    logger.error(`${'='.repeat(80)}`);
                    logger.error(`Status: ${status}`);
                    logger.error(`Duration: ${duration}ms`);
                    logger.error(`URL: ${error.config.url}`);
                    logger.error(`Method: ${error.config.method?.toUpperCase()}`);
                    if (error.response?.headers) {
                        logger.error(`Response Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
                    }
                    if (error.response?.data) {
                        logger.error(`Error Response Body: ${JSON.stringify(error.response.data, null, 2)}`);
                    }
                    logger.error(`Error Message: ${error.message}`);
                    logger.error(`${'='.repeat(80)}\n`);
                }
                return Promise.reject(error);
            }
        );
    }

    async getAuthToken(): Promise<AuthToken | null> {
        if (!this.config.clientId || !this.config.clientSecret) {
            logger.error('[TOKEN] No OAuth credentials configured');
            return null;
        }

        try {
            return await withRetry(async () => {
                // Check if we have a valid token
                if (this.authToken) {
                    const bufferTime = 5 * 60 * 1000;
                    const tokenExpiration = new Date().getTime() + (this.authToken.expires_in * 1000) - bufferTime;
                    if (tokenExpiration > new Date().getTime()) {
                        return this.authToken;
                    }
                }

                logger.info('[TOKEN] Requesting new OAuth token...');

                // Token endpoint is at server root, not under /occ/v2
                // Use full URL to bypass baseURL
                const baseUrl = this.config.baseUrl.replace('/occ/v2', '');
                const tokenUrl = `${baseUrl}/authorizationserver/oauth/token`;

                // SAP Commerce expects OAuth params as query parameters, not body
                const response = await this.client.post(
                    tokenUrl,
                    null,
                    {
                        params: {
                            client_id: this.config.clientId,
                            client_secret: this.config.clientSecret,
                            grant_type: 'client_credentials'
                        }
                    }
                );

                this.authToken = response.data;
                logger.info(`[TOKEN] ✓ Token obtained (expires in ${this.authToken?.expires_in}s)`);

                return this.authToken;
            }, this.config.retryConfig);
        } catch (error) {
            logger.error('[TOKEN] Failed to obtain auth token:', error);
            return null;
        }
    }

    getAxiosClient(userAccessToken?: string): AxiosInstance {
        // If user token provided, create a wrapper that adds user auth header
        if (userAccessToken) {
            // Create a new axios instance that inherits from base client but uses user token
            const userClient = axios.create({
                ...this.client.defaults,
                headers: {
                    ...this.client.defaults.headers,
                    'Authorization': `Bearer ${userAccessToken}`
                }
            });

            // Copy interceptors from base client (except auth interceptor)
            userClient.interceptors.request.use(async (request: TimestampedRequestConfig) => {
                request.timestamp = Date.now();

                // Add baseSite to URL if not auth request
                if (!request.url?.includes('authorizationserver')) {
                    const site = this.config.baseSite || 'electronics';
                    request.url = `/${site}${request.url}`;
                }

                // DETAILED REQUEST LOGGING FOR USER TOKEN
                logger.info(`\n${'='.repeat(80)}`);
                logger.info(`📤 OUTGOING REQUEST [USER TOKEN]`);
                logger.info(`${'='.repeat(80)}`);
                logger.info(`Method: ${request.method?.toUpperCase()}`);
                logger.info(`URL: ${this.config.baseUrl}${request.url}`);
                logger.info(`Headers: ${JSON.stringify(request.headers, null, 2)}`);
                if (request.params) {
                    logger.info(`Query Params: ${JSON.stringify(request.params, null, 2)}`);
                }
                if (request.data) {
                    logger.info(`Request Body: ${JSON.stringify(request.data, null, 2)}`);
                }
                logger.info(`${'='.repeat(80)}\n`);

                return request;
            });

            // Add response logging interceptor
            userClient.interceptors.response.use(
                (response) => {
                    const duration = Date.now() - (response.config as TimestampedRequestConfig).timestamp!;

                    // DETAILED RESPONSE LOGGING
                    logger.info(`\n${'='.repeat(80)}`);
                    logger.info(`📥 INCOMING RESPONSE (SUCCESS) [USER TOKEN]`);
                    logger.info(`${'='.repeat(80)}`);
                    logger.info(`Status: ${response.status} ${response.statusText}`);
                    logger.info(`Duration: ${duration}ms`);
                    logger.info(`URL: ${response.config.url}`);
                    logger.info(`Response Headers: ${JSON.stringify(response.headers, null, 2)}`);
                    logger.info(`Response Body: ${JSON.stringify(response.data, null, 2)}`);
                    logger.info(`${'='.repeat(80)}\n`);

                    return response;
                },
                (error) => {
                    if (error.config) {
                        const duration = Date.now() - (error.config as TimestampedRequestConfig).timestamp!;
                        const status = error.response?.status || 'FAILED';

                        // DETAILED ERROR LOGGING
                        logger.error(`\n${'='.repeat(80)}`);
                        logger.error(`📥 INCOMING RESPONSE (ERROR) [USER TOKEN]`);
                        logger.error(`${'='.repeat(80)}`);
                        logger.error(`Status: ${status}`);
                        logger.error(`Duration: ${duration}ms`);
                        logger.error(`URL: ${error.config.url}`);
                        logger.error(`Method: ${error.config.method?.toUpperCase()}`);
                        if (error.response?.headers) {
                            logger.error(`Response Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
                        }
                        if (error.response?.data) {
                            logger.error(`Error Response Body: ${JSON.stringify(error.response.data, null, 2)}`);
                        }
                        logger.error(`Error Message: ${error.message}`);
                        logger.error(`${'='.repeat(80)}\n`);
                    }
                    return Promise.reject(error);
                }
            );

            return userClient;
        }

        // Use default client with client credentials
        return this.client;
    }

    getRetryConfig() {
        return this.config.retryConfig;
    }
}
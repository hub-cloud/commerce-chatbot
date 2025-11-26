import { withRetry, RetryConfig } from '../../utils/retryUtils.js';
import { Cart, Address, DeliveryMode, PaymentDetails } from '../types/interfaces.js';
import { SapCommerceClient } from './sapCommerceClient.js';
import { logger } from '../../utils/logger.js';

export class CartService {
    private client: SapCommerceClient;
    private readonly cartOperationsRetryConfig: RetryConfig = {
        maxRetries: 2,
        initialDelay: 2000,  // 2 seconds
        maxDelay: 10000,     // 10 seconds
        backoffFactor: 2,
        retryableStatuses: [408, 429, 500, 502, 503, 504]
    };

    constructor(client: SapCommerceClient) {
        this.client = client;
    }

    async createCart(userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const endpoint = userAccessToken
                ? '/users/current/carts'
                : '/users/anonymous/carts';

            const response = await this.client.getAxiosClient(userAccessToken).post(endpoint);
            return response.data;
        }, this.cartOperationsRetryConfig);
    }

    async getCart(cartId: string, userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const endpoint = userAccessToken
                ? `/users/current/carts/${cartId}`
                : `/users/anonymous/carts/${cartId}`;

            const response = await this.client.getAxiosClient(userAccessToken).get(endpoint);
            return response.data;
        }, this.cartOperationsRetryConfig);
    }

    async addToCart(cartId: string, productCode: string, quantity: number = 1, userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            // Now try to add to cart
            try {
                const response = await this.client.getAxiosClient(userAccessToken).post(
                    `${userPrefix}/carts/${cartId}/entries`,
                    {
                        product: { code: productCode },
                        quantity
                    }
                );
                logger.info(`Successfully added product ${productCode} to cart ${cartId}`);
                return response.data;
            } catch (error: any) {
                logger.error(`Failed to add product ${productCode} to cart ${cartId}: ${error.message}`);

                // If we get a 400 error, try to get the cart first and use its GUID instead
                if (error.response?.status === 400) {
                    try {
                        // Get the cart to retrieve its GUID
                        const cart = await this.getCart(cartId, userAccessToken);

                        if (cart.guid) {
                            logger.info(`Retrying with cart GUID ${cart.guid} instead of cartId ${cartId}`);

                            // Retry with GUID
                            const retryResponse = await this.client.getAxiosClient(userAccessToken).post(
                                `${userPrefix}/carts/${cart.guid}/entries`,
                                {
                                    product: { code: productCode },
                                    quantity
                                }
                            );

                            logger.info(`Successfully added product ${productCode} to cart using GUID ${cart.guid}`);
                            return retryResponse.data;
                        }
                    } catch (retryError: any) {
                        logger.error(`Failed to add product with GUID fallback: ${retryError.message}`);
                    }

                    throw new Error(`Invalid cart operation: ${error.response?.data?.error || 'Unknown error'}`);
                }

                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }

    async updateCartEntry(cartId: string, entryNumber: number, quantity: number, userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            try {
                // Verify cart exists first
                await this.getCart(cartId, userAccessToken);

                const response = await this.client.getAxiosClient(userAccessToken).patch(
                    `${userPrefix}/carts/${cartId}/entries/${entryNumber}`,
                    {
                        quantity
                    }
                );
                logger.info(`Successfully updated quantity to ${quantity} for entry ${entryNumber} in cart ${cartId}`);
                return response.data;
            } catch (error: any) {
                logger.error(`Failed to update entry ${entryNumber} in cart ${cartId}: ${error.message}`);
                if (error.response?.status === 404) {
                    throw new Error(`Cart ${cartId} or entry ${entryNumber} not found`);
                }
                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }

    async removeCartEntry(cartId: string, entryNumber: number, userAccessToken?: string): Promise<void> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            try {
                // Verify cart exists first
                await this.getCart(cartId, userAccessToken);

                await this.client.getAxiosClient(userAccessToken).delete(`${userPrefix}/carts/${cartId}/entries/${entryNumber}`);
                logger.info(`Successfully removed entry ${entryNumber} from cart ${cartId}`);
            } catch (error: any) {
                logger.error(`Failed to remove entry ${entryNumber} from cart ${cartId}: ${error.message}`);
                if (error.response?.status === 404) {
                    throw new Error(`Cart ${cartId} or entry ${entryNumber} not found`);
                }
                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }

    async setDeliveryAddress(cartId: string, address: Address, userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            try {
                // Verify cart exists first
                await this.getCart(cartId, userAccessToken);

                console.error(`📦 FULL ADDRESS PAYLOAD BEING SENT TO SAP COMMERCE:`);
                console.error(JSON.stringify(address, null, 2));

                // POST to create and set delivery address (not PUT)
                const response = await this.client.getAxiosClient(userAccessToken).post(
                    `${userPrefix}/carts/${cartId}/addresses/delivery`,
                    address
                );
                logger.info(`Successfully set delivery address for cart ${cartId}`);
                return response.data;
            } catch (error: any) {
                logger.error(`Failed to set delivery address for cart ${cartId}: ${error.message}`);
                console.error(`📦 FULL ERROR RESPONSE:`);
                console.error(JSON.stringify(error.response?.data, null, 2));
                if (error.response?.status === 404) {
                    throw new Error(`Cart ${cartId} not found`);
                }
                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }

    async getDeliveryModes(cartId: string, userAccessToken?: string): Promise<DeliveryMode[]> {
        return withRetry(async () => {
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            try {
                const response = await this.client.getAxiosClient(userAccessToken).get(
                    `${userPrefix}/carts/${cartId}/deliverymodes`
                );
                logger.info(`Successfully retrieved delivery modes for cart ${cartId}`);
                return response.data.deliveryModes || [];
            } catch (error: any) {
                logger.error(`Failed to get delivery modes for cart ${cartId}: ${error.message}`);
                if (error.response?.status === 404) {
                    throw new Error(`Cart ${cartId} not found`);
                }
                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }

    async setDeliveryMode(cartId: string, deliveryModeCode: string, userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            try {
                // Verify cart exists first
                await this.getCart(cartId, userAccessToken);

                const response = await this.client.getAxiosClient(userAccessToken).put(
                    `${userPrefix}/carts/${cartId}/deliverymode`,
                    null,
                    {
                        params: {
                            deliveryModeId: deliveryModeCode
                        }
                    }
                );
                logger.info(`Successfully set delivery mode ${deliveryModeCode} for cart ${cartId}`);
                return response.data;
            } catch (error: any) {
                logger.error(`Failed to set delivery mode for cart ${cartId}: ${error.message}`);
                if (error.response?.status === 404) {
                    throw new Error(`Cart ${cartId} or delivery mode ${deliveryModeCode} not found`);
                }
                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }

    async setPaymentDetails(cartId: string, paymentDetails: PaymentDetails, userAccessToken?: string): Promise<Cart> {
        return withRetry(async () => {
            const userPrefix = userAccessToken ? '/users/current' : '/users/anonymous';

            try {
                // Verify cart exists first
                await this.getCart(cartId, userAccessToken);

                const response = await this.client.getAxiosClient(userAccessToken).post(
                    `${userPrefix}/carts/${cartId}/paymentdetails`,
                    paymentDetails
                );
                logger.info(`Successfully set payment details for cart ${cartId}`);
                return response.data;
            } catch (error: any) {
                logger.error(`Failed to set payment details for cart ${cartId}: ${error.message}`);
                if (error.response?.status === 404) {
                    throw new Error(`Cart ${cartId} not found`);
                }
                throw error;
            }
        }, this.cartOperationsRetryConfig);
    }
}
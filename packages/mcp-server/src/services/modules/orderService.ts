import { withRetry } from '../../utils/retryUtils.js';
import { OrderStatus, Promotion } from '../types/interfaces.js';
import { SapCommerceClient } from './sapCommerceClient.js';

export class OrderService {
    private client: SapCommerceClient;

    constructor(client: SapCommerceClient) {
        this.client = client;
    }

    async getPromotions(promotionId?: string): Promise<Promotion[]> {
        return withRetry(async () => {
            const endpoint = promotionId ? `/promotions/${promotionId}` : '/promotions';
            const response = await this.client.getAxiosClient().get(endpoint, {
                params: {
                    type: 'all'  // Required parameter
                }
            });
            return response.data.promotions || [response.data];
        }, this.client.getRetryConfig());
    }

    async getOrderStatus(orderCode: string, userAccessToken?: string): Promise<OrderStatus> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const endpoint = userAccessToken
                ? `/users/current/orders/${orderCode}`
                : `/users/anonymous/orders/${orderCode}`;

            const response = await this.client.getAxiosClient(userAccessToken).get(endpoint, {
                params: {
                    fields: 'FULL'
                }
            });
            return response.data;
        }, this.client.getRetryConfig());
    }

    async getOrderHistory(currentPage: number = 0, pageSize: number = 10, userAccessToken?: string): Promise<{
        orders: OrderStatus[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalResults: number;
        };
    }> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const endpoint = userAccessToken
                ? '/users/current/orders'
                : '/users/anonymous/orders';

            const response = await this.client.getAxiosClient(userAccessToken).get(endpoint, {
                params: {
                    currentPage,
                    pageSize,
                    fields: 'FULL'
                }
            });
            return response.data;
        }, this.client.getRetryConfig());
    }

    async placeOrder(cartId: string, userAccessToken?: string): Promise<OrderStatus> {
        return withRetry(async () => {
            // Use /users/current for authenticated users, /users/anonymous for guests
            const endpoint = userAccessToken
                ? '/users/current/orders'
                : '/users/anonymous/orders';

            const response = await this.client.getAxiosClient(userAccessToken).post(endpoint, {}, {
                params: {
                    cartId,
                    fields: 'FULL'
                }
            });
            return response.data;
        }, this.client.getRetryConfig());
    }
}
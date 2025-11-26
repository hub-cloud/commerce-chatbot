import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { z } from "zod";
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { SapCommerceService, type SapCommerceConfig } from "./services/sapCommerceService.js";
import { MetricsAnalyzer } from './utils/metricsAnalyzer.js';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in project root
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

// Load .env file if it exists
dotenvConfig({ path: envPath });

// Configuration for SAP Commerce
const config: SapCommerceConfig = {
    baseUrl: process.env.SAP_COMMERCE_URL || 'https://localhost:9002/occ/v2',
    baseSite: process.env.SAP_COMMERCE_SITE || 'electronics',
    timeout: parseInt(process.env.SAP_COMMERCE_TIMEOUT || '10000'),
    validateSSL: process.env.SAP_COMMERCE_VALIDATE_SSL !== 'false',
    clientId: process.env.SAP_COMMERCE_CLIENT_ID,
    clientSecret: process.env.SAP_COMMERCE_CLIENT_SECRET
};

const sapCommerceService = new SapCommerceService(config);

// Create server instance
const server = new McpServer({
    name: "sap-commerce",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});

function formatResponse(data: any): string {
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        let errorMsg = `Error: ${error.message}`;

        // If it's a RetryError, show the underlying cause
        if (error.name === 'RetryError' && (error as any).cause) {
            const cause = (error as any).cause;
            errorMsg += `\nUnderlying cause: ${cause.message}`;

            // If the cause is an Axios error, show HTTP details
            if (cause.isAxiosError) {
                const status = cause.response?.status;
                const statusText = cause.response?.statusText;
                const data = cause.response?.data;
                const url = cause.config?.url;
                const method = cause.config?.method?.toUpperCase();

                errorMsg += `\nHTTP ${method} ${url} failed with status ${status} ${statusText}`;

                if (data) {
                    if (typeof data === 'object') {
                        errorMsg += `\nResponse: ${JSON.stringify(data, null, 2)}`;
                    } else {
                        errorMsg += `\nResponse: ${data}`;
                    }
                }
            }
        }

        return errorMsg;
    }
    return `Error: ${String(error)}`;
}

// Register SAP Commerce tools
server.tool(
    "search-products",
    "Search for products by product name/description in SAP Commerce. Returns a paginated list of products with detailed information including product details (code, name, price, images, stock status), facet data for advanced filtering (stores, price ranges, megapixels, lens types, colors, brands, categories with counts and query URLs), pagination metadata, available sort options, and current query context.",
    {
        query: z.string().describe("Search query for products"),
        currentPage: z.number().optional().describe("Page number to retrieve"),
        pageSize: z.number().optional().describe("Number of results per page"),
        fields: z.string().optional().describe("Fields to return in the response"),
    },
    async ({ query, currentPage = 0, pageSize = 20 }: { query: string; currentPage?: number; pageSize?: number }) => {
        try {
            const results = await sapCommerceService.searchProducts(query, currentPage, pageSize);
            // Return complete SAP Commerce search results
            return {
                content: [{ type: "text", text: formatResponse(results) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-product-details",
    "Get comprehensive detailed information about a specific product by product code/SKU. Returns complete product data including: basic info (name, description, manufacturer), pricing details with volume prices, stock levels and availability status, multiple image formats (zoom, product, thumbnail, gallery images), detailed technical classifications and specifications organized by category (memory, display, lens system, dimensions, sensor type, etc.), product categories and URL, reviews and ratings, potential promotions, and SAP unit information. Use this when you need complete product specifications beyond basic search results.",
    {
        productCode: z.string().describe("Product code/SKU"),
    },
    async ({ productCode }: { productCode: string }) => {
        try {
            const product = await sapCommerceService.getProductDetails(productCode);
            return {
                content: [{ type: "text", text: formatResponse(product) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "check-product-availability",
    "Check stock availability for a product across multiple store locations. Returns comprehensive store-level inventory data including: product basic information, paginated list of stores with detailed stock information per location (stock level count, stock status: inStock/outOfStock/lowStock), store details (name, address, phone, geo-coordinates, formatted distance), opening hours schedule by day of week, and store images. Optionally filter by specific location/warehouse code. Useful for checking where a product is available for in-store pickup or inventory planning.",
    {
        productCode: z.string().describe("Product code/SKU"),
        location: z.string().optional().describe("Warehouse or store location code"),
    },
    async ({ productCode, location }: { productCode: string; location?: string }) => {
        try {
            const stock = await sapCommerceService.checkProductStock(productCode, location);
            return {
                content: [{ type: "text", text: formatResponse(stock) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-categories",
    "Get product categories from SAP Commerce catalog system. Returns hierarchical category structure from the product catalog including: catalog information (id, name, url), catalog versions (Staged/Online), and nested category trees with unlimited depth. Each category includes category id, name, URL path, and subcategories array. Categories can represent product hierarchies (e.g., Cameras > Digital Cameras > Digital SLR), brand taxonomies, color classifications, and configuration groupings. Optionally provide a categoryId to retrieve a specific category with all its subcategories. Returns full catalog hierarchy by default. Useful for browsing product organization, building navigation menus, and understanding product classification structure.",
    {
        categoryId: z.string().optional().describe("Optional category ID to get specific category details"),
    },
    async ({ categoryId }: { categoryId?: string }) => {
        try {
            const categories = await sapCommerceService.getCategories(categoryId);
            return {
                content: [{ type: "text", text: formatResponse(categories) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-countries",
    "Get all available countries from SAP Commerce. Returns a list of countries with their ISO codes and names. Useful for building address forms and validating country information.",
    {},
    async () => {
        try {
            const countries = await sapCommerceService.getCountries();
            return {
                content: [{ type: "text", text: formatResponse({ countries }) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-regions",
    "Get all regions/states for a specific country. Returns a list of regions with their ISO codes, names, and country ISO. Useful for building state/province dropdowns in address forms.",
    {
        countryIsocode: z.string().describe("Country ISO code (e.g., 'US', 'GB', 'DE')"),
    },
    async ({ countryIsocode }: { countryIsocode: string }) => {
        try {
            const regions = await sapCommerceService.getRegions(countryIsocode);
            return {
                content: [{ type: "text", text: formatResponse({ regions, countryIsocode }) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-products-by-category",
    "Get products from a specific category with pagination and sorting. Returns a paginated product list filtered by category including: category context (categoryCode, currentQuery URL), pagination metadata (currentPage, pageSize, totalPages, totalResults, sort), detailed product information per item (code/SKU, name, description, summary, manufacturer, price with currency and formatted value, stock status, firstVariantImage, product URL, averageRating if available, pickup availability, configuration flags), and available sort options (relevance, topRated, name-asc, name-desc, price-asc, price-desc with selected state). Supports custom pagination (page number, page size) and sorting parameters. Useful for browsing category-specific product catalogs, building category pages, and displaying filtered product collections.",
    {
        categoryId: z.string().describe("Category ID to get products from"),
        currentPage: z.number().optional().describe("Page number (starts from 0)"),
        pageSize: z.number().optional().describe("Number of products per page"),
        sort: z.string().optional().describe("Sort order (e.g., 'name:asc', 'price:desc')")
    },
    async ({ categoryId, currentPage, pageSize, sort }: { 
        categoryId: string; 
        currentPage?: number; 
        pageSize?: number; 
        sort?: string 
    }) => {
        try {
            const products = await sapCommerceService.getProductsByCategory(categoryId, {
                currentPage,
                pageSize,
                sort
            });
            return {
                content: [{ type: "text", text: formatResponse(products) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-promotions",
    "Get active promotions from SAP Commerce. Returns a list of promotions defined for the current base site. Requires trusted client authentication (ROLE_TRUSTED_CLIENT). Each promotion includes: promotion code (unique identifier), and promotion type indicating the discount mechanism (AcceleratorProductBOGOFPromotion for buy-one-get-one-free, AcceleratorProductMultiBuyPromotion for multi-buy discounts, Bundle for product bundles, Percentage discount, Fixed price, Perfect partner for paired product discounts, Order threshold fixed percentage discount, Order threshold fixed discount). Can filter by promotion type parameter (all/product/order) and optionally by promotion group. Useful for displaying available discounts, special offers, and promotional campaigns to customers.",
    {
        promotionId: z.string().optional().describe("Optional promotion ID to get specific promotion details"),
    },
    async ({ promotionId }: { promotionId?: string }) => {
        try {
            const promotions = await sapCommerceService.getPromotions(promotionId);
            return {
                content: [{ type: "text", text: formatResponse(promotions) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-product-reviews",
    "Get customer reviews for a specific product. Returns an array of customer reviews including: review metadata (id, date in ISO 8601 format), review content (headline, detailed comment text), rating score (numeric value, typically 1-5), and reviewer information (principal with name and uid/email). Reviews provide customer feedback and experiences with the product. Useful for displaying product ratings, gathering customer insights, and helping shoppers make informed purchase decisions.",
    {
        productCode: z.string().describe("Product code to get reviews for"),
    },
    async ({ productCode }: { productCode: string }) => {
        try {
            const reviews = await sapCommerceService.getProductReviews(productCode);
            return {
                content: [{ type: "text", text: formatResponse(reviews) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "search-products-advanced",
    "Advanced product search with comprehensive filtering and sorting options. Returns the same rich product search data as search-products but with additional filtering capabilities including: optional search query text, category code filtering to narrow by category, price range filtering (minimum and maximum price bounds), custom sorting options, and pagination controls. Returns paginated product results with detailed product information (code, name, price, images, stock status), facet data for further refinement, pagination metadata, available sort options, and current query context. Use this when you need more precise product filtering beyond basic text search, such as finding products within a specific category and price range.",
    {
        query: z.string().optional().describe("Search query for products"),
        categoryCode: z.string().optional().describe("Category code to filter products"),
        minPrice: z.number().optional().describe("Minimum price filter"),
        maxPrice: z.number().optional().describe("Maximum price filter"),
        sort: z.string().optional().describe("Sort order (e.g., 'name:asc', 'price:desc')"),
        currentPage: z.number().optional().describe("Page number (starts from 0)"),
        pageSize: z.number().optional().describe("Number of products per page"),
    },
    async ({ query, categoryCode, minPrice, maxPrice, sort, currentPage, pageSize }: {
        query?: string;
        categoryCode?: string;
        minPrice?: number;
        maxPrice?: number;
        sort?: string;
        currentPage?: number;
        pageSize?: number;
    }) => {
        try {
            const searchOptions = {
                query,
                categoryCode,
                priceRange: (minPrice || maxPrice) ? {
                    min: minPrice,
                    max: maxPrice
                } : undefined,
                sort,
                currentPage,
                pageSize
            };

            const results = await sapCommerceService.searchProductsAdvanced(searchOptions);
            // Return complete SAP Commerce search results
            return {
                content: [{ type: "text", text: formatResponse(results) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-product-suggestions",
    "Get search term suggestions for autocomplete functionality. Returns an array of suggested search terms based on partial text input. Each suggestion contains a value field with the recommended search term (e.g., typing 'ca' suggests 'catalogue', 'cameras', 'camera', 'canon', 'card'). Useful for implementing search box autocomplete features, helping users discover products by suggesting relevant search terms as they type. Optionally specify maximum number of suggestions to return.",
    {
        term: z.string().describe("Partial search term to get suggestions for"),
        maxResults: z.number().optional().describe("Maximum number of suggestions to return"),
    },
    async ({ term, maxResults }: {
        term: string;
        maxResults?: number;
    }) => {
        try {
            const suggestions = await sapCommerceService.getProductSuggestions(term, {
                maxResults
            });

            return {
                content: [{
                    type: "text",
                    text: formatResponse(suggestions)
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "create-cart",
    "Create a new shopping cart",
    {
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ userAccessToken }: { userAccessToken?: string }) => {
        try {
            const cart = await sapCommerceService.createCart(userAccessToken);
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "New cart created successfully",
                        cartId: cart.code,
                        totalItems: cart.totalItems,
                        totalPrice: cart.totalPrice?.formattedValue
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-cart",
    "Get cart details",
    {
        cartId: z.string().describe("Cart ID to retrieve"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, userAccessToken }: { cartId: string; userAccessToken?: string }) => {
        try {
            const cart = await sapCommerceService.getCart(cartId, userAccessToken);
            return {
                content: [{ type: "text", text: formatResponse(cart) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "add-to-cart",
    "Add a product to cart",
    {
        cartId: z.string().describe("Cart ID to add the product to"),
        productCode: z.string().describe("Product code to add"),
        quantity: z.number().optional().describe("Quantity to add (default: 1)"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, productCode, quantity = 1, userAccessToken }: {
        cartId: string;
        productCode: string;
        quantity?: number;
        userAccessToken?: string;
    }) => {
        try {
            let cart;
            try {
                // First try to get the cart to check if it exists
                await sapCommerceService.getCart(cartId, userAccessToken);
                // If cart exists, add the product
                cart = await sapCommerceService.addToCart(cartId, productCode, quantity, userAccessToken);
            } catch (cartError) {
                // If cart doesn't exist, create a new one
                console.error(`Cart ${cartId} not found, creating a new cart`);
                const newCart = await sapCommerceService.createCart(userAccessToken);
                // Then add the product to the new cart
                if (!newCart.guid) {
                    throw new Error("New cart GUID is undefined");
                }
                cart = await sapCommerceService.addToCart(newCart.guid, productCode, quantity, userAccessToken);
            }

            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Product added to cart successfully",
                        cartId: cart.code,
                        totalItems: cart.totalItems,
                        totalPrice: cart.totalPrice?.formattedValue,
                        lastAddedItem: cart.entries && cart.entries.length > 0 ? cart.entries[cart.entries.length - 1] : null
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "update-cart-entry",
    "Update the quantity of a product in cart",
    {
        cartId: z.string().describe("Cart ID"),
        entryNumber: z.number().describe("Entry number of the product in cart"),
        quantity: z.number().describe("New quantity"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, entryNumber, quantity, userAccessToken }: {
        cartId: string;
        entryNumber: number;
        quantity: number;
        userAccessToken?: string;
    }) => {
        try {
            const cart = await sapCommerceService.updateCartEntry(cartId, entryNumber, quantity, userAccessToken);
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Cart entry updated successfully",
                        cartId: cart.code,
                        totalItems: cart.totalItems,
                        totalPrice: cart.totalPrice?.formattedValue
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "remove-from-cart",
    "Remove a product from cart",
    {
        cartId: z.string().describe("Cart ID"),
        entryNumber: z.number().describe("Entry number of the product to remove"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, entryNumber, userAccessToken }: {
        cartId: string;
        entryNumber: number;
        userAccessToken?: string;
    }) => {
        try {
            await sapCommerceService.removeCartEntry(cartId, entryNumber, userAccessToken);
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Product removed from cart successfully",
                        cartId
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "set-delivery-address",
    "Set the delivery address for a cart. This is a required step before placing an order.",
    {
        cartId: z.string().describe("Cart ID"),
        address: z.object({
            title: z.string().optional().describe("Title (e.g., 'Mr.', 'Mrs.', 'Ms.', 'Dr.')"),
            titleCode: z.string().optional().describe("Title code (mr, mrs, ms, dr, etc.) - defaults to 'mr' if not provided"),
            firstName: z.string().describe("First name"),
            lastName: z.string().describe("Last name"),
            companyName: z.string().optional().describe("Company name"),
            line1: z.string().describe("Address line 1"),
            line2: z.string().optional().describe("Address line 2"),
            town: z.string().describe("City/Town"),
            postalCode: z.string().describe("Postal/ZIP code"),
            country: z.object({
                isocode: z.string().describe("Country ISO code (e.g., 'US', 'GB', 'DE')"),
                name: z.string().optional().describe("Country name (e.g., 'United States')")
            }).describe("Country information"),
            region: z.object({
                isocode: z.string().optional().describe("Region/State ISO code (e.g., 'US-NY') - optional if name is provided"),
                name: z.string().optional().describe("Region/State name (e.g., 'New York') - optional if isocode is provided"),
                countryIso: z.string().optional().describe("Country ISO code for the region")
            }).optional().describe("Region/State information - provide either isocode or name, the system will look up the missing field"),
            phone: z.string().optional().describe("Phone number"),
            email: z.string().optional().describe("Email address")
        }).describe("Delivery address details"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, address, userAccessToken }: {
        cartId: string;
        address: any;
        userAccessToken?: string;
    }) => {
        try {
            console.error('📥 MCP Server received address:', JSON.stringify(address, null, 2));

            // Ensure titleCode has a default value
            const titleCode = address.titleCode || 'mr';

            // Map titleCode to title if title is not provided
            const titleMap: Record<string, string> = {
                'mr': 'Mr.',
                'mrs': 'Mrs.',
                'ms': 'Ms.',
                'miss': 'Miss',
                'dr': 'Dr.',
                'rev': 'Rev.'
            };
            const title = address.title || titleMap[titleCode.toLowerCase()] || 'Mr.';

            // Enrich country with name if missing
            let country = address.country || {};
            if (!country.name && country.isocode) {
                const countryData = await sapCommerceService.getCountryByIsocode(country.isocode);
                if (countryData) {
                    country = {
                        isocode: country.isocode,
                        name: countryData.name
                    };
                }
            }

            // Enrich region with name and countryIso if missing
            let region = address.region;
            if (region) {
                if (region.isocode && (!region.name || !region.countryIso)) {
                    // Have isocode, look up name
                    const regionData = await sapCommerceService.getRegionByIsocode(
                        country.isocode,
                        region.isocode
                    );
                    if (regionData) {
                        region = {
                            isocode: region.isocode,
                            name: regionData.name,
                            countryIso: regionData.countryIso
                        };
                    }
                } else if (region.name && !region.isocode) {
                    // Have name only, look up isocode
                    const regionData = await sapCommerceService.getRegionByName(
                        country.isocode,
                        region.name
                    );
                    if (regionData) {
                        region = {
                            isocode: regionData.isocode,
                            name: regionData.name,
                            countryIso: regionData.countryIso
                        };
                    }
                }
            }

            // Build complete address with all fields
            const completeAddress = {
                ...address,
                title,
                titleCode,
                country,
                ...(region && { region })
            };

            console.error('📤 MCP Server sending complete address:', JSON.stringify(completeAddress, null, 2));

            const cart = await sapCommerceService.setDeliveryAddress(cartId, completeAddress, userAccessToken);
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Delivery address set successfully",
                        cartId: cart.code,
                        totalItems: cart.totalItems,
                        totalPrice: cart.totalPrice?.formattedValue
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-delivery-modes",
    "Get available delivery/shipping modes for a cart. Call this after setting the delivery address to see available shipping options.",
    {
        cartId: z.string().describe("Cart ID"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, userAccessToken }: {
        cartId: string;
        userAccessToken?: string;
    }) => {
        try {
            const deliveryModes = await sapCommerceService.getDeliveryModes(cartId, userAccessToken);
            // Return complete delivery modes with a helpful message
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Available delivery modes retrieved successfully",
                        deliveryModes: deliveryModes
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "set-delivery-mode",
    "Set the delivery/shipping mode for a cart. This is a required step before placing an order. Use get-delivery-modes first to see available options.",
    {
        cartId: z.string().describe("Cart ID"),
        deliveryModeCode: z.string().describe("Delivery mode code (e.g., 'standard-gross', 'premium-gross')"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, deliveryModeCode, userAccessToken }: {
        cartId: string;
        deliveryModeCode: string;
        userAccessToken?: string;
    }) => {
        try {
            const cart = await sapCommerceService.setDeliveryMode(cartId, deliveryModeCode, userAccessToken);
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Delivery mode set successfully",
                        cartId: cart.code,
                        totalItems: cart.totalItems,
                        totalPrice: cart.totalPrice?.formattedValue
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "set-payment-details",
    "Set payment details for a cart. This is a required step before placing an order.",
    {
        cartId: z.string().describe("Cart ID"),
        paymentDetails: z.object({
            accountHolderName: z.string().describe("Cardholder name"),
            cardNumber: z.string().describe("Credit/debit card number"),
            cardType: z.object({
                code: z.string().describe("Card type code (e.g., 'visa', 'master', 'amex')")
            }).describe("Card type information"),
            expiryMonth: z.string().describe("Expiry month (MM format, e.g., '12')"),
            expiryYear: z.string().describe("Expiry year (YYYY format, e.g., '2025')"),
            cvv: z.string().optional().describe("CVV/Security code"),
            saved: z.boolean().optional().describe("Save payment details for future use"),
            defaultPayment: z.boolean().optional().describe("Set as default payment method"),
            billingAddress: z.object({
                firstName: z.string().describe("First name"),
                lastName: z.string().describe("Last name"),
                line1: z.string().describe("Address line 1"),
                line2: z.string().optional().describe("Address line 2"),
                town: z.string().describe("City/Town"),
                postalCode: z.string().describe("Postal/ZIP code"),
                country: z.object({
                    isocode: z.string().describe("Country ISO code (e.g., 'US', 'GB', 'DE')")
                }).describe("Country information"),
                region: z.object({
                    isocode: z.string().describe("Region/State ISO code")
                }).optional().describe("Region/State information"),
                phone: z.string().optional().describe("Phone number"),
                email: z.string().optional().describe("Email address")
            }).describe("Billing address")
        }).describe("Payment details"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (optional for authenticated users)"),
    },
    async ({ cartId, paymentDetails, userAccessToken }: {
        cartId: string;
        paymentDetails: any;
        userAccessToken?: string;
    }) => {
        try {
            const cart = await sapCommerceService.setPaymentDetails(cartId, paymentDetails, userAccessToken);
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Payment details set successfully",
                        cartId: cart.code,
                        totalItems: cart.totalItems,
                        totalPrice: cart.totalPrice?.formattedValue
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-order-status",
    "Get the status of a specific order. Requires user authentication.",
    {
        orderCode: z.string().describe("Order code to check status for"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (required for authenticated users)"),
    },
    async ({ orderCode, userAccessToken }: { orderCode: string; userAccessToken?: string }) => {
        try {
            const order = await sapCommerceService.getOrderStatus(orderCode, userAccessToken);
            // Return the complete SAP Commerce order response - let Claude extract what it needs
            return {
                content: [{
                    type: "text",
                    text: formatResponse(order)
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "get-order-history",
    "Get order history for the authenticated user. Requires user authentication.",
    {
        currentPage: z.number().optional().describe("Page number (starts from 0)"),
        pageSize: z.number().optional().describe("Number of orders per page"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (required for authenticated users)"),
    },
    async ({ currentPage, pageSize, userAccessToken }: {
        currentPage?: number;
        pageSize?: number;
        userAccessToken?: string;
    }) => {
        try {
            const history = await sapCommerceService.getOrderHistory(currentPage, pageSize, userAccessToken);
            // Return the complete SAP Commerce order history response
            return {
                content: [{
                    type: "text",
                    text: formatResponse(history)
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "place-order",
    "Place an order from a cart. Converts the cart into an order. Can be used by both authenticated users and anonymous guests.",
    {
        cartId: z.string().describe("Cart ID to convert to order"),
        userAccessToken: z.string().optional().describe("User OAuth access token from Spartacus (for authenticated users). If not provided, creates anonymous order."),
    },
    async ({ cartId, userAccessToken }: { cartId: string; userAccessToken?: string }) => {
        try {
            const order = await sapCommerceService.placeOrder(cartId, userAccessToken);
            // Return complete order response
            return {
                content: [{
                    type: "text",
                    text: formatResponse({
                        message: "Order placed successfully",
                        order: order
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

server.tool(
    "check-service-health",
    "Check the health status of the SAP Commerce integration",
    {},
    async () => {
        try {
            const status = await sapCommerceService.getHealthStatus();
            return {
                content: [{ 
                    type: "text", 
                    text: formatResponse({
                        status: status.status,
                        lastCheck: status.lastCheck,
                        metrics: {
                            apiLatency: `${status.details.apiLatency}ms`,
                            errorRate: `${(status.details.errorRate || 0) * 100}%`,
                            cacheHitRate: `${(status.details.cacheHitRate || 0) * 100}%`
                        }
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

// Initialize metrics analyzer
const metricsAnalyzer = new MetricsAnalyzer('logs');

// Add new performance analysis tool after existing tools
server.tool(
    "analyze-performance",
    "Analyze historical performance metrics and get insights",
    {
        timeRangeHours: z.number().optional().describe("Number of hours to analyze (default: 24)"),
    },
    async ({ timeRangeHours = 24 }: { timeRangeHours?: number }) => {
        try {
            const now = new Date();
            const analysis = await metricsAnalyzer.analyzeHealthMetrics({
                start: new Date(now.getTime() - (timeRangeHours * 60 * 60 * 1000)),
                end: now
            });

            const insights = await metricsAnalyzer.getPerformanceInsights();

            return {
                content: [{ 
                    type: "text", 
                    text: formatResponse({
                        timeRange: {
                            start: analysis.period.start,
                            end: analysis.period.end,
                            hours: timeRangeHours
                        },
                        metrics: {
                            apiLatency: {
                                p95: `${analysis.apiLatency.p95}ms`,
                                average: `${analysis.apiLatency.avg}ms`,
                                max: `${analysis.apiLatency.max}ms`
                            },
                            errorRate: {
                                average: `${(analysis.errorRate.avg * 100).toFixed(2)}%`,
                                max: `${(analysis.errorRate.max * 100).toFixed(2)}%`
                            },
                            cacheHitRate: {
                                average: `${(analysis.cacheHitRate.avg * 100).toFixed(2)}%`,
                                min: `${(analysis.cacheHitRate.min * 100).toFixed(2)}%`
                            }
                        },
                        insights,
                        recommendations: insights.length > 0 
                            ? "Action needed: Review the insights above and implement suggested improvements."
                            : "No critical issues detected. System is performing within acceptable parameters."
                    })
                }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: formatError(error) }],
            };
        }
    }
);

// Register Resources
server.resource(
    "Product Catalog",
    "catalog://products",
    {
        description: "Complete product catalog from SAP Commerce (all products)",
        mimeType: "application/json"
    },
    async () => {
        try {
            // First, get the first page to determine total count
            const pageSize = 100;
            const firstPage = await sapCommerceService.searchProducts('', 0, pageSize);

            const totalResults = firstPage.pagination.totalResults;
            const totalPages = Math.ceil(totalResults / pageSize);

            // Collect all products starting with first page
            let allProducts = [...firstPage.products];

            // Fetch remaining pages if there are more
            if (totalPages > 1) {
                const pagePromises = [];
                for (let page = 1; page < totalPages; page++) {
                    pagePromises.push(
                        sapCommerceService.searchProducts('', page, pageSize)
                    );
                }

                const remainingPages = await Promise.all(pagePromises);
                for (const pageData of remainingPages) {
                    allProducts.push(...pageData.products);
                }
            }

            // Return all products with metadata
            const result = {
                totalProducts: totalResults,
                products: allProducts,
                metadata: {
                    fetchedAt: new Date().toISOString(),
                    totalPages,
                    pageSize
                }
            };

            return {
                contents: [{
                    uri: "catalog://products",
                    mimeType: "application/json",
                    text: JSON.stringify(result, null, 2)
                }]
            };
        } catch (error) {
            throw new Error(`Failed to read product catalog: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
);

server.resource(
    "Category Tree",
    "catalog://categories",
    {
        description: "Complete category hierarchy from SAP Commerce",
        mimeType: "application/json"
    },
    async () => {
        try {
            const categories = await sapCommerceService.getCategories();
            return {
                contents: [{
                    uri: "catalog://categories",
                    mimeType: "application/json",
                    text: JSON.stringify(categories, null, 2)
                }]
            };
        } catch (error) {
            throw new Error(`Failed to read categories: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
);

server.resource(
    "Active Promotions",
    "catalog://promotions",
    {
        description: "All active promotions and deals from SAP Commerce",
        mimeType: "application/json"
    },
    async () => {
        try {
            const promotions = await sapCommerceService.getPromotions();
            return {
                contents: [{
                    uri: "catalog://promotions",
                    mimeType: "application/json",
                    text: JSON.stringify(promotions, null, 2)
                }]
            };
        } catch (error) {
            throw new Error(`Failed to read promotions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
);

server.resource(
    "Site Configuration",
    "config://site",
    {
        description: "Current site configuration including base site, languages, currencies, and features",
        mimeType: "application/json"
    },
    async () => {
        try {
            const configuration = {
                baseSite: config.baseSite,
                baseUrl: config.baseUrl,
                availableLanguages: ['en', 'de', 'ja', 'zh'],
                availableCurrencies: ['USD', 'EUR', 'JPY'],
                features: {
                    cart: true,
                    wishlist: true,
                    quickOrder: true,
                    savedCart: true,
                    checkout: true,
                    storeLocator: true,
                    productReviews: true,
                    productSuggestions: true,
                    orderTracking: true,
                    promotions: true
                },
                timeout: config.timeout,
                version: '1.0.0'
            };

            return {
                contents: [{
                    uri: "config://site",
                    mimeType: "application/json",
                    text: JSON.stringify(configuration, null, 2)
                }]
            };
        } catch (error) {
            throw new Error(`Failed to read site configuration: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
);

server.resource(
    "Product Details",
    new ResourceTemplate("product://{productCode}", {
        list: undefined // We don't enumerate all products via templates
    }),
    {
        description: "Detailed information for a specific product by product code (e.g., product://1234567)",
        mimeType: "application/json"
    },
    async (uri: URL, variables: Variables) => {
        const productCode = variables.productCode as string;
        try {
            const product = await sapCommerceService.getProductDetails(productCode);
            return {
                contents: [{
                    uri: uri.toString(),
                    mimeType: "application/json",
                    text: JSON.stringify(product, null, 2)
                }]
            };
        } catch (error) {
            throw new Error(`Failed to read product ${productCode}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
);

// Initialize and run the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`SAP Commerce MCP Server running on stdio (Site: ${config.baseSite})`);
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
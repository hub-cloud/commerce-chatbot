import { v4 as uuidv4 } from 'uuid';
import { ChatMessage, ChatRequest, ChatResponse, Product } from '../types/index.js';
import { ConversationManager } from './ConversationManager.js';
import { MCPClient } from './MCPClient.js';
import { ProviderFactory } from './providers/ProviderFactory.js';

export class ChatService {
  private conversationManager: ConversationManager;
  private mcpClient: MCPClient;
  private cartsByConversation: Map<string, string>; // conversationId -> cartId
  private deliveryModesByConversation: Map<string, any[]>; // conversationId -> deliveryModes
  private lastOrderCodeByConversation: Map<string, string>; // conversationId -> orderCode

  constructor(mcpServerPath: string) {
    this.conversationManager = new ConversationManager();
    this.mcpClient = new MCPClient(mcpServerPath);
    this.cartsByConversation = new Map();
    this.deliveryModesByConversation = new Map();
    this.lastOrderCodeByConversation = new Map();
  }

  async initialize(): Promise<void> {
    await this.mcpClient.connect();
  }

  async handleChatMessage(request: ChatRequest): Promise<ChatResponse> {
    // Get or create conversation
    let conversationId = request.conversationId;
    if (!conversationId) {
      const conversation = this.conversationManager.createConversation(request.userId);
      conversationId = conversation.id;
    }

    // Get auth status
    const isAuthenticated = request.isAuthenticated || false;
    const userId = request.userId || 'anonymous';

    // Add user message to conversation
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: request.message,
      timestamp: new Date()
    };
    this.conversationManager.addMessage(conversationId, userMessage);

    // Get conversation history
    const messages = this.conversationManager.getMessages(conversationId);

    // Get AI provider
    const providerType = request.provider || (process.env.DEFAULT_AI_PROVIDER as any) || 'claude';
    const provider = ProviderFactory.getProvider(providerType);

    // Define MCP tools for LLM (filter based on auth)
    const tools = this.getMCPToolDefinitions(isAuthenticated);

    // Get cached resources for context
    const categories = this.mcpClient.getCachedResource('catalog://categories');
    const siteConfig = this.mcpClient.getCachedResource('config://site');

    // Build system prompt with resource context
    let systemPrompt = `You are a specialized SAP Commerce assistant. Your ONLY purpose is to help customers with e-commerce tasks.

## User Context:
- User ID: ${userId}
- Authentication Status: ${isAuthenticated ? 'LOGGED IN' : 'ANONYMOUS (NOT LOGGED IN)'}
${isAuthenticated ? '- User can access personalized features like order history, saved carts, and account management' : '- User can only browse products and categories. Suggest logging in for personalized features.'}

## Your Responsibilities:
- Help customers find and browse products
- Answer questions about product availability, prices, and specifications
- Help customers add products to their shopping cart (both anonymous and logged-in users)
- Manage cart items (add, update quantities, remove items)
- Guide customers through checkout conversationally:
  * Create carts automatically when users want to add items
  * When address info is provided, use set-delivery-address tool
  * After setting address, automatically call get-delivery-modes to show shipping options
  * When user selects a shipping method, use set-delivery-mode tool
  * When card details are provided, use set-payment-details to save them
  * Use place-order only after: delivery address + shipping method + payment details are all set
${isAuthenticated ? '- Access and manage user-specific orders and order history\n- Help manage user shopping carts and saved items\n- Complete order placement' : '- Create anonymous shopping carts for guest users\n- Inform users they need to log in to access order history'}
- Provide information about categories and promotions

## IMPORTANT: Tool Usage Rules - READ CAREFULLY
- When user provides address information → IMMEDIATELY use set-delivery-address tool (don't just acknowledge, actually call the tool)
- After EVERY set-delivery-address call → IMMEDIATELY and AUTOMATICALLY call get-delivery-modes (do not wait for user)
- When user selects shipping method (e.g., user says "standard", "express", "premium"):
  * Step 1: Look back at get-delivery-modes results in conversation history
  * Step 2: Find the delivery mode where name/code matches user's choice
  * Step 3: Extract the "code" field (e.g., "standard-gross")
  * Step 4: IMMEDIATELY call set-delivery-mode tool with that exact code
- When user provides payment info → IMMEDIATELY use set-payment-details tool
- NEVER just respond with text when a tool should be used - you must actually call the tool to make changes in the system

## ⚠️ COMMON MISTAKES TO AVOID:
❌ WRONG: User says "standard delivery" → You respond "Standard Delivery has been selected" (NO TOOL CALL)
✅ CORRECT: User says "standard delivery" → Look at get-delivery-modes results → Find code "standard-gross" → Call set-delivery-mode(deliveryModeCode: "standard-gross") → THEN say "Standard Delivery has been set"

❌ WRONG: Setting address without immediately calling get-delivery-modes
✅ CORRECT: After set-delivery-address, automatically call get-delivery-modes to fetch shipping options

❌ WRONG: Calling set-delivery-mode with "standard" (user's text)
✅ CORRECT: Calling set-delivery-mode with "standard-gross" (exact code from get-delivery-modes)

**Remember: Text responses do NOT save data. You MUST use tools to make actual changes in the system.**

## Checkout Technical Requirements:
For an order to succeed, you MUST ensure these are set (in any conversational order):
  1. Cart has items
  2. Delivery address is set
  3. Shipping/delivery mode is selected
  4. Payment details are saved
Then call place-order. Missing any of these will cause the order to fail.

## STRICT RULES - You MUST follow these:
1. ONLY answer questions related to products, orders, cart, categories, and shopping
2. REFUSE to answer questions about:
   - Writing code or scripts
   - Creating websites or applications
   - General knowledge (history, science, math, etc.)
   - Political, religious, or controversial topics
   - Medical or legal advice
   - Personal advice or counseling
   - Anything not directly related to SAP Commerce shopping

3. If asked an off-topic question, politely redirect:
   "I'm a commerce assistant specialized in helping you shop. I can help you find products, check availability, view promotions, and manage orders. How can I assist you with shopping today?"

## Available Tools:
- search-products: Search for products by query
- get-product-details: Get detailed information about a specific product
- check-product-availability: Check if a product is in stock
- get-categories: Get product categories
- get-promotions: Get current promotions and deals

Use these tools whenever customers ask about products.
Always include product codes when referencing specific products.
Be concise, helpful, and friendly - but stay strictly within the commerce domain.`;

    // Add catalog context from resources
    if (categories) {
      systemPrompt += `\n\n## Available Categories:\n${JSON.stringify(categories, null, 2)}`;
    }

    if (siteConfig) {
      systemPrompt += `\n\n## Site Configuration:\n${JSON.stringify(siteConfig, null, 2)}`;
    }

    console.log('\n' + '─'.repeat(80));
    console.log('🤖 CALLING AI PROVIDER: ' + provider.name.toUpperCase());
    console.log('─'.repeat(80));
    console.log('Model:', process.env.CLAUDE_MODEL || 'default');
    console.log('🔐 User ID:', userId);
    console.log('🔐 Authenticated:', isAuthenticated ? 'YES' : 'NO');
    console.log('Tools Available:', tools.length);
    console.log('Resources Loaded:', [
      categories ? 'categories' : null,
      siteConfig ? 'siteConfig' : null
    ].filter(Boolean));
    console.log('Conversation ID:', conversationId);
    console.log('Messages Count:', messages.slice(-10).length);
    console.log('\n📝 FULL CONVERSATION HISTORY (last 10 messages):');
    messages.slice(-10).forEach((msg, idx) => {
      const contentPreview = typeof msg.content === 'string'
        ? msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
        : '[Tool use message]';
      console.log(`  ${idx + 1}. [${msg.role.toUpperCase()}]: ${contentPreview}`);
    });
    console.log('\n💬 Current User Message:', request.message);
    console.log('─'.repeat(80));

    // Extract and track order codes from conversation history
    const recentMessages = messages.slice(-5); // Last 5 messages
    for (const msg of recentMessages) {
      if (typeof msg.content === 'string') {
        const orderMatch = msg.content.match(/\b(\d{8})\b/);
        if (orderMatch) {
          this.lastOrderCodeByConversation.set(conversationId, orderMatch[1]);
          console.log(`📋 Tracked order code ${orderMatch[1]} in conversation`);
        }
      }
    }

    // Detect if user is asking about a specific order and force tool use
    const currentMessageOrderCode = request.message.match(/\b(\d{8})\b/);
    const lastOrderCode = this.lastOrderCodeByConversation.get(conversationId);
    let toolChoice: any = { type: 'auto' }; // Let LLM decide by default

    // Check if user is asking about orders
    const lowerMessage = request.message.toLowerCase();
    const isOrderInquiry = lowerMessage.includes('order') ||
                          lowerMessage.includes('detail') ||
                          lowerMessage.includes('status') ||
                          lowerMessage.includes('show') ||
                          lowerMessage.includes('tell') ||
                          lowerMessage.includes('yes');

    // Force tool use if:
    // 1. User mentions a specific order code, OR
    // 2. User is following up on a previous order discussion
    if (request.isAuthenticated && isOrderInquiry) {
      const orderCodeToUse = currentMessageOrderCode?.[1] || lastOrderCode;

      if (orderCodeToUse) {
        console.log(`🔍 Detected order inquiry for order ${orderCodeToUse}, forcing get-order-status tool use`);
        toolChoice = {
          type: 'tool',
          name: 'get-order-status'
        };
      }
    }

    // Call AI provider with tools
    let aiResponse = await provider.sendMessage(
      messages.slice(-10), // Last 10 messages for context
      systemPrompt,
      tools,
      toolChoice
    );

    // Handle tool calls
    let toolsUsed: string[] = [];
    let products: Product[] = [];

    if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
      console.log('\n🔧 LLM WANTS TO USE TOOLS:');
      console.log('Tool Calls:', JSON.stringify(aiResponse.toolCalls, null, 2));

      // Execute tool calls with user access token if available
      const toolResults = await this.executeMCPTools(aiResponse.toolCalls, conversationId, request.userAccessToken);
      toolsUsed = aiResponse.toolCalls.map((tc: any) => tc.name);

      // Parse products from tool results
      for (const result of toolResults) {
        if (result.products) {
          products.push(...result.products);
        }
      }

      console.log('✅ Tool Execution Complete. Products Found:', products.length);

      // Auto-trigger place-order after successful set-payment-details
      // This completes the checkout flow programmatically
      if (toolsUsed.includes('set-payment-details') && aiResponse.toolCalls) {
        const paymentResult = toolResults.find((r: any) =>
          aiResponse.toolCalls!.find((tc: any) => tc.id === r.tool_use_id && tc.name === 'set-payment-details')
        );

        if (paymentResult && !paymentResult.error) {
          console.log('\n🔄 AUTO-TRIGGERING place-order after successful payment setup...');

          const placeOrderCall = {
            id: uuidv4(),
            type: 'tool_use',
            name: 'place-order',
            input: {}
          };

          const placeOrderResults = await this.executeMCPTools([placeOrderCall], conversationId, request.userAccessToken);

          // Add to tool calls and results
          aiResponse.toolCalls.push(placeOrderCall);
          toolResults.push(...placeOrderResults);
          toolsUsed.push('place-order');

          console.log('✅ Auto-triggered place-order successfully');
        }
      }

      // Auto-trigger get-delivery-modes after successful set-delivery-address
      // This enforces the checkout flow programmatically instead of relying on LLM
      if (toolsUsed.includes('set-delivery-address') && aiResponse.toolCalls) {
        const addressResult = toolResults.find((r: any) =>
          aiResponse.toolCalls!.find((tc: any) => tc.id === r.tool_use_id && tc.name === 'set-delivery-address')
        );

        if (addressResult && !addressResult.error) {
          console.log('\n🔄 AUTO-TRIGGERING get-delivery-modes after successful address setup...');

          const deliveryModesCall = {
            id: uuidv4(),
            type: 'tool_use',
            name: 'get-delivery-modes',
            input: {}
          };

          const deliveryModesResults = await this.executeMCPTools([deliveryModesCall], conversationId, request.userAccessToken);

          // Add to tool calls and results
          aiResponse.toolCalls.push(deliveryModesCall);
          toolResults.push(...deliveryModesResults);
          toolsUsed.push('get-delivery-modes');

          // Store delivery modes for later use
          this.storeDeliveryModes(conversationId, deliveryModesResults);

          console.log('✅ Auto-triggered get-delivery-modes successfully');
        }
      }

      // Call LLM again with tool results
      // Build the assistant message content (text + tool_use blocks)
      // Only include text block if there's actual content (Anthropic requires non-empty text blocks)
      const assistantContent: any[] = [];
      if (aiResponse.content) {
        assistantContent.push({ type: 'text', text: aiResponse.content });
      }
      assistantContent.push(...aiResponse.toolCalls);

      const messagesWithToolResults = [
        ...messages.slice(-10),
        {
          id: uuidv4(),
          role: 'assistant' as const,
          content: assistantContent, // Array of text and tool_use blocks
          timestamp: new Date()
        },
        {
          id: uuidv4(),
          role: 'user' as const,
          content: toolResults.map((result: any) => ({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: JSON.stringify(result.content || result.error)
          })),
          timestamp: new Date()
        }
      ];

      aiResponse = await provider.sendMessage(messagesWithToolResults, systemPrompt);
    }

    console.log('\n' + '─'.repeat(80));
    console.log('✅ AI RESPONSE RECEIVED');
    console.log('─'.repeat(80));
    console.log('Tokens Used:', aiResponse.tokensUsed);
    console.log('Response Length:', aiResponse.content.length);
    console.log('Response Preview:', aiResponse.content.substring(0, 200) + '...');
    console.log('─'.repeat(80) + '\n');

    // Ensure content is never empty (Anthropic API requirement)
    const responseContent = aiResponse.content || 'Processing your request...';

    if (!aiResponse.content) {
      console.log('⚠️  WARNING: LLM returned empty content, using default message');
    }

    // Create assistant message
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: responseContent,
      timestamp: new Date(),
      metadata: {
        products: products.length > 0 ? products : undefined,
        mcpToolsUsed: toolsUsed,
        tokensUsed: aiResponse.tokensUsed,
        provider: provider.name
      }
    };

    this.conversationManager.addMessage(conversationId, assistantMessage);

    return {
      conversationId,
      message: responseContent,
      metadata: {
        productsFound: products.length,
        mcpToolsUsed: toolsUsed,
        tokensUsed: aiResponse.tokensUsed,
        provider: provider.name
      }
    };
  }

  private async getMCPContext(message: string): Promise<{
    productsFound: Product[];
    toolsUsed: string[];
    rawData?: any;
  }> {
    const lowerMessage = message.toLowerCase();
    const productsFound: Product[] = [];
    const toolsUsed: string[] = [];
    let rawData: any = null;

    console.log('\n' + '─'.repeat(80));
    console.log('🔍 ANALYZING MESSAGE FOR MCP QUERIES');
    console.log('─'.repeat(80));
    console.log('Message:', message);

    // Detect if user is asking about products
    if (
      lowerMessage.includes('camera') ||
      lowerMessage.includes('webcam') ||
      lowerMessage.includes('product') ||
      lowerMessage.includes('show me') ||
      lowerMessage.includes('find') ||
      lowerMessage.includes('search') ||
      lowerMessage.includes('looking for') ||
      lowerMessage.includes('list') ||
      lowerMessage.includes('what') ||
      lowerMessage.includes('do you have') ||
      lowerMessage.includes('available')
    ) {
      try {
        // Extract search query
        const searchQuery = this.extractSearchQuery(message);
        console.log('\n🔧 MCP TOOL CALL: search-products');
        console.log('Query:', searchQuery);
        console.log('Page Size: 5');

        const result = await this.mcpClient.searchProducts(searchQuery, 5);
        toolsUsed.push('search-products');

        console.log('\n📦 MCP RESPONSE:');
        console.log('Is Error:', result.isError);
        console.log('Content:', JSON.stringify(result.content, null, 2).substring(0, 500) + '...');

        if (result.content && !result.isError) {
          rawData = result.content;
          // Parse products from MCP response
          const parsed = this.parseProducts(result.content);
          productsFound.push(...parsed);
          console.log('✅ Parsed Products:', parsed.length);
        }
      } catch (error) {
        console.error('❌ Error querying MCP:', error);
      }
    }

    // Check for promotions
    if (lowerMessage.includes('promotion') || lowerMessage.includes('deal') || lowerMessage.includes('sale')) {
      try {
        console.log('\n🔧 MCP TOOL CALL: get-promotions');

        const result = await this.mcpClient.getPromotions();
        toolsUsed.push('get-promotions');
        rawData = result.content;

        console.log('\n📦 MCP RESPONSE:');
        console.log('Is Error:', result.isError);
        console.log('Content:', JSON.stringify(result.content, null, 2).substring(0, 500) + '...');
      } catch (error) {
        console.error('❌ Error getting promotions:', error);
      }
    }

    console.log('\n✅ MCP Context Summary:');
    console.log('   Products Found:', productsFound.length);
    console.log('   Tools Used:', toolsUsed);
    console.log('─'.repeat(80) + '\n');

    return { productsFound, toolsUsed, rawData };
  }

  private extractSearchQuery(message: string): string {
    // Simple extraction - can be improved with NLP
    const keywords = [
      'webcam', 'camera', 'lens', 'battery', 'charger', 'tripod',
      'card', 'sd', 'memory', 'mouse', 'keyboard', 'monitor',
      'headset', 'speaker', 'flash', 'cable'
    ];

    for (const keyword of keywords) {
      if (message.toLowerCase().includes(keyword)) {
        console.log(`🔍 Extracted keyword: "${keyword}" from message`);
        return keyword;
      }
    }

    console.log(`🔍 No specific keyword found, using full message as query`);
    // Default to the whole message
    return message;
  }

  private parseProducts(mcpResponse: any): Product[] {
    const products: Product[] = [];

    try {
      // MCP response might be text content with JSON
      let data = mcpResponse;

      if (Array.isArray(mcpResponse)) {
        data = mcpResponse[0]?.text || mcpResponse[0];
      }

      if (typeof data === 'string') {
        data = JSON.parse(data);
      }

      const productList = data.products || [];

      for (const product of productList.slice(0, 5)) {
        products.push({
          code: product.code,
          name: product.name,
          price: product.price,
          stock: product.stock
        });
      }
    } catch (error) {
      console.error('Error parsing products:', error);
    }

    return products;
  }

  private buildEnrichedContext(message: string, mcpContext: any): string {
    if (mcpContext.productsFound.length === 0 && !mcpContext.rawData) {
      return '';
    }

    let context = '';

    if (mcpContext.productsFound.length > 0) {
      context += `Found ${mcpContext.productsFound.length} products:\n`;
      context += JSON.stringify(mcpContext.productsFound, null, 2);
    }

    return context;
  }

  private getMCPToolDefinitions(isAuthenticated: boolean = false): any[] {
    // Base tools available to all users (authenticated or not)
    const baseTools = [
      {
        name: 'search-products',
        description: 'Search for products in the SAP Commerce catalog by query string. Use this for keyword-based searches.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query (e.g., "camera", "webcam", "tripod")'
            },
            pageSize: {
              type: 'number',
              description: 'Number of products to return (default: 10)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'search-products-advanced',
        description: 'Advanced product search with filtering options. Use this when users ask for products by price range, category, or need sorting. Supports price filters, category filters, and custom sorting.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional search query for product name/description'
            },
            minPrice: {
              type: 'number',
              description: 'Minimum price filter (e.g., 200 for $200)'
            },
            maxPrice: {
              type: 'number',
              description: 'Maximum price filter (e.g., 250 for $250)'
            },
            categoryCode: {
              type: 'string',
              description: 'Category code to filter products (e.g., "cameras", "webcams")'
            },
            sort: {
              type: 'string',
              description: 'Sort order: "price:asc", "price:desc", "name:asc", "name:desc"'
            },
            pageSize: {
              type: 'number',
              description: 'Number of products to return (default: 10)'
            },
            currentPage: {
              type: 'number',
              description: 'Page number (starts from 0)'
            }
          }
        }
      },
      {
        name: 'get-product-details',
        description: 'Get detailed information about a specific product by its product code',
        input_schema: {
          type: 'object',
          properties: {
            productCode: {
              type: 'string',
              description: 'The product code/SKU'
            }
          },
          required: ['productCode']
        }
      },
      {
        name: 'check-product-availability',
        description: 'Check if a product is in stock',
        input_schema: {
          type: 'object',
          properties: {
            productCode: {
              type: 'string',
              description: 'The product code/SKU to check'
            }
          },
          required: ['productCode']
        }
      },
      {
        name: 'get-categories',
        description: 'Get all product categories from the catalog',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get-products-by-category',
        description: 'Get all products in a specific category. Use this when users want to browse products by category.',
        input_schema: {
          type: 'object',
          properties: {
            categoryCode: {
              type: 'string',
              description: 'Category code (e.g., "cameras", "digital-cameras", "webcams")'
            },
            currentPage: {
              type: 'number',
              description: 'Page number (starts from 0)'
            },
            pageSize: {
              type: 'number',
              description: 'Number of products per page (default: 20)'
            },
            sort: {
              type: 'string',
              description: 'Sort order: "relevance", "price:asc", "price:desc", "name:asc", "name:desc"'
            }
          },
          required: ['categoryCode']
        }
      },
      {
        name: 'get-promotions',
        description: 'Get current promotions, deals, and sales',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get-product-reviews',
        description: 'Get customer reviews and ratings for a specific product',
        input_schema: {
          type: 'object',
          properties: {
            productCode: {
              type: 'string',
              description: 'The product code/SKU to get reviews for'
            }
          },
          required: ['productCode']
        }
      },
      {
        name: 'get-product-suggestions',
        description: 'Get search suggestions/autocomplete for a partial search term',
        input_schema: {
          type: 'object',
          properties: {
            term: {
              type: 'string',
              description: 'Partial search term (e.g., "cam" for camera suggestions)'
            },
            max: {
              type: 'number',
              description: 'Maximum number of suggestions to return (default: 5)'
            }
          },
          required: ['term']
        }
      },
      {
        name: 'get-cart',
        description: 'View the current shopping cart for this conversation. Shows all items, quantities, and prices.',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'add-to-cart',
        description: 'Add a product to the shopping cart. Automatically creates a cart if one does not exist for this conversation. Use this when user wants to purchase or add items to cart.',
        input_schema: {
          type: 'object',
          properties: {
            productCode: {
              type: 'string',
              description: 'Product code/SKU to add to cart'
            },
            quantity: {
              type: 'number',
              description: 'Quantity to add (default: 1)'
            }
          },
          required: ['productCode']
        }
      },
      {
        name: 'update-cart-entry',
        description: 'Update the quantity of an item already in the cart. Automatically uses the cart for this conversation.',
        input_schema: {
          type: 'object',
          properties: {
            entryNumber: {
              type: 'number',
              description: 'Entry number of the item in cart (usually 0, 1, 2, etc.)'
            },
            quantity: {
              type: 'number',
              description: 'New quantity for the item'
            }
          },
          required: ['entryNumber', 'quantity']
        }
      },
      {
        name: 'remove-from-cart',
        description: 'Remove an item from the cart completely. Automatically uses the cart for this conversation.',
        input_schema: {
          type: 'object',
          properties: {
            entryNumber: {
              type: 'number',
              description: 'Entry number of the item to remove'
            }
          },
          required: ['entryNumber']
        }
      },
      {
        name: 'set-delivery-address',
        description: 'REQUIRED TOOL: Set the delivery/shipping address for the cart. Use this IMMEDIATELY when user provides address information (name, street, city, state/region, postal code, country). Do not just acknowledge - actually call this tool to save the address to the system.',
        input_schema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Title (e.g., Mr., Mrs., Ms., Dr.) - optional'
            },
            titleCode: {
              type: 'string',
              description: 'Title code (mr, mrs, ms, dr, etc.). Use "mr" as default if not specified.',
              default: 'mr'
            },
            firstName: {
              type: 'string',
              description: 'First name'
            },
            lastName: {
              type: 'string',
              description: 'Last name'
            },
            companyName: {
              type: 'string',
              description: 'Company name - optional'
            },
            line1: {
              type: 'string',
              description: 'Address line 1 (street address)'
            },
            line2: {
              type: 'string',
              description: 'Address line 2 (apartment, suite, etc.) - optional'
            },
            town: {
              type: 'string',
              description: 'City or town'
            },
            postalCode: {
              type: 'string',
              description: 'Postal code / ZIP code'
            },
            countryIsocode: {
              type: 'string',
              description: 'Country ISO code (e.g., US, GB, DE)'
            },
            countryName: {
              type: 'string',
              description: 'Country name (e.g., United States) - optional'
            },
            regionIsocode: {
              type: 'string',
              description: 'State/region ISO code (e.g., US-NY, US-CA) - optional'
            },
            regionName: {
              type: 'string',
              description: 'State/region name (e.g., New York) - optional'
            },
            phone: {
              type: 'string',
              description: 'Phone number - optional'
            },
            email: {
              type: 'string',
              description: 'Email address - optional'
            }
          },
          required: ['firstName', 'lastName', 'line1', 'town', 'postalCode', 'countryIsocode']
        }
      },
      {
        name: 'get-delivery-modes',
        description: 'REQUIRED TOOL: Get available shipping/delivery options for the cart. MUST be called after setting delivery address and before user can select shipping method. Returns delivery mode codes and costs.',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'set-delivery-mode',
        description: 'REQUIRED TOOL: Set the shipping/delivery method for the cart. CRITICAL: When user selects a shipping option (e.g., says "standard", "express", "premium"), you MUST: 1) Look at the get-delivery-modes results from earlier in this conversation, 2) Find the delivery mode where name or code matches what user said, 3) Extract the exact "code" field value (e.g., "standard-gross"), 4) Call THIS tool with that code as deliveryModeCode. DO NOT just say "has been set" without calling this tool - that will NOT actually set the delivery mode in the system.',
        input_schema: {
          type: 'object',
          properties: {
            deliveryModeCode: {
              type: 'string',
              description: 'EXACT delivery mode code from get-delivery-modes results (e.g., "standard-gross", "premium-gross"). Must match exactly what was returned by get-delivery-modes.'
            }
          },
          required: ['deliveryModeCode']
        }
      },
      {
        name: 'set-payment-details',
        description: 'Save payment information for the cart. Call this when user provides credit card details (card number, expiry date, CVV, cardholder name). Payment details must be saved before placing an order.',
        input_schema: {
          type: 'object',
          properties: {
            accountHolderName: {
              type: 'string',
              description: 'Cardholder name'
            },
            cardNumber: {
              type: 'string',
              description: 'Credit/debit card number'
            },
            cardTypeCode: {
              type: 'string',
              description: 'Card type code (visa, master, amex, etc.)'
            },
            expiryMonth: {
              type: 'string',
              description: 'Expiry month (MM format, e.g., "12")'
            },
            expiryYear: {
              type: 'string',
              description: 'Expiry year (YYYY format, e.g., "2025")'
            },
            cvv: {
              type: 'string',
              description: 'CVV/security code - optional'
            },
            billingAddress: {
              type: 'object',
              description: 'Billing address (same format as delivery address)',
              properties: {
                title: { type: 'string', description: 'Title (e.g., Mr., Mrs., Ms., Dr.) - optional' },
                titleCode: { type: 'string', description: 'Title code (mr, mrs, ms, dr, etc.)', default: 'mr' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                companyName: { type: 'string', description: 'Company name - optional' },
                line1: { type: 'string' },
                line2: { type: 'string' },
                town: { type: 'string' },
                postalCode: { type: 'string' },
                countryIsocode: { type: 'string' },
                countryName: { type: 'string', description: 'Country name - optional' },
                regionIsocode: { type: 'string' },
                regionName: { type: 'string', description: 'Region name - optional' },
                phone: { type: 'string' },
                email: { type: 'string' }
              },
              required: ['firstName', 'lastName', 'line1', 'town', 'postalCode', 'countryIsocode']
            }
          },
          required: ['accountHolderName', 'cardNumber', 'cardTypeCode', 'expiryMonth', 'expiryYear', 'billingAddress']
        }
      }
    ];

    // Tools that require authentication
    const authenticatedTools = [
      {
        name: 'place-order',
        description: 'Complete the order and submit it. This finalizes the checkout. Before calling this, ensure the cart has: delivery address set, shipping method selected, and payment details saved. If any are missing, the order will fail. Requires authentication.',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get-order-status',
        description: 'Get the status of a specific order for the logged-in user. Requires authentication.',
        input_schema: {
          type: 'object',
          properties: {
            orderCode: {
              type: 'string',
              description: 'The order code/number to check'
            }
          },
          required: ['orderCode']
        }
      },
      {
        name: 'get-order-history',
        description: 'Get order history for the logged-in user. Requires authentication.',
        input_schema: {
          type: 'object',
          properties: {
            pageSize: {
              type: 'number',
              description: 'Number of orders to return (default: 10)'
            },
            currentPage: {
              type: 'number',
              description: 'Page number (starts from 0)'
            }
          }
        }
      }
    ];

    // Return appropriate tools based on auth status
    if (isAuthenticated) {
      console.log('✅ Including authenticated tools (user is logged in)');
      return [...baseTools, ...authenticatedTools];
    } else {
      console.log('⚠️  Using base tools only (user not logged in)');
      return baseTools;
    }
  }

  private async executeMCPTools(toolCalls: any[], conversationId: string, userAccessToken?: string): Promise<any[]> {
    const results: any[] = [];

    for (const toolCall of toolCalls) {
      console.log(`\n🔧 Executing MCP Tool: ${toolCall.name}`);
      console.log('Arguments:', JSON.stringify(toolCall.input, null, 2));
      if (userAccessToken) {
        console.log('🔐 Using user access token for authenticated request');
      }

      let result: any;

      try {
        switch (toolCall.name) {
          case 'search-products':
            result = await this.mcpClient.searchProducts(
              toolCall.input.query,
              toolCall.input.pageSize || 10
            );
            break;

          case 'search-products-advanced':
            result = await this.mcpClient.searchProductsAdvanced({
              query: toolCall.input.query,
              minPrice: toolCall.input.minPrice,
              maxPrice: toolCall.input.maxPrice,
              categoryCode: toolCall.input.categoryCode,
              sort: toolCall.input.sort,
              pageSize: toolCall.input.pageSize,
              currentPage: toolCall.input.currentPage
            });
            break;

          case 'get-product-details':
            result = await this.mcpClient.getProductDetails(toolCall.input.productCode);
            break;

          case 'check-product-availability':
            result = await this.mcpClient.checkProductAvailability(toolCall.input.productCode);
            break;

          case 'get-categories':
            result = await this.mcpClient.getCategories();
            break;

          case 'get-products-by-category':
            result = await this.mcpClient.callTool({
              name: 'get-products-by-category',
              arguments: {
                categoryId: toolCall.input.categoryCode,  // Map categoryCode to categoryId for MCP server
                currentPage: toolCall.input.currentPage,
                pageSize: toolCall.input.pageSize,
                sort: toolCall.input.sort
              }
            });
            break;

          case 'get-promotions':
            result = await this.mcpClient.getPromotions();
            break;

          case 'get-product-reviews':
            result = await this.mcpClient.callTool({
              name: 'get-product-reviews',
              arguments: {
                productCode: toolCall.input.productCode
              }
            });
            break;

          case 'get-product-suggestions':
            result = await this.mcpClient.callTool({
              name: 'get-product-suggestions',
              arguments: {
                term: toolCall.input.term,
                max: toolCall.input.max
              }
            });
            break;

          case 'get-order-status':
            // Order operations need user token
            result = await this.mcpClient.callTool({
              name: 'get-order-status',
              arguments: {
                orderCode: toolCall.input.orderCode,
                userAccessToken
              }
            });
            break;

          case 'get-order-history':
            // Order history needs user token
            result = await this.mcpClient.callTool({
              name: 'get-order-history',
              arguments: {
                pageSize: toolCall.input.pageSize,
                currentPage: toolCall.input.currentPage,
                userAccessToken
              }
            });
            break;

          case 'place-order':
            // Place order - pass user token if available for authenticated orders
            const orderCartId = toolCall.input.cartId || this.cartsByConversation.get(conversationId);
            result = await this.mcpClient.callTool({
              name: 'place-order',
              arguments: {
                cartId: orderCartId,
                userAccessToken
              }
            });

            // After placing order, clear the cart from memory since it's now an order
            if (orderCartId) {
              this.cartsByConversation.delete(conversationId);
              console.log('🗑️  Cart cleared after order placement');
            }
            break;

          case 'create-cart':
            result = await this.mcpClient.callTool({
              name: 'create-cart',
              arguments: {
                userAccessToken
              }
            });

            // Store the cart ID for this conversation
            if (result.content && !result.isError) {
              let cartData;
              if (Array.isArray(result.content)) {
                cartData = JSON.parse(result.content[0].text);
              } else if (typeof result.content === 'string') {
                cartData = JSON.parse(result.content);
              } else {
                cartData = result.content;
              }

              const newCartId = cartData?.cartId || cartData?.code || cartData?.guid;
              if (newCartId) {
                this.cartsByConversation.set(conversationId, newCartId);
                console.log(`💾 Stored cart ID ${newCartId} for conversation ${conversationId}`);
              }
            }
            break;

          case 'get-cart':
            // Cart operations may need user token for logged-in users
            const getCartId = toolCall.input.cartId || this.cartsByConversation.get(conversationId);

            if (!getCartId) {
              // No cart exists for this conversation
              result = {
                content: JSON.stringify({
                  message: 'Your cart is currently empty. Start shopping by searching for products!',
                  isEmpty: true,
                  totalItems: 0
                }),
                isError: false
              };
            } else {
              result = await this.mcpClient.callTool({
                name: 'get-cart',
                arguments: {
                  cartId: getCartId,
                  userAccessToken
                }
              });
            }
            break;

          case 'add-to-cart':
            // Get or create cart for this conversation
            let cartId = toolCall.input.cartId || this.cartsByConversation.get(conversationId);

            if (!cartId) {
              console.log('📦 No cart exists for this conversation, creating new cart...');
              const cartResult = await this.mcpClient.callTool({
                name: 'create-cart',
                arguments: {
                  userAccessToken
                }
              });

              // Parse cartId from response
              console.log('📋 Cart creation response:', JSON.stringify(cartResult, null, 2));

              // Try to parse the response - MCP returns content in different formats
              let cartData;
              if (cartResult.content) {
                if (Array.isArray(cartResult.content)) {
                  cartData = JSON.parse(cartResult.content[0].text);
                } else if (typeof cartResult.content === 'string') {
                  cartData = JSON.parse(cartResult.content);
                } else {
                  cartData = cartResult.content;
                }
              }

              cartId = cartData?.cartId || cartData?.code || cartData?.guid || cartData?.id;
              console.log(`✅ Created new cart: ${cartId}`);

              if (!cartId) {
                throw new Error('Failed to extract cartId from cart creation response');
              }

              // Store for future use
              this.cartsByConversation.set(conversationId, cartId);
            } else {
              console.log(`♻️  Using existing cart: ${cartId}`);
            }

            result = await this.mcpClient.callTool({
              name: 'add-to-cart',
              arguments: {
                cartId: cartId,
                productCode: toolCall.input.productCode,
                quantity: toolCall.input.quantity || 1,
                userAccessToken
              }
            });
            break;

          case 'update-cart-entry':
            const updateCartId = toolCall.input.cartId || this.cartsByConversation.get(conversationId);
            result = await this.mcpClient.callTool({
              name: 'update-cart-entry',
              arguments: {
                cartId: updateCartId,
                entryNumber: toolCall.input.entryNumber,
                quantity: toolCall.input.quantity,
                userAccessToken
              }
            });
            break;

          case 'remove-from-cart':
            const removeCartId = toolCall.input.cartId || this.cartsByConversation.get(conversationId);
            result = await this.mcpClient.callTool({
              name: 'remove-from-cart',
              arguments: {
                cartId: removeCartId,
                entryNumber: toolCall.input.entryNumber,
                userAccessToken
              }
            });
            break;

          case 'set-delivery-address':
            const setAddrCartId = this.cartsByConversation.get(conversationId);

            if (!setAddrCartId) {
              result = {
                content: JSON.stringify({
                  error: 'No cart exists',
                  message: 'You need to create a cart and add items before setting a delivery address. Please start by adding products to your cart.'
                }),
                isError: true
              };
            } else {
              // Build complete address with all fields
              const addressPayload: any = {
                title: toolCall.input.title,
                titleCode: toolCall.input.titleCode || 'mr',
                firstName: toolCall.input.firstName,
                lastName: toolCall.input.lastName,
                companyName: toolCall.input.companyName,
                line1: toolCall.input.line1,
                line2: toolCall.input.line2,
                town: toolCall.input.town,
                postalCode: toolCall.input.postalCode,
                country: {
                  isocode: toolCall.input.countryIsocode,
                  name: toolCall.input.countryName
                },
                phone: toolCall.input.phone,
                email: toolCall.input.email
              };

              // Add region if provided (either isocode or name)
              if (toolCall.input.regionIsocode || toolCall.input.regionName) {
                addressPayload.region = {
                  isocode: toolCall.input.regionIsocode,  // May be undefined, MCP server will look it up
                  name: toolCall.input.regionName,
                  countryIso: toolCall.input.countryIsocode
                };
              }

              result = await this.mcpClient.callTool({
                name: 'set-delivery-address',
                arguments: {
                  cartId: setAddrCartId,
                  address: addressPayload,
                  userAccessToken
                }
              });
            }
            break;

          case 'get-delivery-modes':
            const getModeCartId = this.cartsByConversation.get(conversationId);
            result = await this.mcpClient.callTool({
              name: 'get-delivery-modes',
              arguments: {
                cartId: getModeCartId,
                userAccessToken
              }
            });

            // Store delivery modes for this conversation
            if (result && !result.isError) {
              this.storeDeliveryModes(conversationId, [result]);
            }
            break;

          case 'set-delivery-mode':
            const setModeCartId = this.cartsByConversation.get(conversationId);

            // Auto-fix delivery mode code if LLM guessed wrong
            const requestedCode = toolCall.input.deliveryModeCode;
            const correctedCode = this.fixDeliveryModeCode(conversationId, requestedCode);

            if (correctedCode !== requestedCode) {
              console.log(`🔧 AUTO-FIXING delivery mode code: "${requestedCode}" → "${correctedCode}"`);
            }

            result = await this.mcpClient.callTool({
              name: 'set-delivery-mode',
              arguments: {
                cartId: setModeCartId,
                deliveryModeCode: correctedCode,
                userAccessToken
              }
            });
            break;

          case 'set-payment-details':
            const setPaymentCartId = this.cartsByConversation.get(conversationId);

            // Build complete billing address
            const billingAddressPayload: any = {
              title: toolCall.input.billingAddress.title,
              titleCode: toolCall.input.billingAddress.titleCode || 'mr',
              firstName: toolCall.input.billingAddress.firstName,
              lastName: toolCall.input.billingAddress.lastName,
              companyName: toolCall.input.billingAddress.companyName,
              line1: toolCall.input.billingAddress.line1,
              line2: toolCall.input.billingAddress.line2,
              town: toolCall.input.billingAddress.town,
              postalCode: toolCall.input.billingAddress.postalCode,
              country: {
                isocode: toolCall.input.billingAddress.countryIsocode,
                name: toolCall.input.billingAddress.countryName
              },
              phone: toolCall.input.billingAddress.phone,
              email: toolCall.input.billingAddress.email
            };

            // Add region if provided
            if (toolCall.input.billingAddress.regionIsocode) {
              billingAddressPayload.region = {
                isocode: toolCall.input.billingAddress.regionIsocode,
                name: toolCall.input.billingAddress.regionName,
                countryIso: toolCall.input.billingAddress.countryIsocode
              };
            }

            result = await this.mcpClient.callTool({
              name: 'set-payment-details',
              arguments: {
                cartId: setPaymentCartId,
                paymentDetails: {
                  accountHolderName: toolCall.input.accountHolderName,
                  cardNumber: toolCall.input.cardNumber,
                  cardType: { code: toolCall.input.cardTypeCode },
                  expiryMonth: toolCall.input.expiryMonth,
                  expiryYear: toolCall.input.expiryYear,
                  cvv: toolCall.input.cvv,
                  billingAddress: billingAddressPayload
                },
                userAccessToken
              }
            });
            break;

          default:
            result = { error: `Unknown tool: ${toolCall.name}` };
        }

        console.log('✅ Tool Result:', JSON.stringify(result, null, 2).substring(0, 300) + '...');

        // Check for 401 Unauthorized (expired/invalid token)
        const contentStr = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        if (result.isError && (contentStr?.includes('401') || contentStr?.includes('Unauthorized'))) {
          console.log('❌ Authentication failed - token expired or invalid');
          results.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({
              error: 'Authentication failed',
              message: 'Your session has expired. Please log in again to continue.',
              requiresReauth: true
            }),
            products: []
          });
          continue; // Skip to next tool
        }

        // Parse products if this is a search
        let products: Product[] = [];
        if ((toolCall.name === 'search-products' || toolCall.name === 'search-products-advanced') && !result.isError) {
          products = this.parseProducts(result.content);
        }

        results.push({
          tool_use_id: toolCall.id,
          content: result.content,
          products
        });
      } catch (error) {
        console.error(`❌ Error executing tool ${toolCall.name}:`, error);
        results.push({
          tool_use_id: toolCall.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  private storeDeliveryModes(conversationId: string, toolResults: any[]): void {
    try {
      for (const result of toolResults) {
        if (result.content) {
          let data = result.content;

          // Parse content if it's an array or string
          if (Array.isArray(data)) {
            data = data[0]?.text || data[0];
          }
          if (typeof data === 'string') {
            data = JSON.parse(data);
          }

          // Extract delivery modes
          if (data.deliveryModes && Array.isArray(data.deliveryModes)) {
            this.deliveryModesByConversation.set(conversationId, data.deliveryModes);
            console.log(`💾 Stored ${data.deliveryModes.length} delivery modes for conversation ${conversationId}`);
            console.log(`   Modes: ${data.deliveryModes.map((m: any) => `${m.code} (${m.name})`).join(', ')}`);
          }
        }
      }
    } catch (error) {
      console.error('⚠️  Error storing delivery modes:', error);
    }
  }

  private fixDeliveryModeCode(conversationId: string, requestedCode: string): string {
    const deliveryModes = this.deliveryModesByConversation.get(conversationId);

    if (!deliveryModes || deliveryModes.length === 0) {
      console.log(`⚠️  No stored delivery modes for conversation ${conversationId}, using requested code as-is`);
      return requestedCode;
    }

    // First, check if the requested code is already valid
    const exactMatch = deliveryModes.find((m: any) => m.code === requestedCode);
    if (exactMatch) {
      return requestedCode; // Already correct
    }

    // Try to fuzzy match based on the name/code pattern
    // e.g., "standard-net" → "standard-gross", "premium-net" → "premium-gross"
    const requestedLower = requestedCode.toLowerCase();

    // Extract the prefix (e.g., "standard" from "standard-net")
    const prefix = requestedLower.split('-')[0];

    // Find a mode that starts with the same prefix
    const fuzzyMatch = deliveryModes.find((m: any) =>
      m.code.toLowerCase().startsWith(prefix) ||
      m.name.toLowerCase().includes(prefix)
    );

    if (fuzzyMatch) {
      console.log(`🔍 Fuzzy matched "${requestedCode}" to "${fuzzyMatch.code}" (${fuzzyMatch.name})`);
      return fuzzyMatch.code;
    }

    // If no match, return the first available delivery mode as fallback
    console.log(`⚠️  Could not match "${requestedCode}", using first available: ${deliveryModes[0].code}`);
    return deliveryModes[0].code;
  }

  getConversation(conversationId: string) {
    return this.conversationManager.getConversation(conversationId);
  }

  clearConversation(conversationId: string) {
    this.conversationManager.clearConversation(conversationId);
    // Also clear the cart, delivery modes, and order context for this conversation
    this.cartsByConversation.delete(conversationId);
    this.deliveryModesByConversation.delete(conversationId);
    this.lastOrderCodeByConversation.delete(conversationId);
  }

  async cleanup(): Promise<void> {
    await this.mcpClient.disconnect();
  }
}

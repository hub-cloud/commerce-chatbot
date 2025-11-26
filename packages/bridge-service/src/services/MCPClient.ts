import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPToolCall, MCPToolResult } from '../types/index.js';

export class MCPClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  private availableTools: string[] = [];
  private availableResources: string[] = [];
  private resourceCache: Map<string, any> = new Map();

  constructor(private mcpServerPath: string) {
    this.client = new Client({
      name: "chat-bridge",
      version: "1.0.0"
    }, {
      capabilities: {
        resources: {}
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Get the directory where the MCP server is located
      const mcpServerDir = this.mcpServerPath.substring(0, this.mcpServerPath.lastIndexOf('/build/index.js'));

      this.transport = new StdioClientTransport({
        command: "node",
        args: [this.mcpServerPath],
        env: process.env as Record<string, string>
      });

      await this.client.connect(this.transport);
      this.connected = true;

      // List available tools
      const tools = await this.client.listTools();
      this.availableTools = tools.tools.map(tool => tool.name);

      // List available resources
      const resources = await this.client.listResources();
      this.availableResources = resources.resources.map(resource => resource.uri);

      console.log(`✅ MCP Client connected`);
      console.log(`📋 Available Tools: ${this.availableTools.length}`, this.availableTools);
      console.log(`📚 Available Resources: ${this.availableResources.length}`, this.availableResources);

      // Pre-fetch key resources for context
      await this.prefetchResources();
    } catch (error) {
      console.error('❌ Failed to connect to MCP server:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.transport) {
      return;
    }

    try {
      await this.client.close();
      this.connected = false;
      this.transport = null;
      console.log('✅ MCP Client disconnected');
    } catch (error) {
      console.error('❌ Failed to disconnect from MCP server:', error);
    }
  }

  async callTool(toolCall: MCPToolCall): Promise<MCPToolResult> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      const result = await this.client.callTool({
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      return {
        content: result.content,
        isError: Boolean(result.isError)
      };
    } catch (error) {
      console.error(`❌ Error calling tool ${toolCall.name}:`, error);
      return {
        content: { error: error instanceof Error ? error.message : String(error) },
        isError: true
      };
    }
  }

  async listTools(): Promise<string[]> {
    if (!this.connected) {
      await this.connect();
    }

    return this.availableTools;
  }

  async searchProducts(query: string, pageSize = 10): Promise<any> {
    return this.callTool({
      name: 'search-products',
      arguments: { query, pageSize }
    });
  }

  async searchProductsAdvanced(params: {
    query?: string;
    minPrice?: number;
    maxPrice?: number;
    categoryCode?: string;
    sort?: string;
    pageSize?: number;
    currentPage?: number;
  }): Promise<any> {
    return this.callTool({
      name: 'search-products-advanced',
      arguments: params
    });
  }

  async getProductDetails(productCode: string): Promise<any> {
    return this.callTool({
      name: 'get-product-details',
      arguments: { productCode }
    });
  }

  async getCategories(): Promise<any> {
    return this.callTool({
      name: 'get-categories',
      arguments: {}
    });
  }

  async getPromotions(): Promise<any> {
    return this.callTool({
      name: 'get-promotions',
      arguments: {}
    });
  }

  async checkProductAvailability(productCode: string): Promise<any> {
    return this.callTool({
      name: 'check-product-availability',
      arguments: { productCode }
    });
  }

  async getOrderStatus(orderCode: string): Promise<any> {
    return this.callTool({
      name: 'get-order-status',
      arguments: { orderCode }
    });
  }

  async getOrderHistory(pageSize?: number, currentPage?: number): Promise<any> {
    return this.callTool({
      name: 'get-order-history',
      arguments: { pageSize, currentPage }
    });
  }

  async getCart(cartId?: string): Promise<any> {
    return this.callTool({
      name: 'get-cart',
      arguments: { cartId }
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async readResource(uri: string): Promise<any> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      const result = await this.client.readResource({ uri });
      const content = result.contents[0];
      if (content?.text && typeof content.text === 'string') {
        return JSON.parse(content.text);
      }
      return content;
    } catch (error) {
      console.error(`❌ Error reading resource ${uri}:`, error);
      return null;
    }
  }

  async prefetchResources(): Promise<void> {
    console.log('🔄 Pre-fetching MCP resources...');

    const resourcesToFetch = [
      'catalog://categories',
      'config://site'
    ];

    for (const uri of resourcesToFetch) {
      if (this.availableResources.includes(uri)) {
        const data = await this.readResource(uri);
        if (data) {
          this.resourceCache.set(uri, data);
          console.log(`  ✅ Cached: ${uri}`);
        }
      }
    }
  }

  getResourceCache(): Map<string, any> {
    return this.resourceCache;
  }

  getCachedResource(uri: string): any {
    return this.resourceCache.get(uri);
  }
}

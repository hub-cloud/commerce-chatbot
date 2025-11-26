export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string | any[]; // String for normal messages, array for tool use messages
  timestamp: Date;
  metadata?: {
    products?: Product[];
    mcpToolsUsed?: string[];
    tokensUsed?: number;
    provider?: string;
  };
}

export interface Product {
  code: string;
  name: string;
  price: string;
  imageUrl?: string;
  stock?: string;
}

export interface Conversation {
  id: string;
  userId?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  userId?: string;
  isAuthenticated?: boolean;
  userAccessToken?: string; // SAP Commerce OAuth access token from Spartacus
  provider?: 'claude' | 'openai' | 'gemini'; // Optional: override default provider
}

export interface ChatResponse {
  conversationId: string;
  message: string;
  metadata?: {
    productsFound?: number;
    mcpToolsUsed?: string[];
    tokensUsed?: number;
    provider?: string;
    error?: boolean;
    errorMessage?: string;
  };
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolResult {
  content: any;
  isError?: boolean;
}

// AI Provider Abstraction
export interface AIProvider {
  name: string;
  sendMessage(messages: ChatMessage[], systemPrompt?: string, tools?: any[], toolChoice?: any): Promise<AIProviderResponse>;
  streamMessage?(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string>;
}

export interface AIProviderResponse {
  content: string;
  tokensUsed?: number;
  finishReason?: string;
  toolCalls?: any[];
}

export interface AIProviderConfig {
  type: 'claude' | 'openai' | 'gemini';
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

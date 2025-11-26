export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    products?: Product[];
    loading?: boolean;
    error?: string;
    productsFound?: number;
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

export interface ChatConfig {
  apiUrl: string;
  wsUrl?: string;
  theme?: 'light' | 'dark';
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  enableWebSocket?: boolean;
  enableProductCards?: boolean;
  placeholderText?: string;
  title?: string;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

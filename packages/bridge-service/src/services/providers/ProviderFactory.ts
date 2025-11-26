import { AIProvider } from '../../types/index.js';
import { ClaudeProvider } from './ClaudeProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { GeminiProvider } from './GeminiProvider.js';

export class ProviderFactory {
  private static providers: Map<string, AIProvider> = new Map();

  static createProvider(
    type: 'claude' | 'openai' | 'gemini',
    apiKey: string,
    model: string,
    maxTokens?: number,
    temperature?: number
  ): AIProvider {
    const key = `${type}-${model}`;

    // Return cached provider if exists
    if (this.providers.has(key)) {
      return this.providers.get(key)!;
    }

    let provider: AIProvider;

    switch (type) {
      case 'claude':
        provider = new ClaudeProvider(apiKey, model, maxTokens, temperature);
        break;
      case 'openai':
        provider = new OpenAIProvider(apiKey, model, maxTokens, temperature);
        break;
      case 'gemini':
        provider = new GeminiProvider(apiKey, model, maxTokens, temperature);
        break;
      default:
        throw new Error(`Unsupported AI provider: ${type}`);
    }

    // Cache the provider
    this.providers.set(key, provider);
    return provider;
  }

  static getProvider(type: 'claude' | 'openai' | 'gemini'): AIProvider {
    const apiKey = this.getApiKey(type);
    const model = this.getModel(type);
    const maxTokens = parseInt(process.env.MAX_TOKENS || '2048');
    const temperature = parseFloat(process.env.TEMPERATURE || '0.7');

    return this.createProvider(type, apiKey, model, maxTokens, temperature);
  }

  private static getApiKey(type: 'claude' | 'openai' | 'gemini'): string {
    let apiKey: string | undefined;

    switch (type) {
      case 'claude':
        apiKey = process.env.ANTHROPIC_API_KEY;
        break;
      case 'openai':
        apiKey = process.env.OPENAI_API_KEY;
        break;
      case 'gemini':
        apiKey = process.env.GOOGLE_API_KEY;
        break;
    }

    if (!apiKey) {
      throw new Error(`API key not configured for provider: ${type}`);
    }

    return apiKey;
  }

  private static getModel(type: 'claude' | 'openai' | 'gemini'): string {
    let model: string | undefined;

    switch (type) {
      case 'claude':
        model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
        break;
      case 'openai':
        model = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';
        break;
      case 'gemini':
        model = process.env.GEMINI_MODEL || 'gemini-1.5-pro';
        break;
    }

    return model;
  }
}

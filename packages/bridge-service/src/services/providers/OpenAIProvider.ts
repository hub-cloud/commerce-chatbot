import OpenAI from 'openai';
import { AIProvider, AIProviderResponse, ChatMessage } from '../../types/index.js';

export class OpenAIProvider implements AIProvider {
  public name = 'openai';
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(apiKey: string, model: string, maxTokens = 2048, temperature = 0.7) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  async sendMessage(messages: ChatMessage[], systemPrompt?: string): Promise<AIProviderResponse> {
    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    formattedMessages.push(...messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })));

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: formattedMessages
    });

    const content = response.choices[0]?.message?.content || '';

    return {
      content,
      tokensUsed: response.usage?.total_tokens,
      finishReason: response.choices[0]?.finish_reason || undefined
    };
  }

  async *streamMessage(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    formattedMessages.push(...messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: formattedMessages,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}

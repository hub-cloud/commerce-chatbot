import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIProviderResponse, ChatMessage } from '../../types/index.js';

export class ClaudeProvider implements AIProvider {
  public name = 'claude';
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(apiKey: string, model: string, maxTokens = 2048, temperature = 0.7) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  async sendMessage(
    messages: ChatMessage[],
    systemPrompt?: string,
    tools?: any[],
    toolChoice?: any
  ): Promise<AIProviderResponse> {
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      // Content can be string or array (for tool use messages)
      content: typeof msg.content === 'string' ? msg.content : msg.content
    }));

    const requestParams: any = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: formattedMessages
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestParams.tools = tools;
      if (toolChoice) {
        requestParams.tool_choice = toolChoice;
      }
    }

    const response = await this.client.messages.create(requestParams);

    // Check if response contains tool use
    const toolUses = response.content.filter((block: any) => block.type === 'tool_use');

    let content = '';
    const textBlocks = response.content.filter((block: any) => block.type === 'text');
    if (textBlocks.length > 0) {
      content = textBlocks.map((block: any) => block.text).join('\n');
    }

    return {
      content,
      tokensUsed: response.usage?.output_tokens,
      finishReason: response.stop_reason || undefined,
      toolCalls: toolUses.length > 0 ? toolUses : undefined
    };
  }

  async *streamMessage(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: formattedMessages,
      stream: true
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }
  }
}

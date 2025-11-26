import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIProviderResponse, ChatMessage } from '../../types/index.js';

export class GeminiProvider implements AIProvider {
  public name = 'gemini';
  private client: GoogleGenerativeAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(apiKey: string, model: string, maxTokens = 2048, temperature = 0.7) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  async sendMessage(messages: ChatMessage[], systemPrompt?: string): Promise<AIProviderResponse> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
      systemInstruction: systemPrompt
    });

    // Format chat history for Gemini
    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
    }));

    const chat = model.startChat({ history });
    const lastMessage = messages[messages.length - 1];
    const lastContent = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
    const result = await chat.sendMessage(lastContent);
    const response = result.response;

    return {
      content: response.text(),
      tokensUsed: response.usageMetadata?.totalTokenCount,
      finishReason: response.candidates?.[0]?.finishReason
    };
  }

  async *streamMessage(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
      systemInstruction: systemPrompt
    });

    // Format chat history for Gemini
    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
    }));

    const chat = model.startChat({ history });
    const lastMessage = messages[messages.length - 1];
    const lastContent = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
    const result = await chat.sendMessageStream(lastContent);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }
}

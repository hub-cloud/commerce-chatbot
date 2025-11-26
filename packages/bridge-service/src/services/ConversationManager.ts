import { v4 as uuidv4 } from 'uuid';
import { Conversation, ChatMessage } from '../types/index.js';

export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private readonly MAX_MESSAGES = 50; // Keep last 50 messages per conversation
  private readonly MAX_CONVERSATIONS = 1000; // Store max 1000 conversations in memory

  createConversation(userId?: string): Conversation {
    const conversation: Conversation = {
      id: uuidv4(),
      userId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.conversations.set(conversation.id, conversation);
    this.cleanupOldConversations();

    return conversation;
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  addMessage(conversationId: string, message: ChatMessage): void {
    const conversation = this.conversations.get(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    conversation.messages.push(message);
    conversation.updatedAt = new Date();

    // Prune old messages if exceeds limit
    if (conversation.messages.length > this.MAX_MESSAGES) {
      // Keep system message (if any) and last MAX_MESSAGES - 1
      const systemMessages = conversation.messages.filter(m => m.role === 'assistant' && m.metadata?.mcpToolsUsed?.includes('system'));
      const recentMessages = conversation.messages.slice(-(this.MAX_MESSAGES - systemMessages.length));
      conversation.messages = [...systemMessages, ...recentMessages];
    }
  }

  getMessages(conversationId: string): ChatMessage[] {
    const conversation = this.conversations.get(conversationId);
    return conversation?.messages || [];
  }

  clearConversation(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);

    if (conversation) {
      conversation.messages = [];
      conversation.updatedAt = new Date();
    }
  }

  deleteConversation(conversationId: string): boolean {
    return this.conversations.delete(conversationId);
  }

  private cleanupOldConversations(): void {
    if (this.conversations.size <= this.MAX_CONVERSATIONS) {
      return;
    }

    // Sort by last updated and remove oldest
    const sorted = Array.from(this.conversations.entries())
      .sort((a, b) => a[1].updatedAt.getTime() - b[1].updatedAt.getTime());

    const toRemove = sorted.slice(0, this.conversations.size - this.MAX_CONVERSATIONS);

    for (const [id] of toRemove) {
      this.conversations.delete(id);
    }

    console.log(`🧹 Cleaned up ${toRemove.length} old conversations`);
  }

  getStats(): { total: number; totalMessages: number } {
    let totalMessages = 0;

    for (const conv of this.conversations.values()) {
      totalMessages += conv.messages.length;
    }

    return {
      total: this.conversations.size,
      totalMessages
    };
  }
}

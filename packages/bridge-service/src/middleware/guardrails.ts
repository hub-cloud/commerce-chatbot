import { Request, Response, NextFunction } from 'express';

export interface GuardrailConfig {
  maxMessageLength: number;
  maxMessagesPerMinute: number;
  maxConversationsPerUser: number;
  blockedPatterns: RegExp[];
  allowedTopics: string[];
  requireModeration: boolean;
}

const defaultConfig: GuardrailConfig = {
  maxMessageLength: 2000,
  maxMessagesPerMinute: 20,
  maxConversationsPerUser: 10,
  blockedPatterns: [
    /\b(jailbreak|ignore\s+instructions|forget\s+previous|act\s+as)\b/i,
    /\b(sql\s+injection|drop\s+table|delete\s+from)\b/i,
    /\b(admin|root|sudo|password|token|secret|api[_-]?key)\b/i,
  ],
  allowedTopics: [
    'products',
    'orders',
    'cart',
    'categories',
    'promotions',
    'availability',
    'prices',
    'shipping',
    'returns'
  ],
  requireModeration: false
};

// Rate limiting store (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const conversationStore = new Map<string, Set<string>>();

export class Guardrails {
  constructor(private config: GuardrailConfig = defaultConfig) {}

  // Content validation
  validateMessageContent(message: string): { valid: boolean; reason?: string } {
    // Check message length
    if (message.length > this.config.maxMessageLength) {
      return {
        valid: false,
        reason: `Message exceeds maximum length of ${this.config.maxMessageLength} characters`
      };
    }

    // Check for blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(message)) {
        console.warn('🚨 Blocked pattern detected:', pattern.source);
        return {
          valid: false,
          reason: 'Message contains prohibited content'
        };
      }
    }

    // Check for prompt injection attempts
    if (this.detectPromptInjection(message)) {
      return {
        valid: false,
        reason: 'Potential prompt injection detected'
      };
    }

    return { valid: true };
  }

  // Detect prompt injection attempts
  private detectPromptInjection(message: string): boolean {
    const injectionPatterns = [
      /system:/i,
      /assistant:/i,
      /\[INST\]/i,
      /\[\/INST\]/i,
      /<\|im_start\|>/i,
      /<\|im_end\|>/i,
      /ignore\s+(all\s+)?(previous|above|prior)\s+instructions/i,
      /disregard\s+(all\s+)?previous/i,
      /forget\s+everything/i,
      /you\s+are\s+now/i,
      /new\s+instructions/i,
    ];

    return injectionPatterns.some(pattern => pattern.test(message));
  }

  // Rate limiting
  checkRateLimit(userId: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const userKey = userId || 'anonymous';
    const limit = rateLimitStore.get(userKey);

    if (!limit || now > limit.resetTime) {
      // Reset or create new limit
      rateLimitStore.set(userKey, {
        count: 1,
        resetTime: now + 60000 // 1 minute
      });
      return { allowed: true };
    }

    if (limit.count >= this.config.maxMessagesPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded. Maximum ${this.config.maxMessagesPerMinute} messages per minute.`
      };
    }

    limit.count++;
    return { allowed: true };
  }

  // Conversation limits
  checkConversationLimit(userId: string, conversationId?: string): { allowed: boolean; reason?: string } {
    const userKey = userId || 'anonymous';

    if (!conversationStore.has(userKey)) {
      conversationStore.set(userKey, new Set());
    }

    const userConversations = conversationStore.get(userKey)!;

    // If new conversation
    if (!conversationId) {
      if (userConversations.size >= this.config.maxConversationsPerUser) {
        return {
          allowed: false,
          reason: `Maximum ${this.config.maxConversationsPerUser} concurrent conversations reached`
        };
      }
    } else {
      userConversations.add(conversationId);
    }

    return { allowed: true };
  }

  // Sanitize output
  sanitizeResponse(response: string): string {
    // Remove any potential PII patterns
    let sanitized = response;

    // Remove credit card patterns
    sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED]');

    // Remove email patterns (but keep product emails)
    sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED]');

    // Remove phone numbers
    sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED]');

    return sanitized;
  }

  // Validate topic relevance
  validateTopic(message: string): { valid: boolean; reason?: string } {
    const lowerMessage = message.toLowerCase();

    // Check if message is related to commerce
    const commerceKeywords = [
      'product', 'order', 'cart', 'buy', 'purchase', 'price', 'shipping',
      'delivery', 'return', 'category', 'promotion', 'discount', 'sale',
      'stock', 'available', 'camera', 'lens', 'webcam', 'electronics'
    ];

    const hasCommerceKeyword = commerceKeywords.some(keyword =>
      lowerMessage.includes(keyword)
    );

    // Allow greetings and basic questions
    const greetingPatterns = /^(hi|hello|hey|thanks|thank you|goodbye|bye)/i;
    const questionPatterns = /(what|how|when|where|which|can|do|does|is|are)/i;

    if (hasCommerceKeyword || greetingPatterns.test(message) || questionPatterns.test(message)) {
      return { valid: true };
    }

    // If message seems off-topic
    const offTopicPatterns = [
      /write\s+(code|script|program)/i,
      /create\s+(a\s+)?(website|app|application)/i,
      /political|religious|medical\s+advice/i,
    ];

    if (offTopicPatterns.some(pattern => pattern.test(message))) {
      return {
        valid: false,
        reason: 'This assistant is focused on helping with product inquiries and orders'
      };
    }

    return { valid: true };
  }
}

// Express middleware
export function createGuardrailMiddleware(config?: Partial<GuardrailConfig>) {
  const guardrails = new Guardrails({ ...defaultConfig, ...config });

  return async (req: Request, res: Response, next: NextFunction) => {
    const { message, userId, conversationId } = req.body;

    console.log('\n🛡️  GUARDRAIL CHECKS');
    console.log('─'.repeat(80));

    // 1. Content validation
    const contentCheck = guardrails.validateMessageContent(message);
    if (!contentCheck.valid) {
      console.log('❌ Content validation failed:', contentCheck.reason);
      console.log('🚫 REQUEST BLOCKED - Not sent to Claude API');
      console.log('─'.repeat(80) + '\n');
      return res.status(400).json({
        error: 'Invalid message',
        reason: contentCheck.reason
      });
    }
    console.log('✅ Content validation passed');

    // 2. Rate limiting
    const rateLimitCheck = guardrails.checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      console.log('❌ Rate limit exceeded');
      console.log('🚫 REQUEST BLOCKED - Not sent to Claude API');
      console.log('─'.repeat(80) + '\n');
      return res.status(429).json({
        error: 'Rate limit exceeded',
        reason: rateLimitCheck.reason
      });
    }
    console.log('✅ Rate limit check passed');

    // 3. Conversation limits
    const conversationCheck = guardrails.checkConversationLimit(userId, conversationId);
    if (!conversationCheck.allowed) {
      console.log('❌ Conversation limit exceeded');
      console.log('🚫 REQUEST BLOCKED - Not sent to Claude API');
      console.log('─'.repeat(80) + '\n');
      return res.status(429).json({
        error: 'Conversation limit exceeded',
        reason: conversationCheck.reason
      });
    }
    console.log('✅ Conversation limit check passed');

    // 4. Topic validation
    const topicCheck = guardrails.validateTopic(message);
    if (!topicCheck.valid) {
      console.log('❌ Off-topic message detected');
      console.log('🚫 REQUEST BLOCKED - Not sent to Claude API');
      console.log('─'.repeat(80) + '\n');
      return res.status(400).json({
        error: 'Off-topic message',
        reason: topicCheck.reason
      });
    }
    console.log('✅ Topic validation passed');

    console.log('✅ ALL GUARDRAILS PASSED - Proceeding to Claude API');
    console.log('─'.repeat(80));

    // Store guardrails instance for response sanitization
    req.app.locals.guardrails = guardrails;

    next();
  };
}

// Response sanitization middleware
export function sanitizeResponseMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);

  res.json = function(body: any) {
    if (body.message && req.app.locals.guardrails) {
      body.message = req.app.locals.guardrails.sanitizeResponse(body.message);
    }
    return originalJson(body);
  };

  next();
}

import { Router, Request, Response } from 'express';
import { ChatService } from '../services/ChatService.js';
import { ChatRequest } from '../types/index.js';
import { createGuardrailMiddleware } from '../middleware/guardrails.js';

export function createChatRoutes(chatService: ChatService): Router {
  const router = Router();

  // Create guardrail middleware
  const guardrails = createGuardrailMiddleware({
    maxMessageLength: 2000,
    maxMessagesPerMinute: 20,
    maxConversationsPerUser: 10
  });

  // POST /api/chat/message - Send a chat message
  router.post('/message', guardrails, async (req: Request, res: Response) => {
    try {
      const request: ChatRequest = req.body;

      // Extract user access token from Authorization header OR request body
      const authHeader = req.headers.authorization;
      let userAccessToken: string | undefined;

      // First try Authorization header (added by Spartacus interceptor)
      if (authHeader && authHeader.startsWith('Bearer ')) {
        userAccessToken = authHeader.substring(7); // Remove 'Bearer ' prefix
      }
      // Fall back to request body (sent directly from Angular library)
      else if (request.userAccessToken) {
        userAccessToken = request.userAccessToken;
      }

      console.log('\n' + '='.repeat(80));
      console.log('📨 INCOMING REQUEST FROM ANGULAR');
      console.log('='.repeat(80));
      console.log('Request Body:', JSON.stringify(request, null, 2));
      console.log('User Message:', request.message);
      console.log('Conversation ID:', request.conversationId || 'NEW');
      console.log('Provider:', request.provider || 'DEFAULT');

      // Log auth status
      if (userAccessToken) {
        console.log('🔐 User Access Token:', userAccessToken.substring(0, 30) + '...');
        request.userAccessToken = userAccessToken; // Add to request
        request.isAuthenticated = true;
      } else {
        console.log('⚠️  No user access token (anonymous user)');
        request.isAuthenticated = false;
      }
      console.log('='.repeat(80) + '\n');

      if (!request.message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const response = await chatService.handleChatMessage(request);

      console.log('\n' + '='.repeat(80));
      console.log('📤 SENDING RESPONSE TO ANGULAR');
      console.log('='.repeat(80));
      console.log('Response:', JSON.stringify(response, null, 2));
      console.log('='.repeat(80) + '\n');

      res.json(response);
    } catch (error) {
      console.error('Error handling chat message:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/chat/conversations/:id - Get conversation history
  router.get('/conversations/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const conversation = chatService.getConversation(id);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json(conversation);
    } catch (error) {
      console.error('Error getting conversation:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // DELETE /api/chat/conversations/:id - Clear conversation
  router.delete('/conversations/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      chatService.clearConversation(id);
      res.json({ success: true, message: 'Conversation cleared' });
    } catch (error) {
      console.error('Error clearing conversation:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/chat/health - Health check
  router.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  return router;
}

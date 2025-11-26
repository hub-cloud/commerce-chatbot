import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ChatService } from './services/ChatService.js';
import { createChatRoutes } from './routes/chatRoutes.js';
import { createGuardrailMiddleware, sanitizeResponseMiddleware } from './middleware/guardrails.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());

// Guardrails middleware
app.use(sanitizeResponseMiddleware);

// Initialize services
const mcpServerPath = process.env.MCP_SERVER_PATH;

if (!mcpServerPath) {
  console.error('❌ MCP_SERVER_PATH environment variable is required');
  console.error('   Example: MCP_SERVER_PATH=/path/to/mcp-server/build/index.js');
  process.exit(1);
}

const chatService = new ChatService(mcpServerPath);

// Routes
app.use('/api/chat', createChatRoutes(chatService));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'SAP Commerce Chat Bridge',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      chat: '/api/chat/message',
      health: '/api/chat/health',
      conversation: '/api/chat/conversations/:id'
    },
    providers: {
      default: process.env.DEFAULT_AI_PROVIDER || 'claude',
      supported: ['claude', 'openai', 'gemini']
    }
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await chatService.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await chatService.cleanup();
  process.exit(0);
});

// Start server
async function start() {
  try {
    // Initialize chat service (connects to MCP)
    console.log('🔌 Connecting to MCP server...');
    await chatService.initialize();
    console.log('✅ MCP connection established');

    // Start Express server
    app.listen(PORT, () => {
      console.log(`\n🚀 SAP Commerce Chat Bridge Server`);
      console.log(`📡 Listening on http://localhost:${PORT}`);
      console.log(`🤖 Default AI Provider: ${process.env.DEFAULT_AI_PROVIDER || 'claude'}`);
      console.log(`🔧 MCP Server: ${mcpServerPath}`);
      console.log(`\n✨ Server ready to handle requests!\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();

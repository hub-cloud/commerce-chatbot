import { Injectable, inject, Injector, Optional, InjectionToken } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { ChatMessage, ChatConfig, Product } from '../models/chat.models';

// Interfaces for Spartacus services
interface IAuthService {
  isUserLoggedIn(): Observable<boolean>;
}

interface IUserIdService {
  getUserId(): Observable<string>;
}

interface IAuthStorageService {
  getToken(): Observable<{ access_token: string } | null | undefined>;
}

// Injection tokens for optional Spartacus services
export const SPARTACUS_AUTH_SERVICE = new InjectionToken<IAuthService>('SpartacusAuthService');
export const SPARTACUS_USER_ID_SERVICE = new InjectionToken<IUserIdService>('SpartacusUserIdService');
export const SPARTACUS_AUTH_STORAGE_SERVICE = new InjectionToken<IAuthStorageService>('SpartacusAuthStorageService');

interface ChatAPIRequest {
  message: string;
  conversationId?: string;
  userId?: string;
  isAuthenticated?: boolean;
  userAccessToken?: string;
  provider?: 'claude' | 'openai' | 'gemini';
}

interface ChatAPIResponse {
  conversationId: string;
  message: string;
  metadata?: {
    productsFound?: number;
    mcpToolsUsed?: string[];
    tokensUsed?: number;
    provider?: string;
  };
}

@Injectable()
export class ChatService {
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$ = this.messagesSubject.asObservable();

  private isTypingSubject = new BehaviorSubject<boolean>(false);
  public isTyping$ = this.isTypingSubject.asObservable();

  private conversationId: string | undefined;
  private initialized = false;

  // Spartacus auth services - injected optionally
  private authService?: IAuthService;
  private userIdService?: IUserIdService;
  private authStorageService?: IAuthStorageService;

  private config: ChatConfig = {
    apiUrl: 'http://localhost:3000/api/chat',
    theme: 'light',
    position: 'bottom-right',
    enableProductCards: true,
    placeholderText: 'Ask me anything...',
    title: 'SAP Commerce Assistant'
  };

  constructor(
    private http: HttpClient,
    private injector: Injector
  ) {
    // Try to dynamically inject Spartacus services if available
    try {
      // Try to get Spartacus auth services from the injector using tokens
      this.authService = this.injector.get(SPARTACUS_AUTH_SERVICE, null, { optional: true }) || undefined;
      this.userIdService = this.injector.get(SPARTACUS_USER_ID_SERVICE, null, { optional: true }) || undefined;
      this.authStorageService = this.injector.get(SPARTACUS_AUTH_STORAGE_SERVICE, null, { optional: true }) || undefined;

      if (this.authService && this.userIdService) {
        console.log('✅ [Angular] Spartacus auth services detected and injected');
        if (this.authStorageService) {
          console.log('✅ [Angular] Spartacus auth storage service detected (will send access token)');
        }
      } else {
        console.log('⚠️  [Angular] Spartacus services not found in injector (standalone mode)');
        console.log('   You need to provide these services in your app.config.ts or module');
      }
    } catch (error) {
      console.log('⚠️  [Angular] Error injecting Spartacus services:', error);
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialized = true;
      // Add welcome message on first access, not in constructor
      this.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: 'Hello! I\'m your SAP Commerce assistant. How can I help you today?',
        timestamp: new Date()
      });
    }
  }

  configure(config: Partial<ChatConfig>): void {
    this.ensureInitialized();
    this.config = { ...this.config, ...config };
  }

  getConfig(): ChatConfig {
    this.ensureInitialized();
    return this.config;
  }

  sendMessage(content: string, provider?: 'claude' | 'openai' | 'gemini'): Observable<ChatMessage> {
    this.ensureInitialized();
    // Add user message
    const userMessage: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    this.addMessage(userMessage);

    // Show typing indicator
    this.isTypingSubject.next(true);

    // Get auth info and make API call
    return this.getAuthInfo().pipe(
      tap(authInfo => {
        console.log('🔐 [Angular] Auth Info:', authInfo);
      }),
      switchMap(authInfo => {
        // Prepare API request with auth info
        const request: ChatAPIRequest = {
          message: content,
          conversationId: this.conversationId,
          userId: authInfo.userId,
          isAuthenticated: authInfo.isAuthenticated,
          userAccessToken: authInfo.accessToken,
          provider
        };

        console.log('🚀 [Angular] Sending request to bridge:', {
          url: `${this.config.apiUrl}/message`,
          request: { ...request, userAccessToken: request.userAccessToken ? '***' : undefined },
          timestamp: new Date().toISOString()
        });

        // Call backend API
        return this.http.post<ChatAPIResponse>(`${this.config.apiUrl}/message`, request);
      }),
      map(response => {
        console.log('✅ [Angular] Received response from bridge:', {
          conversationId: response.conversationId,
          messageLength: response.message.length,
          metadata: response.metadata,
          timestamp: new Date().toISOString()
        });

        // Store conversation ID for context
        this.conversationId = response.conversationId;

        // Create assistant message
        const assistantMessage: ChatMessage = {
          id: this.generateId(),
          role: 'assistant',
          content: response.message,
          timestamp: new Date(),
          metadata: response.metadata
        };

        // Add to message stream
        this.addMessage(assistantMessage);
        this.isTypingSubject.next(false);

        return assistantMessage;
      }),
      catchError(error => {
        console.error('Error calling chat API:', error);

        // Add error message
        const errorMessage: ChatMessage = {
          id: this.generateId(),
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date(),
          metadata: {
            error: error.message || 'Unknown error'
          }
        };

        this.addMessage(errorMessage);
        this.isTypingSubject.next(false);

        return of(errorMessage);
      })
    );
  }

  private addMessage(message: ChatMessage): void {
    const currentMessages = this.messagesSubject.value;
    this.messagesSubject.next([...currentMessages, message]);
  }

  clearConversation(): void {
    this.messagesSubject.next([]);
    // Add welcome message back
    this.addMessage({
      id: this.generateId(),
      role: 'assistant',
      content: 'Conversation cleared. How can I help you?',
      timestamp: new Date()
    });
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getAuthInfo(): Observable<{ userId: string; isAuthenticated: boolean; accessToken?: string }> {
    // If Spartacus auth services are available, use them
    if (this.authService && this.userIdService) {
      // Add access token observable if auth storage service is available
      if (this.authStorageService) {
        const token$ = this.authStorageService.getToken().pipe(
          map(token => token?.access_token || undefined),
          catchError(() => of(undefined))
        );
        return combineLatest([
          this.authService.isUserLoggedIn(),
          this.userIdService.getUserId(),
          token$
        ]).pipe(
          map(([isLoggedIn, userId, accessToken]) => ({
            isAuthenticated: isLoggedIn,
            userId: userId || 'anonymous',
            accessToken
          }))
        );
      }

      return combineLatest([
        this.authService.isUserLoggedIn(),
        this.userIdService.getUserId()
      ]).pipe(
        map(([isLoggedIn, userId]) => ({
          isAuthenticated: isLoggedIn,
          userId: userId || 'anonymous'
        }))
      );
    }

    // Fallback to anonymous user if no auth service
    return of({ isAuthenticated: false, userId: 'anonymous' });
  }
}

import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ChatService } from '../../services/chat.service';
import { ChatMessage, Product } from '../../models/chat.models';

@Component({
  selector: 'scc-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-window.component.html',
  styleUrls: ['./chat-window.component.scss']
})
export class ChatWindowComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messageContainer') private messageContainer?: ElementRef;

  isOpen = false;
  messages: ChatMessage[] = [];
  isTyping = false;
  userInput = '';

  private destroy$ = new Subject<void>();
  private shouldScrollToBottom = false;

  constructor(public chatService: ChatService) {}

  ngOnInit(): void {
    this.chatService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe(messages => {
        this.messages = messages;
        this.shouldScrollToBottom = true;
      });

    this.chatService.isTyping$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isTyping => {
        this.isTyping = isTyping;
        if (isTyping) {
          this.shouldScrollToBottom = true;
        }
      });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleChat(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  sendMessage(): void {
    if (!this.userInput.trim()) {
      return;
    }

    const message = this.userInput;
    this.userInput = '';

    this.chatService.sendMessage(message).subscribe();
  }

  clearChat(): void {
    if (confirm('Are you sure you want to clear the conversation?')) {
      this.chatService.clearConversation();
    }
  }

  private scrollToBottom(): void {
    if (this.messageContainer) {
      try {
        const element = this.messageContainer.nativeElement;
        element.scrollTop = element.scrollHeight;
      } catch (err) {
        console.error('Error scrolling to bottom:', err);
      }
    }
  }

  handleKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  get config() {
    return this.chatService.getConfig();
  }

  hasProducts(message: ChatMessage): boolean {
    return !!(message.metadata?.products && message.metadata.products.length > 0);
  }

  getProducts(message: ChatMessage): Product[] {
    return message.metadata?.products || [];
  }
}

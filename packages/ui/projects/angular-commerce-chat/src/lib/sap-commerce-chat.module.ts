import { NgModule } from '@angular/core';
import { ChatWindowComponent } from './components/chat-window/chat-window.component';
import { ChatService } from './services/chat.service';

@NgModule({
  imports: [
    ChatWindowComponent
  ],
  exports: [
    ChatWindowComponent
  ],
  providers: [
    ChatService
  ]
})
export class SapCommerceChatModule { }

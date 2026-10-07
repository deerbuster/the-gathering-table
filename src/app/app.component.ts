import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { MessageService } from './core/message.service';
import { CampaignService } from './core/campaign.service';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main" (click)="skip($event)">Skip to content</a>
    <header class="site-header">
      <div class="shell header-inner">
        <a routerLink="/games" class="brand" aria-label="The Gathering Table home">
          <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14h18l7 10-7 10H15L8 24z"/><circle cx="24" cy="7" r="2"/><circle cx="24" cy="41" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="40" cy="12" r="2"/><circle cx="8" cy="36" r="2"/><circle cx="40" cy="36" r="2"/></svg></span>
          <span>The Gathering Table<small>FIND YOUR TABLE</small></span>
        </a>
        <nav aria-label="Main navigation">
          <a routerLink="/games" routerLinkActive="active">Find games</a>
          <a routerLink="/host" routerLinkActive="active">Host a game</a>
          @if (pendingApplications()) { <a routerLink="/games" [queryParams]="{ view: 'applications' }" [attr.aria-label]="pendingApplications() + ' pending applications'">Applications <span class="unread-badge" aria-hidden="true">{{ pendingApplications() }}</span></a> }
          <a routerLink="/inbox" routerLinkActive="active" [attr.aria-label]="unreadCount() ? 'Inbox, ' + unreadCount() + ' unread messages' : 'Inbox'">Inbox @if (unreadCount()) { <span class="unread-badge" aria-hidden="true">{{ unreadCount() > 99 ? '99+' : unreadCount() }}</span> }</a>
        </nav>
        <a class="account-link" routerLink="/account">{{ auth.user() ? 'My account' : 'Sign in' }} <span aria-hidden="true">↗</span></a>
      </div>
    </header>
    @if (auth.demo) {
      <div class="demo-banner"><div class="shell"><strong>Sample preview</strong> · Explore the app with demo identities. Changes reset when you reload. <a routerLink="/account">Try as a player or GM →</a></div></div>
    }
    <main id="main" tabindex="-1" class="shell main-content"><router-outlet /></main>
    <footer class="shell footer"><span>The Gathering Table</span><span>For players of Iron Crown Enterprises games. An independent community platform.</span><span>Matchmaking & scheduling</span></footer>
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly campaigns = inject(CampaignService);
  readonly pendingApplications = toSignal(toObservable(this.auth.user).pipe(switchMap(user => user ? this.campaigns.watchHosted(user.uid).pipe(map(rows => rows.filter(c => c.lifecycleStatus !== 'Completed').reduce((sum, c) => sum + c.pendingPlayerIds.length, 0)), catchError(() => of(0))) : of(0))), { initialValue: 0 });
  readonly unreadCount = toSignal(toObservable(this.auth.user).pipe(switchMap(user => user ? this.messages.watchUnread(user.uid).pipe(map(counts => Object.values(counts).reduce((sum, n) => sum + n, 0)), catchError(() => of(0))) : of(0))), { initialValue: 0 });
  skip(event: Event): void {
    event.preventDefault();
    const main = document.getElementById('main');
    main?.focus(); main?.scrollIntoView();
  }
}

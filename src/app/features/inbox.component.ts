import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { CampaignService } from '../core/campaign.service';
import { MessageService } from '../core/message.service';
import { friendlyError } from '../core/error';

@Component({ imports: [RouterLink, DatePipe, ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './inbox.component.html' })
export class InboxComponent {
  readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly campaigns = inject(CampaignService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  readonly body = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(4000)] });
  readonly selectedId = toSignal(this.route.queryParamMap.pipe(map(p => p.get('thread'))), { initialValue: this.route.snapshot.queryParamMap.get('thread') });
  readonly inbox = toSignal(toObservable(this.auth.user).pipe(switchMap(user => user ? this.messages.watchInbox(user.uid).pipe(catchError(error => { this.error.set(friendlyError(error)); return of([]); })) : of([]))), { initialValue: [] });
  readonly unread = toSignal(toObservable(this.auth.user).pipe(switchMap(user => user ? this.messages.watchUnread(user.uid).pipe(catchError(error => { this.error.set(friendlyError(error)); return of({} as Record<string, number>); })) : of({} as Record<string, number>))), { initialValue: {} as Record<string, number> });
  readonly labeledInbox = toSignal(combineLatest([toObservable(this.inbox), toObservable(this.auth.user)]).pipe(switchMap(([rows, user]) => rows.length && user ? combineLatest(rows.map(c => {
    const other = c.participantIds.find(uid => uid !== user.uid)!;
    return this.campaigns.watchProfile(other).pipe(map(p => ({ ...c, partnerName: p?.username ?? 'Adventurer' })), catchError(() => of({ ...c, partnerName: 'Adventurer' })));
  })) : of([]))), { initialValue: [] });
  readonly conversation = computed(() => this.labeledInbox().find(c => c.id === this.selectedId()) ?? null);
  private readonly historyState = toSignal(toObservable(this.conversation).pipe(switchMap(c => c ? this.messages.watchMessages(c.id).pipe(map(messages => ({ id: c.id, messages })), catchError(error => { this.error.set(friendlyError(error)); return of({ id: c.id, messages: [] }); })) : of({ id: '', messages: [] }))), { initialValue: { id: '', messages: [] } });
  readonly history = computed(() => this.historyState().id === this.conversation()?.id ? this.historyState().messages : []);
  constructor() {
    effect(() => {
      const conversation = this.conversation(); const history = this.history();
      if (conversation && history.length) void this.messages.markRead(conversation.id, history).catch(error => this.error.set(friendlyError(error)));
    });
  }
  select(id: string): void { this.body.reset(); this.error.set(''); this.notice.set(''); void this.router.navigate(['/inbox'], { queryParams: { thread: id } }); }
  async send(): Promise<void> {
    const conversation = this.conversation(); if (!conversation || this.body.invalid || this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { await this.messages.send(conversation, this.body.value); this.body.reset(); this.notice.set('Message sent.'); }
    catch (error) { this.error.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
}

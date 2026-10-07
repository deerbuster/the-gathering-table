import { AvatarComponent } from '../shared/avatar.component';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { AuthService } from '../core/auth.service';
import { CampaignService } from '../core/campaign.service';
import { friendlyError } from '../core/error';
import { LifecycleStatus } from '../core/models';
import { MessageService } from '../core/message.service';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({ imports: [AvatarComponent, RouterLink, DatePipe, ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './detail.component.html' })
export class DetailComponent {
  readonly auth = inject(AuthService);
  private readonly service = inject(CampaignService);
  private readonly messages = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly message = signal('');
  readonly loadError = signal('');
  readonly busy = signal(false);
  readonly completing = signal(false);
  readonly decisionPrompt = signal<{ uid: string; name: string; accepted: boolean } | null>(null);
  readonly feedback = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(3000)] });
  promptDecision(uid: string, name: string, accepted: boolean): void {
    if (this.busy()) return;
    this.feedback.reset(); this.message.set(''); this.decisionPrompt.set({ uid, name, accepted });
  }
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private readonly campaign$ = this.route.paramMap.pipe(switchMap(params => this.service.watchCampaign(params.get('id')!).pipe(catchError(error => { this.loadError.set(friendlyError(error)); return of(null); }))));
  readonly campaign = toSignal(this.campaign$);
  readonly roster = toSignal(this.campaign$.pipe(switchMap(c => c ? combineLatest([c.gmUserId, ...c.playerIds].map(uid => this.service.watchProfile(uid).pipe(map(profile => ({ uid, name: profile?.username ?? (uid === c.gmUserId ? c.gmName : 'Adventurer'), gm: uid === c.gmUserId, photoURL: profile?.photoURL ?? '', allowMessages: profile?.allowCampaignMessages ?? false })), catchError(() => of({ uid, name: 'Adventurer', gm: uid === c.gmUserId, photoURL: '', allowMessages: false }))))) : of([])), catchError(() => of([]))), { initialValue: [] });
  readonly retired = toSignal(this.campaign$.pipe(switchMap(c => {
    const ids = c?.retiredPlayerIds.filter(uid => !c.playerIds.includes(uid)) ?? [];
    return ids.length ? combineLatest(ids.map(uid => this.service.watchProfile(uid).pipe(map(profile => ({ uid, name: profile?.username ?? 'Adventurer', photoURL: profile?.photoURL ?? '', allowMessages: profile?.allowCampaignMessages ?? false })), catchError(() => of({ uid, name: 'Adventurer', photoURL: '', allowMessages: false }))))) : of([]);
  })), { initialValue: [] });
  readonly applicants = toSignal(this.campaign$.pipe(switchMap(c => c?.pendingPlayerIds.length ? combineLatest(c.pendingPlayerIds.map(uid => this.service.watchProfile(uid).pipe(map(profile => ({ uid, name: profile?.username ?? 'Adventurer' })), catchError(() => of({ uid, name: 'Adventurer' }))))) : of([])), catchError(() => of([]))), { initialValue: [] });
  readonly html = computed(() => DOMPurify.sanitize(marked.parse(this.campaign()?.description ?? '', { async: false }), { USE_PROFILES: { html: true } }));
  readonly gm = computed(() => this.campaign()?.gmUserId === this.auth.user()?.uid);
  readonly joined = computed(() => !!this.auth.user() && !!this.campaign()?.playerIds.includes(this.auth.user()!.uid));
  readonly pending = computed(() => !!this.auth.user() && !!this.campaign()?.pendingPlayerIds.includes(this.auth.user()!.uid));
  readonly canJoin = computed(() => this.campaign()?.status === 'Open' && (this.campaign()?.startTime?.toMillis() ?? Infinity) > Date.now());
  async action(action: 'join' | 'leave' | 'confirm' | 'complete' | 'withdraw'): Promise<void> {
    const c = this.campaign();
    if (!c || this.busy()) return;
    if (!this.auth.user()) { await this.router.navigate(['/account'], { queryParams: { returnTo: `/games/${c.id}` } }); return; }
    this.busy.set(true); this.message.set('');
    try {
      await this.service[action](c.id);
      this.completing.set(false);
      this.message.set(({ join: c.startMode === 'Rolling' ? 'Application sent. Your seat counts once the GM accepts you.' : 'Your seat is reserved.', leave: 'You have left this table.', confirm: 'The next session is confirmed.', complete: 'Campaign marked completed. Participants can now leave reviews.', withdraw: 'Your application has been withdrawn.' })[action]);
    } catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async decide(): Promise<void> {
    const c = this.campaign(); const decision = this.decisionPrompt();
    if (!c || !decision || this.busy() || this.feedback.invalid) return;
    this.busy.set(true);
    try { await this.messages.decideApplication(c.id, decision.uid, decision.accepted, this.feedback.value); this.decisionPrompt.set(null); this.message.set(decision.accepted ? 'Player accepted. Decision and feedback sent to their inbox.' : 'Application declined. Decision and feedback sent to their inbox.'); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async lifecycle(status: LifecycleStatus): Promise<void> {
    const c = this.campaign(); if (!c || this.busy()) return;
    this.busy.set(true);
    try { await this.service.setLifecycle(c.id, status); this.message.set(`Campaign status changed to ${status}.`); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async contact(uid: string): Promise<void> {
    const c = this.campaign(); if (!c || this.busy()) return;
    if (!this.auth.user()) { await this.router.navigate(['/account'], { queryParams: { returnTo: `/games/${c.id}` } }); return; }
    this.busy.set(true);
    try { const id = await this.messages.contact(c.id, uid); await this.router.navigate(['/inbox'], { queryParams: { thread: id } }); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  calendar(): void {
    const c = this.campaign(); if (!c?.startTime) return;
    const utc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    // Fold by Unicode code points to keep each UTF-8 content line <= 75 octets.
    const fold = (line: string) => { const lines: string[] = []; let part = ''; let bytes = 0; for (const char of line) { const size = new TextEncoder().encode(char).length; if (bytes + size > 75) { lines.push(part); part = ' '; bytes = 1; } part += char; bytes += size; } lines.push(part); return lines.join('\r\n'); };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Gathering Table//Sessions//EN', 'BEGIN:VEVENT', `UID:${c.id}@the-gathering-table`, `SEQUENCE:${c.scheduleRevision}`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(c.startTime.toDate())}`, `DTEND:${utc(new Date(c.startTime.toMillis() + c.sessionLengthHours * 3600000))}`, `SUMMARY:${escape(c.name)}`, `DESCRIPTION:${escape(`${c.systemType} · ${c.scheduleState === 'Confirmed' ? 'Confirmed by GM' : 'Awaiting GM confirmation'}`)}`, `STATUS:${c.scheduleState === 'Confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`, 'END:VEVENT', 'END:VCALENDAR'];
    const url = URL.createObjectURL(new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'gathering-table-session.ics'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}


import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { CampaignService } from '../core/campaign.service';
import { ModerationService } from '../core/moderation.service';
import { AccountAction, SHORT_DURATIONS, BAN_DURATIONS, defaultAccess, restrictionActive, restrictionEnd } from '../core/moderation';
import { friendlyError } from '../core/error';
@Component({ imports: [DatePipe, RouterLink, ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './moderation.component.html' })
export class ModerationComponent {
  readonly auth = inject(AuthService); private readonly moderation = inject(ModerationService); private readonly campaigns = inject(CampaignService);
  private readonly route = inject(ActivatedRoute);
  readonly busy = signal(false); readonly message = signal(''); readonly target = signal(''); readonly campaignId = signal('');
  readonly shortDurations = SHORT_DURATIONS; readonly banDurations = BAN_DURATIONS; readonly restrictionEnd = restrictionEnd; readonly restrictionActive = restrictionActive;
  readonly accountForm = new FormGroup({ uid: new FormControl('', { nonNullable: true }), kind: new FormControl<AccountAction>('Timeout', { nonNullable: true }), role: new FormControl('Member', { nonNullable: true }), duration: new FormControl('3600', { nonNullable: true }), reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(2000)] }) });
  readonly contentForm = new FormGroup({ id: new FormControl('', { nonNullable: true }), name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }), description: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(20000)] }), reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(2000)] }) });
  readonly kind = toSignal(this.accountForm.controls.kind.valueChanges, { initialValue: 'Timeout' as AccountAction });
  readonly people = toSignal(toObservable(this.auth.staff).pipe(switchMap(staff => staff ? this.moderation.watchPeople().pipe(catchError(() => of([]))) : of([]))), { initialValue: [] });
  readonly owner = toSignal(toObservable(this.auth.staff).pipe(switchMap(staff => staff ? this.moderation.watchOwner().pipe(catchError(() => of(''))) : of(''))), { initialValue: '' });
  readonly access = toSignal(toObservable(this.target).pipe(switchMap(uid => uid ? this.moderation.watchAccess(uid).pipe(catchError(error => { this.message.set(friendlyError(error)); return of(defaultAccess()); })) : of(defaultAccess()))), { initialValue: defaultAccess() });
  readonly actions = toSignal(toObservable(this.target).pipe(switchMap(uid => uid ? this.moderation.watchAccountActions(uid).pipe(catchError(() => of([]))) : of([]))), { initialValue: [] });
  readonly campaign = toSignal(toObservable(this.campaignId).pipe(switchMap(id => id ? this.campaigns.watchCampaign(id) : of(null))));
  readonly campaignActions = toSignal(toObservable(this.campaignId).pipe(switchMap(id => id ? this.moderation.watchCampaignActions(id).pipe(catchError(() => of([]))) : of([]))), { initialValue: [] });
  constructor() {
    effect(() => { this.accountForm.controls.duration.setValue(this.kind() === 'Ban' ? '604800' : '3600'); });
    effect(() => { const c = this.campaign(); if (c) this.contentForm.patchValue({ name: c.name, description: c.description }); });
    effect(() => { const params = this.route.snapshot.queryParamMap; if (this.auth.staff()) { const uid = params.get('account'); const id = params.get('campaign'); if (uid) { this.accountForm.controls.uid.setValue(uid); this.target.set(uid); } if (id) { this.contentForm.controls.id.setValue(id); this.campaignId.set(id); } } });
  }
  loadAccount(): void { this.target.set(this.accountForm.controls.uid.value.trim()); this.message.set(''); }
  loadCampaign(): void { this.campaignId.set(this.contentForm.controls.id.value.trim()); this.message.set(''); }
  async act(): Promise<void> {
    if (this.busy() || !this.target() || this.accountForm.invalid) return;
    if (this.target() !== this.accountForm.controls.uid.value.trim()) { this.message.set('Load the selected account before taking an action.'); return; } this.busy.set(true); this.message.set('');
    try { const v = this.accountForm.getRawValue(); await this.moderation.accountAction(this.target(), v.kind, v.kind === 'Role' ? v.role : Number(v.duration), v.reason); this.accountForm.controls.reason.reset(); this.message.set('Account action recorded.'); }
    catch (error) { this.message.set(friendlyError(error)); } finally { this.busy.set(false); }
  }
  async saveContent(): Promise<void> {
    if (this.busy() || !this.campaign() || this.contentForm.invalid) return;
    if (this.campaignId() !== this.contentForm.controls.id.value.trim()) { this.message.set('Load the selected campaign before saving moderation.'); return; } this.busy.set(true); this.message.set('');
    try { const v = this.contentForm.getRawValue(); await this.moderation.editCampaign(this.campaignId(), v.name, v.description, v.reason); this.contentForm.controls.reason.reset(); this.message.set('Campaign content updated and audit recorded.'); }
    catch (error) { this.message.set(friendlyError(error)); } finally { this.busy.set(false); }
  }
}

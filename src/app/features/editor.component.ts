import { prepareCampaignBackground } from '../core/profile-photo';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, startWith } from 'rxjs';
import { DatePipe } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { CampaignService } from '../core/campaign.service';
import { CampaignInput, Frequency, FREQUENCIES, SYSTEMS, System, PLATFORMS, VOICE_SERVICES, TableDetails } from '../core/models';
import { dateInZone, localToDate } from '../core/time';
import { friendlyError } from '../core/error';

@Component({ imports: [ReactiveFormsModule, RouterLink, DatePipe], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './editor.component.html' })
export class EditorComponent {
  readonly auth = inject(AuthService);
  private readonly service = inject(CampaignService);
  private readonly router = inject(Router);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly systems = SYSTEMS;
  readonly frequencies = FREQUENCIES;
  readonly platforms = PLATFORMS;
  readonly voiceServices = VOICE_SERVICES;
  readonly zones = [...new Set([Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'])];
  readonly busy = signal(false);
  readonly backgroundBusy = signal(false);
  readonly backgroundPreview = signal('');
  readonly loading = signal(!!this.id);
  readonly blocked = signal(false);
  readonly message = signal('');
  readonly acceptedPlayers = signal(0);
  readonly alreadyScheduled = signal(false);
  readonly form = new FormGroup({
    openRecruitment: new FormControl(false, { nonNullable: true }),
    backgroundImageURL: new FormControl('', { nonNullable: true }),
    tableType: new FormControl<TableDetails['tableType']>('Virtual', { nonNullable: true }),
    location: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    virtualPlatform: new FormControl<TableDetails['virtualPlatform']>('Fantasy Grounds'),
    platformOther: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    voiceService: new FormControl<TableDetails['voiceService']>('Discord'),
    voiceOther: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    paid: new FormControl(false, { nonNullable: true }),
    recorded: new FormControl(false, { nonNullable: true }),
    broadcast: new FormControl(false, { nonNullable: true }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    systemType: new FormControl<System>('RMU', { nonNullable: true }),
    minPlayers: new FormControl(3, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(20)] }),
    maxPlayers: new FormControl(5, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(20)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(20000)] }),
    sessionLengthHours: new FormControl(3, { nonNullable: true, validators: [Validators.required, Validators.min(0.5), Validators.max(24)] }),
    frequency: new FormControl<Frequency>('Weekly', { nonNullable: true }),
    startMode: new FormControl<'Fixed' | 'Rolling'>('Rolling', { nonNullable: true }),
    localDateTime: new FormControl('', { nonNullable: true }),
    timeZone: new FormControl(Intl.DateTimeFormat().resolvedOptions().timeZone, { nonNullable: true, validators: [Validators.required] }),
    occurrence: new FormControl<'reject' | 'earlier' | 'later'>('reject', { nonNullable: true }),
  });
  readonly values = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  readonly rolling = computed(() => this.values().startMode === 'Rolling');
  readonly schedulingLocked = computed(() => this.rolling() && !this.alreadyScheduled() && this.acceptedPlayers() < (this.values().minPlayers ?? 1));
  constructor() {
    effect(() => {
      const values = this.values();
      const controls = this.form.controls;
      controls.location.setValidators(values.tableType === 'Physical' ? [Validators.required, Validators.maxLength(300)] : [Validators.maxLength(300)]);
      controls.platformOther.setValidators(values.tableType === 'Virtual' && values.virtualPlatform === 'Other' ? [Validators.required, Validators.maxLength(100)] : [Validators.maxLength(100)]);
      controls.voiceOther.setValidators(values.tableType !== 'Physical' && values.voiceService === 'Other' ? [Validators.required, Validators.maxLength(100)] : [Validators.maxLength(100)]);
      controls.virtualPlatform.setValidators(values.tableType === 'Virtual' ? [Validators.required] : []);
      controls.voiceService.setValidators(values.tableType !== 'Physical' ? [Validators.required] : []);
      for (const control of [controls.location, controls.platformOther, controls.voiceOther, controls.virtualPlatform, controls.voiceService]) control.updateValueAndValidity({ emitEvent: false });
    });
    effect(() => {
      const control = this.form.controls.localDateTime;
      control.setValidators(this.rolling() && !this.alreadyScheduled() ? [] : [Validators.required]);
      if (this.schedulingLocked()) control.disable({ emitEvent: false });
      else control.enable({ emitEvent: false });
      control.updateValueAndValidity({ emitEvent: false });
    });
    if (this.id) void this.load();
  }
  preview(): Date | null {
    const value = this.values();
    try { return value.localDateTime && value.timeZone ? localToDate(value.localDateTime, value.timeZone, value.occurrence) : null; }
    catch { return null; }
  }
  async submit(): Promise<void> {
    if (this.form.invalid || this.busy() || this.backgroundBusy() || this.blocked()) { this.form.markAllAsTouched(); this.message.set('Complete the required fields.'); return; }
    this.busy.set(true); this.message.set('');
    try { const id = await this.service.saveCampaign(this.form.getRawValue() as CampaignInput, this.id ?? undefined); await this.router.navigate(['/games', id]); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async chooseBackground(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    this.backgroundBusy.set(true); this.message.set('');
    try { const image = await prepareCampaignBackground(file); this.form.controls.backgroundImageURL.setValue(image); this.backgroundPreview.set(image); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.backgroundBusy.set(false); input.value = ''; }
  }
  removeBackground(): void { this.form.controls.backgroundImageURL.setValue(''); this.backgroundPreview.set(''); }
  private async load(): Promise<void> {
    try {
      const c = await firstValueFrom(this.service.watchCampaign(this.id!));
      if (!c || c.status === 'Completed') { this.blocked.set(true); throw new Error('This campaign cannot be edited.'); }
      this.backgroundPreview.set(c.backgroundImageURL ?? '');
      this.acceptedPlayers.set(c.currentPlayers);
      this.alreadyScheduled.set(!!c.startTime);
      this.form.patchValue({ ...c, virtualPlatform: c.virtualPlatform ?? 'Fantasy Grounds', voiceService: c.voiceService ?? 'Discord', localDateTime: c.startTime ? dateInZone(c.startTime.toDate(), c.timeZone) : '' });
    } catch (error) { this.blocked.set(true); this.message.set(friendlyError(error)); }
    finally { this.loading.set(false); }
  }
}



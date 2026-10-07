import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { CampaignService } from '../core/campaign.service';
import { friendlyError } from '../core/error';
import { prepareProfilePhoto } from '../core/profile-photo';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  imports: [ReactiveFormsModule, RouterLink, AvatarComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account.component.html',
})
export class AccountComponent {
  readonly auth = inject(AuthService);
  private readonly service = inject(CampaignService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly mode = signal<'login' | 'register'>('login');
  readonly busy = signal(false);
  readonly message = signal('');
  readonly photoPreview = signal('');
  readonly photoBusy = signal(false);
  readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });
  readonly profileForm = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    biography: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(4000)] }),
    allowCampaignMessages: new FormControl(true, { nonNullable: true }),
    photoURL: new FormControl('', { nonNullable: true }),
  });
  readonly profile = toSignal(toObservable(this.auth.user).pipe(switchMap(user => user ? this.service.watchProfile(user.uid).pipe(catchError(error => { this.message.set(friendlyError(error)); return of(null); })) : of(null))));
  constructor() {
    effect(() => {
      const profile = this.profile();
      const uid = this.auth.user()?.uid;
      if (uid) { this.photoPreview.set(profile?.photoURL ?? ''); this.profileForm.reset({ username: profile?.username ?? '', biography: profile?.biography ?? '', allowCampaignMessages: profile?.allowCampaignMessages ?? true, photoURL: profile?.photoURL ?? '' }); }
    });
  }
  async enterDemo(role: 'player' | 'gm'): Promise<void> {
    this.auth.enterDemo(role);
    await this.returnTo();
  }
  async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) { this.form.markAllAsTouched(); return; }
    this.busy.set(true); this.message.set('');
    try {
      const { username, email, password } = this.form.getRawValue();
      if (this.mode() === 'register') {
        if (!username.trim()) throw new Error('Enter your public player name.');
        const uid = await this.auth.register(email, password);
        await this.service.saveProfile(username, '', uid);
      } else await this.auth.login(email, password);
      await this.returnTo();
    } catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async reset(): Promise<void> {
    if (this.form.controls.email.invalid) { this.message.set('Enter your email above first.'); return; }
    this.busy.set(true);
    try { await this.auth.reset(this.form.controls.email.value); this.message.set('If an account exists, password-reset instructions will be sent to that address.'); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.busy() || this.photoBusy()) { this.profileForm.markAllAsTouched(); return; }
    this.busy.set(true);
    try { const p = this.profileForm.getRawValue(); await this.service.saveProfile(p.username, p.biography, this.auth.user()!.uid, p.allowCampaignMessages, p.photoURL); this.message.set('Profile saved.'); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
  async choosePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    this.photoBusy.set(true); this.message.set('');
    try { const photo = await prepareProfilePhoto(file); this.profileForm.controls.photoURL.setValue(photo); this.photoPreview.set(photo); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.photoBusy.set(false); input.value = ''; }
  }
  removePhoto(): void { this.profileForm.controls.photoURL.setValue(''); this.photoPreview.set(''); }
  async logout(): Promise<void> {
    try { await this.auth.logout(); this.message.set('Signed out.'); }
    catch (error) { this.message.set(friendlyError(error)); }
  }
  private async returnTo(): Promise<void> {
    const target = this.route.snapshot.queryParamMap.get('returnTo');
    if (target && /^\/(games(?:\/[A-Za-z0-9_-]+)?|host)$/.test(target)) await this.router.navigateByUrl(target);
  }
}

import { AvatarComponent } from '../shared/avatar.component';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { CampaignService } from '../core/campaign.service';
import { friendlyError } from '../core/error';

@Component({ imports: [AvatarComponent, RouterLink, DatePipe, ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './profile.component.html' })
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private readonly service = inject(CampaignService);
  private readonly route = inject(ActivatedRoute);
  readonly uid = toSignal(this.route.paramMap.pipe(map(p => p.get('uid')!)), { initialValue: this.route.snapshot.paramMap.get('uid')! });
  readonly campaignId = toSignal(this.route.queryParamMap.pipe(map(p => p.get('campaign'))), { initialValue: this.route.snapshot.queryParamMap.get('campaign') });
  readonly reviewingCampaign = toSignal(toObservable(this.campaignId).pipe(switchMap(id => id ? this.service.watchCampaign(id).pipe(catchError(() => of(null))) : of(null))));
  readonly message = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly profile = toSignal(this.route.paramMap.pipe(switchMap(p => this.service.watchProfile(p.get('uid')!).pipe(catchError(error => { this.error.set(friendlyError(error)); return of(null); })))));
  readonly reviews = toSignal(this.route.paramMap.pipe(switchMap(p => this.service.watchReviews(p.get('uid')!).pipe(catchError(error => { this.error.set(friendlyError(error)); return of([]); })))), { initialValue: [] });
  readonly form = new FormGroup({
    rating: new FormControl(5, { nonNullable: true, validators: [Validators.min(1), Validators.max(5)] }),
    text: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(2000)] }),
  });
  async submit(): Promise<void> {
    if (!this.campaignId() || this.form.invalid || this.busy()) return;
    this.busy.set(true);
    try { const review = this.form.getRawValue(); await this.service.review(this.uid(), this.campaignId()!, review.rating, review.text); this.message.set('Your review has been published.'); this.form.reset(); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busy.set(false); }
  }
}


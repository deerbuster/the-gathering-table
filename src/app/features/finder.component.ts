import { CONTENT_RATINGS, PLAYER_AGES, TAG_GROUPS, matchesPreferences } from '../core/campaign-preferences';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { CampaignService } from '../core/campaign.service';
import { AuthService } from '../core/auth.service';
import { Campaign, DAYS, SYSTEMS, matchesPaymentFilter } from '../core/models';
import { friendlyError } from '../core/error';
import { GameCardComponent } from '../shared/game-card.component';

@Component({
  selector: 'app-finder', imports: [ReactiveFormsModule, RouterLink, GameCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finder.component.html',
})
export class FinderComponent {
  readonly auth = inject(AuthService);
  private readonly service = inject(CampaignService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly requestedView = toSignal(this.route.queryParamMap.pipe(map(params => params.get('view'))));
  constructor() { effect(() => { if (this.requestedView() === 'applications') { this.filters.reset({ search: '', system: '', day: '', hideFull: false, lifecycle: '', payment: 'all', newbie: false, playStyle: '', playerAge: '', contentRating: '' }); this.showMine(false); } }); }
  readonly ratings = CONTENT_RATINGS;
  readonly playerAges = PLAYER_AGES;
  readonly playStyles = TAG_GROUPS[1].tags;
  readonly systems = SYSTEMS;
  readonly days = DAYS;
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly message = signal('');
  readonly error = signal('');
  readonly mineError = signal('');
  readonly busyId = signal<string | null>(null);
  readonly view = signal<'all' | 'mine'>('all');
  readonly filters = new FormGroup({
    newbie: new FormControl(false, { nonNullable: true }),
    playStyle: new FormControl('', { nonNullable: true }),
    playerAge: new FormControl('', { nonNullable: true }),
    contentRating: new FormControl('', { nonNullable: true }),
    search: new FormControl('', { nonNullable: true }),
    system: new FormControl('', { nonNullable: true }),
    day: new FormControl('', { nonNullable: true }),
    payment: new FormControl<'all' | 'free' | 'paid'>('all', { nonNullable: true }),
    hideFull: new FormControl(true, { nonNullable: true }),
    lifecycle: new FormControl('Recruiting', { nonNullable: true }),
  });
  private readonly filterValues = toSignal(this.filters.valueChanges.pipe(startWith(this.filters.getRawValue())), { initialValue: this.filters.getRawValue() });
  readonly catalog = toSignal(this.service.discoverableCampaigns$.pipe(catchError(error => { this.error.set(friendlyError(error)); return of([] as Campaign[]); })));
  readonly myGames = toSignal(toObservable(this.auth.user).pipe(switchMap(user => {
    this.mineError.set('');
    return user ? combineLatest([this.service.watchMine(user.uid), this.service.watchHosted(user.uid), this.service.watchApplications(user.uid), this.service.watchRetired(user.uid)]).pipe(
      map(([joined, hosted, applied, retired]) => [...new Map([...joined, ...hosted, ...applied, ...retired].map(c => [c.id, c])).values()]),
      catchError(error => { this.mineError.set(friendlyError(error)); return of([] as Campaign[]); }),
    ) : of([] as Campaign[]);
  })));
  showAll(): void { this.view.set('all'); void this.router.navigate([], { relativeTo: this.route, queryParams: {} }); }
  showMine(clearApplicationFilter = true): void {
    if (clearApplicationFilter && this.requestedView() === 'applications') void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    this.view.set('mine');
    this.filters.controls.lifecycle.setValue('');
    this.filters.controls.hideFull.setValue(false);
  }
  readonly results = computed(() => {
    const f = this.filterValues();
    const rows = this.view() === 'mine' ? this.myGames() : this.catalog();
    return (rows ?? []).filter(c =>
      (this.requestedView() !== 'applications' || (c.gmUserId === this.auth.user()?.uid && c.pendingPlayerIds.length > 0 && c.lifecycleStatus !== 'Completed')) &&
      (!f.search || `${c.name} ${c.gmName} ${c.description}`.toLowerCase().includes(f.search.toLowerCase())) &&
      (!f.system || c.systemType === f.system) && (!f.day || (f.day === 'TBD' ? c.dayOfWeek === null : c.dayOfWeek === f.day)) &&
      (!f.lifecycle || (f.lifecycle === 'Recruiting' ? ['Open', 'Full'].includes(c.status) : c.lifecycleStatus === f.lifecycle)) &&
      matchesPaymentFilter(c, f.payment ?? 'all') && matchesPreferences(c, f) &&
      (!f.hideFull || c.status !== 'Full'),
    ).sort((a, b) => (a.startTime?.toMillis() ?? Infinity) - (b.startTime?.toMillis() ?? Infinity));
  });
  readonly openCount = computed(() => this.catalog()?.filter(c => c.status === 'Open').length ?? 0);
  reset(): void { this.filters.reset({ search: '', system: '', day: '', hideFull: true, lifecycle: 'Recruiting', payment: 'all', newbie: false, playStyle: '', playerAge: '', contentRating: '' }); }
  reload(): void { window.location.reload(); }
  async join(c: Campaign): Promise<void> {
    if (!this.auth.user()) { await this.router.navigate(['/account'], { queryParams: { returnTo: `/games/${c.id}` } }); return; }
    if (this.busyId()) return;
    this.busyId.set(c.id); this.message.set('');
    try { await this.service.join(c.id); this.message.set(c.startMode === 'Rolling' ? `Application sent to ${c.gmName}. Your seat counts once the GM accepts you.` : `Your seat at ${c.name} is reserved${this.auth.demo ? ' in this demo' : ''}.`); }
    catch (error) { this.message.set(friendlyError(error)); }
    finally { this.busyId.set(null); }
  }
}


import { CampaignPreferencesComponent } from './campaign-preferences.component';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Campaign } from '../core/models';

@Component({
  selector: 'app-game-card',
  imports: [CampaignPreferencesComponent, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="game-card" [attr.data-system]="campaign().systemType">
      <div class="card-top"><span class="system-tag">{{ campaign().systemType }}</span><span class="payment-tag">{{ campaign().paid ? 'Paid' : 'Free' }}</span><span class="status-badge" [class.full]="campaign().status === 'Closed'" [class.completed]="campaign().status === 'Completed'">{{ campaign().lifecycleStatus }}</span></div>
      <div class="card-heading"><span class="table-symbol" aria-hidden="true">{{ symbol() }}</span><h2><a [routerLink]="['/games', campaign().id]">{{ campaign().name }}</a></h2></div>
      <p class="gm-line">Hosted by <a [routerLink]="['/profile', campaign().gmUserId]">{{ campaign().gmName }}</a></p>
      @if (gm() && campaign().pendingPlayerIds.length && campaign().lifecycleStatus !== 'Completed') { <a class="text-link" [routerLink]="['/games', campaign().id]">{{ campaign().pendingPlayerIds.length }} pending {{ campaign().pendingPlayerIds.length === 1 ? 'application' : 'applications' }} <span class="unread-badge" aria-hidden="true">{{ campaign().pendingPlayerIds.length }}</span></a> }
      <app-campaign-preferences [campaign]="campaign()" [compact]="true"/><p class="card-description line-clamp-2">{{ excerpt() }}</p>
      <p class="field-help">{{ campaign().tableType }} · {{ campaign().tableType === 'Physical' ? campaign().location : campaign().tableType === 'Virtual' ? (campaign().virtualPlatform === 'Other' ? campaign().platformOther : campaign().virtualPlatform) : (campaign().voiceService === 'Other' ? campaign().voiceOther : campaign().voiceService) }}@if (campaign().recorded) { · Recorded }@if (campaign().broadcast) { · Broadcast }</p>
      <div class="card-schedule"><div><span class="meta-label">{{ campaign().startTime ? 'NEXT SESSION · YOUR TIME' : 'ROLLING START' }}</span>@if (campaign().startTime; as start) { <strong>{{ start.toDate() | date:'EEE, MMM d' }}</strong><span>{{ start.toDate() | date:'shortTime' }} · {{ campaign().sessionLengthHours }} hrs</span> } @else { <strong>Date to be decided</strong><span>Scheduled after {{ campaign().minPlayers }} players are accepted</span> }</div><span class="frequency">{{ campaign().frequency }}</span></div>
      <div class="seat-label"><span><strong>{{ campaign().currentPlayers }}</strong> / {{ campaign().maxPlayers }} {{ campaign().startMode === 'Rolling' ? 'accepted' : 'player seats' }}</span><span>Min. {{ campaign().minPlayers }}</span></div>
      <div class="seat-track" role="progressbar" aria-label="Filled player seats" [attr.aria-valuemin]="0" [attr.aria-valuemax]="campaign().maxPlayers" [attr.aria-valuenow]="campaign().currentPlayers"><div [style.width.%]="campaign().currentPlayers / campaign().maxPlayers * 100"></div></div>
      <p class="readiness" [class.ready]="campaign().currentPlayers >= campaign().minPlayers">@if (campaign().status === 'Preparing') { Setup in progress · recruitment not open } @else if (campaign().status === 'Completed') { Campaign completed } @else if (campaign().scheduleState === 'Confirmed') { <span aria-hidden="true">✓</span> Session confirmed by GM } @else if (campaign().currentPlayers >= campaign().minPlayers) { {{ campaign().startTime ? 'Minimum met · awaiting GM confirmation' : 'Minimum met · ready to schedule' }} } @else { {{ campaign().minPlayers - campaign().currentPlayers }} more {{ campaign().minPlayers - campaign().currentPlayers === 1 ? 'player' : 'players' }} to reach minimum }</p>
      <div class="card-actions"><a class="text-link" [routerLink]="['/games', campaign().id]">View campaign <span aria-hidden="true">↗</span></a><button class="button primary compact" type="button" (click)="join.emit(campaign())" [disabled]="busy() || unavailable() || joined() || pending() || gm()">{{ busy() ? 'Please wait…' : gm() ? 'Your table' : joined() ? 'Accepted ✓' : pending() ? 'Applied' : campaign().status === 'Preparing' ? 'Not recruiting' : campaign().status === 'Full' ? 'Table full' : unavailable() ? 'Closed' : campaign().startMode === 'Rolling' ? 'Apply to join' : 'Join game' }}</button></div>
    </article>
  `,
})
export class GameCardComponent {
  readonly campaign = input.required<Campaign>();
  readonly uid = input<string | null>(null);
  readonly busy = input(false);
  readonly join = output<Campaign>();
  readonly excerpt = computed(() => this.campaign().description.split(/\n\s*\n/)[0].replace(/[*#`]/g, ''));
  readonly joined = computed(() => !!this.uid() && this.campaign().playerIds.includes(this.uid()!));
  readonly pending = computed(() => !!this.uid() && this.campaign().pendingPlayerIds.includes(this.uid()!));
  readonly gm = computed(() => this.campaign().gmUserId === this.uid());
  readonly unavailable = computed(() => this.campaign().status !== 'Open' || (this.campaign().startTime?.toMillis() ?? Infinity) <= Date.now());
  readonly symbol = computed(() => this.campaign().systemType === 'Space Master' ? '✦' : this.campaign().systemType === 'MERP' ? '❧' : '⚔');
}


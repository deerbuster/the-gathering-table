import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CampaignPreferences, CONTENT_RATINGS } from '../core/campaign-preferences';
@Component({ selector: 'app-campaign-preferences', changeDetection: ChangeDetectionStrategy.OnPush, template: `
  @if (!compact() || campaign().playerAge || campaign().contentRating || (campaign().tags ?? []).includes('Newbie friendly')) {
    <div class="campaign-tags" aria-label="Campaign preferences">
      @if (campaign().playerAge) { <span class="campaign-tag">Players: {{ campaign().playerAge }}</span> } @else if (!compact()) { <span class="muted">Player age: not specified</span> }
      @if (campaign().contentRating) { <span class="campaign-tag">{{ ratingLabel() }}</span> } @else if (!compact()) { <span class="muted">Content rating: not specified</span> }
      @for (tag of campaign().tags ?? []; track tag) { @if (!compact() || tag === 'Newbie friendly') { <span class="campaign-tag">{{ tag }}</span> } }
    </div>
  }
  @if (!compact()) { @if (campaign().contentRating) { <p class="field-help">{{ ratingDescription() }} GM-selected guidance.</p> } @if (campaign().contentNotes) { <p class="content-notes">{{ campaign().contentNotes }}</p> } }
` })
export class CampaignPreferencesComponent {
  readonly campaign = input.required<CampaignPreferences>();
  readonly compact = input(false);
  ratingLabel(): string { const rating = CONTENT_RATINGS.find(r => r.value === this.campaign().contentRating); return rating ? `${rating.value} · ${rating.label}` : ''; }
  ratingDescription(): string { return CONTENT_RATINGS.find(r => r.value === this.campaign().contentRating)?.description ?? ''; }
}

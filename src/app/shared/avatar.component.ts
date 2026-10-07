import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
@Component({ selector: 'app-avatar', changeDetection: ChangeDetectionStrategy.OnPush, template: `@if (photoURL() && !failed()) { <img [src]="photoURL()" [alt]="name() + ' profile picture'" (error)="failed.set(true)" class="profile-avatar" [class.large]="large()"> } @else { <span class="profile-avatar" [class.large]="large()" aria-hidden="true">{{ name().slice(0, 1) }}</span> }` })
export class AvatarComponent {
  readonly name = input('Adventurer'); readonly photoURL = input<string | undefined>(''); readonly large = input(false);
  readonly failed = signal(false);
  constructor() { effect(() => { this.photoURL(); this.failed.set(false); }); }
}

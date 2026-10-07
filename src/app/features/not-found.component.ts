import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({ imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: '<div class="empty-state"><h1>This trail ends here.</h1><p>We could not find that page.</p><a routerLink="/games" class="button primary">Find games</a></div>' })
export class NotFoundComponent {}

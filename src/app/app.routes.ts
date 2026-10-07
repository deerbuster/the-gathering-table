import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'games' },
  { path: 'games', loadComponent: () => import('./features/finder.component').then(m => m.FinderComponent) },
  { path: 'host', loadComponent: () => import('./features/editor.component').then(m => m.EditorComponent) },
  { path: 'games/:id/edit', loadComponent: () => import('./features/editor.component').then(m => m.EditorComponent) },
  { path: 'games/:id', loadComponent: () => import('./features/detail.component').then(m => m.DetailComponent) },
  { path: 'account', loadComponent: () => import('./features/account.component').then(m => m.AccountComponent) },
  { path: 'inbox', loadComponent: () => import('./features/inbox.component').then(m => m.InboxComponent) },
  { path: 'profile/:uid', loadComponent: () => import('./features/profile.component').then(m => m.ProfileComponent) },
  { path: '**', loadComponent: () => import('./features/not-found.component').then(m => m.NotFoundComponent) },
];

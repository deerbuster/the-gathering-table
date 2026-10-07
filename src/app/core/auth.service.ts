import { inject, Injectable, signal, DestroyRef, runInInjectionContext, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth, authState } from '@angular/fire/auth';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { RUNTIME } from './runtime';
import { Identity } from './models';
import { DEMO_GM, DEMO_PLAYER } from './demo-data';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth, { optional: true });
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  readonly demo = !inject(RUNTIME).firebase;
  readonly user = signal<Identity | null>(null);
  readonly ready = signal(this.demo);

  constructor() {
    if (this.auth) {
      runInInjectionContext(this.injector, () => authState(this.auth!))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(user => {
          this.user.set(user ? { uid: user.uid, email: user.email } : null);
          this.ready.set(true);
        });
    }
  }

  enterDemo(role: 'player' | 'gm'): void {
    if (!this.demo) return;
    this.user.set({ uid: role === 'gm' ? DEMO_GM : DEMO_PLAYER, email: null });
  }
  async login(email: string, password: string): Promise<void> {
    if (!this.auth) throw new Error('Use a sample identity in demo mode.');
    await signInWithEmailAndPassword(this.auth, email, password);
  }
  async register(email: string, password: string): Promise<string> {
    if (!this.auth) throw new Error('Account registration requires Firebase setup.');
    const result = await createUserWithEmailAndPassword(this.auth, email, password);
    this.user.set({ uid: result.user.uid, email: result.user.email });
    return result.user.uid;
  }
  async reset(email: string): Promise<void> {
    if (!this.auth) throw new Error('Password reset requires Firebase setup.');
    await sendPasswordResetEmail(this.auth, email);
  }
  async logout(): Promise<void> {
    if (this.auth) await signOut(this.auth);
    this.user.set(null);
  }
}

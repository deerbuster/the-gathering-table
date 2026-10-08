import { inject, Injectable, signal, computed, DestroyRef } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { doc, onSnapshot } from 'firebase/firestore';
import { AccountAccess, defaultAccess, restrictionActive } from './moderation';
import { createUserWithEmailAndPassword, sendEmailVerification, reload, getIdToken, onIdTokenChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { RUNTIME } from './runtime';
import { Identity } from './models';
import { DEMO_GM, DEMO_PLAYER } from './demo-data';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly firestore = inject(Firestore, { optional: true });
  private stopAccess: (() => void) | undefined;
  readonly access = signal<AccountAccess>(defaultAccess());
  private readonly demoAccounts: Record<string, AccountAccess> = {};
  setDemoAccess(uid: string, access: AccountAccess): void { this.demoAccounts[uid] = access; if (this.demo && this.user()?.uid === uid) this.access.set(access); }
  readonly accessReady = signal(false);
  readonly accessError = signal('');
  readonly now = signal(Date.now());
  readonly verified = computed(() => this.demo || this.user()?.emailVerified === true);
  readonly banned = computed(() => restrictionActive(this.access().ban, this.now()));
  readonly timedOut = computed(() => restrictionActive(this.access().timeout, this.now()));
  readonly muted = computed(() => restrictionActive(this.access().mute, this.now()));
  readonly staff = computed(() => !!this.user() && this.verified() && this.accessReady() && !this.banned() && !this.timedOut() && ['Admin','Moderator'].includes(this.access().role));
  readonly admin = computed(() => this.staff() && this.access().role === 'Admin');
  readonly demo = !inject(RUNTIME).firebase;
  readonly user = signal<Identity | null>(null);
  readonly ready = signal(this.demo);

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => { clearInterval(timer); this.stopAccess?.(); });
    if (this.auth) {
      const stop = onIdTokenChanged(this.auth, user => {
        this.stopAccess?.(); this.access.set(defaultAccess()); this.accessReady.set(!user); this.accessError.set('');
        this.user.set(user ? { uid: user.uid, email: user.email, emailVerified: user.emailVerified } : null);
        this.ready.set(true);
        if (user && this.firestore) this.stopAccess = onSnapshot(doc(this.firestore, 'accountAccess', user.uid), snapshot => {
          this.access.set(snapshot.exists() ? snapshot.data() as AccountAccess : defaultAccess()); this.accessReady.set(true);
        }, () => { this.accessError.set('Account permissions could not be checked. Refresh before making changes.'); this.accessReady.set(false); });
      });
      this.destroyRef.onDestroy(stop);
    } else this.accessReady.set(true);
  }
  requireParticipation(communication = false): string {
    const user = this.user(); if (!user) throw new Error('Sign in first.');
    if (!this.verified()) throw new Error('Verify your email before participating.');
    if (!this.accessReady()) throw new Error('Wait for your account permissions to load.');
    if (this.banned()) throw new Error('Your account is banned. See My account for the reason and expiry.');
    if (this.timedOut()) throw new Error('Your account is timed out. See My account for the expiry.');
    if (communication && this.muted()) throw new Error('Your account is muted. Messages and reviews are temporarily unavailable.');
    return user.uid;
  }
  async sendVerification(): Promise<void> {
    const user = this.auth?.currentUser; if (!user) throw new Error('Sign in first.');
    await sendEmailVerification(user, { url: window.location.origin + '/the-gathering-table/#/account' });
  }
  async refreshVerification(): Promise<void> {
    const user = this.auth?.currentUser; if (!user) return;
    await reload(user); await getIdToken(user, true);
    this.user.set({ uid: user.uid, email: user.email, emailVerified: user.emailVerified });
  }
  enterDemo(role: 'player' | 'gm'): void {
    if (!this.demo) return;
    this.user.set({ uid: role === 'gm' ? DEMO_GM : DEMO_PLAYER, email: null, emailVerified: true });
    this.access.set(this.demoAccounts[this.user()!.uid] ?? { ...defaultAccess(), role: role === 'gm' ? 'Admin' : 'Member' }); this.accessReady.set(true);
  }
  async login(email: string, password: string): Promise<void> {
    if (!this.auth) throw new Error('Use a sample identity in demo mode.');
    await signInWithEmailAndPassword(this.auth, email, password);
  }
  async register(email: string, password: string): Promise<string> {
    if (!this.auth) throw new Error('Account registration requires Firebase setup.');
    const result = await createUserWithEmailAndPassword(this.auth, email, password);
    this.user.set({ uid: result.user.uid, email: result.user.email, emailVerified: result.user.emailVerified });
    await this.sendVerification();
    return result.user.uid;
  }
  async reset(email: string): Promise<void> {
    if (!this.auth) throw new Error('Password reset requires Firebase setup.');
    await sendPasswordResetEmail(this.auth, email);
  }
  async logout(): Promise<void> {
    if (this.auth) await signOut(this.auth);
    this.user.set(null); this.access.set(defaultAccess()); this.accessReady.set(this.demo);
  }
}

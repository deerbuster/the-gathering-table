import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, collectionData, docData } from '@angular/fire/firestore';
import { collection, doc, getDoc, limit, orderBy, query, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { BehaviorSubject, firstValueFrom, map, Observable, of } from 'rxjs';
import { AuthService } from './auth.service';
import { CampaignService } from './campaign.service';
import { demoProfiles, DEMO_GM } from './demo-data';
import { AccountAccess, AccountAction, AuditEntry, defaultAccess, validateAction } from './moderation';
@Injectable({ providedIn: 'root' })
export class ModerationService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly campaigns = inject(CampaignService);
  private readonly demoAccess = new BehaviorSubject<Record<string, AccountAccess>>({ [DEMO_GM]: { ...defaultAccess(), role: 'Admin' } });
  private readonly logs = new BehaviorSubject<Record<string, AuditEntry[]>>({});
  watchPeople(): Observable<{ uid: string; username: string }[]> {
    if (!this.firestore) return of(Object.entries(demoProfiles()).map(([uid, p]) => ({ uid, username: p.username })));
    return runInInjectionContext(this.injector, () => collectionData(query(collection(this.firestore!, 'users'), orderBy('username'), limit(100)), { idField: 'uid' })) as Observable<{ uid: string; username: string }[]>;
  }
  watchAccess(uid: string): Observable<AccountAccess> {
    if (!this.firestore) return this.demoAccess.pipe(map(all => all[uid] ?? defaultAccess()));
    return runInInjectionContext(this.injector, () => docData(doc(this.firestore!, 'accountAccess', uid))).pipe(map(value => value ? value as AccountAccess : defaultAccess()));
  }
  watchOwner(): Observable<string> {
    if (!this.firestore) return of(DEMO_GM);
    return runInInjectionContext(this.injector, () => docData(doc(this.firestore!, 'siteSecurity', 'owner'))).pipe(map(value => String(value?.['uid'] ?? '')));
  }
  watchAccountActions(uid: string): Observable<AuditEntry[]> { return this.watchLog('accountAccess', uid); }
  watchCampaignActions(id: string): Observable<AuditEntry[]> { return this.watchLog('campaigns', id); }
  private watchLog(collectionName: string, id: string): Observable<AuditEntry[]> {
    if (!this.firestore) return this.logs.pipe(map(all => all[collectionName + '/' + id] ?? []));
    return runInInjectionContext(this.injector, () => collectionData(query(collection(this.firestore!, collectionName, id, 'actions'), orderBy('createdAt', 'desc'), limit(50)), { idField: 'id' })) as Observable<AuditEntry[]>;
  }
  private async actor(): Promise<{ uid: string; name: string }> {
    const uid = this.auth.requireParticipation();
    if (!this.auth.staff()) throw new Error('Admin or Moderator access required.');
    const profile = await firstValueFrom(this.campaigns.watchProfile(uid));
    if (!profile) throw new Error('Create your player profile before moderating.');
    return { uid, name: profile.username };
  }
  async accountAction(uid: string, kind: AccountAction, value: string | number, reason: string): Promise<void> {
    validateAction(kind, value, reason); const actor = await this.actor();
    const owner = await firstValueFrom(this.watchOwner());
    if (!uid || uid === actor.uid || uid === owner) throw new Error('You cannot take actions against yourself or the protected owner account.');
    if (kind === 'Role' && !this.auth.admin()) throw new Error('Only Admins can assign roles.');
    const change = (before: AccountAccess, timestamp: unknown, id: string) => {
      if (before.role !== 'Member' && !this.auth.admin()) throw new Error('Only Admins can moderate staff accounts.');
      const patch: Record<string, unknown> = {};
      if (kind === 'Role') patch['role'] = value;
      if (['Timeout','Mute','Ban'].includes(kind)) patch[kind.toLowerCase()] = { startedAt: timestamp, seconds: Number(value), permanent: kind === 'Ban' && Number(value) === 0 };
      if (kind === 'ClearTimeout') patch['timeout'] = null;
      if (kind === 'ClearMute') patch['mute'] = null;
      if (kind === 'Unban') patch['ban'] = null;
      return { ...before, ...patch, revision: before.revision + 1, updatedAt: timestamp, lastActionId: id };
    };
    if (!this.firestore) {
      const before = this.demoAccess.value[uid] ?? defaultAccess(); const id = crypto.randomUUID(); const now = Timestamp.now(); const after = change(before, now, id) as AccountAccess;
      this.demoAccess.next({ ...this.demoAccess.value, [uid]: after }); this.auth.setDemoAccess(uid, after); this.logDemo('accountAccess/' + uid, { id, actorUid: actor.uid, actorName: actor.name, kind, reason: reason.trim(), createdAt: now, before, after }); return;
    }
    const stateRef = doc(this.firestore, 'accountAccess', uid); const actionRef = doc(collection(stateRef, 'actions'));
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(stateRef); const before = snapshot.exists() ? snapshot.data() as AccountAccess : defaultAccess();
      const after = change(before, serverTimestamp(), actionRef.id);
      transaction.set(stateRef, after);
      transaction.set(actionRef, { actorUid: actor.uid, actorName: actor.name, kind, reason: reason.trim(), createdAt: serverTimestamp(), before, after });
    });
  }
  async editCampaign(id: string, name: string, description: string, reason: string): Promise<void> {
    const actor = await this.actor();
    if (!name.trim() || name.length > 120 || !description.trim() || description.length > 20000 || !reason.trim() || reason.length > 2000) throw new Error('Enter a name, description, and moderation reason within their length limits.');
    const patch = { name: name.trim(), description };
    if (!this.firestore) {
      const before = await firstValueFrom(this.campaigns.watchCampaign(id)); if (!before) throw new Error('Campaign unavailable.');
      await this.campaigns.moderateDemoContent(id, patch.name, patch.description);
      this.logDemo('campaigns/' + id, { id: crypto.randomUUID(), actorUid: actor.uid, actorName: actor.name, kind: 'ContentEdit', reason: reason.trim(), createdAt: Timestamp.now(), before: { name: before.name, description: before.description }, after: patch }); return;
    }
    const campaignRef = doc(this.firestore, 'campaigns', id); const auditRef = doc(collection(campaignRef, 'actions'));
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(campaignRef); if (!snapshot.exists()) throw new Error('Campaign unavailable.'); const before = snapshot.data();
      transaction.update(campaignRef, { ...patch, moderationRevision: (before['moderationRevision'] ?? 0) + 1, lastModerationId: auditRef.id });
      transaction.set(auditRef, { actorUid: actor.uid, actorName: actor.name, kind: 'ContentEdit', reason: reason.trim(), createdAt: serverTimestamp(), before: { name: before['name'], description: before['description'] }, after: patch });
    });
  }
  private logDemo(key: string, entry: AuditEntry): void { this.logs.next({ ...this.logs.value, [key]: [entry, ...(this.logs.value[key] ?? [])] }); }
}

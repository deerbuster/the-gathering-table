import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, collectionData, docData } from '@angular/fire/firestore';
import { addDoc, collection, doc, query, runTransaction, serverTimestamp, Timestamp, where, orderBy } from 'firebase/firestore';
import { BehaviorSubject, combineLatest, firstValueFrom, map, Observable, of, shareReplay, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { CampaignService } from './campaign.service';
import { Campaign, acceptPatch } from './models';

export interface Conversation {
  id: string;
  campaignId: string;
  campaignName: string;
  participantIds: string[];
  createdBy: string;
  createdAt: Timestamp;
}
export interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: Timestamp | null;
  decision?: 'Accepted' | 'Declined';
}
@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly campaigns = inject(CampaignService);
  private readonly conversations = new BehaviorSubject<Conversation[]>([]);
  private readonly messages = new BehaviorSubject<Record<string, Message[]>>({});
  private readonly readTimes = new BehaviorSubject<Record<string, Timestamp>>({});
  private readonly unreadStreams = new Map<string, Observable<Record<string, number>>>();

  async decideApplication(campaignId: string, applicantUid: string, accepted: boolean, feedback: string): Promise<void> {
    const uid = this.requireUser(); const note = feedback.trim();
    if (note.length > 3000) throw new Error('Keep feedback to 3,000 characters.');
    const participantIds = [uid, applicantUid].sort();
    const id = `${campaignId}_${participantIds.join('_')}`;
    const decision = accepted ? 'Accepted' as const : 'Declined' as const;
    const textFor = (name: string) => `Application ${decision.toLowerCase()} · ${name}${note ? '\n\n' + note : ''}`;
    if (!this.firestore) {
      const campaign = await firstValueFrom(this.campaigns.watchCampaign(campaignId));
      if (!campaign) throw new Error('Campaign unavailable.');
      await this.campaigns[accepted ? 'accept' : 'reject'](campaignId, applicantUid);
      if (!this.conversations.value.some(c => c.id === id)) this.conversations.next([...this.conversations.value, { id, campaignId, campaignName: campaign.name, participantIds, createdBy: uid, createdAt: Timestamp.now() }]);
      this.messages.next({ ...this.messages.value, [id]: [...(this.messages.value[id] ?? []), { id: crypto.randomUUID(), senderId: uid, text: textFor(campaign.name), decision, createdAt: Timestamp.now() }] });
      return;
    }
    const campaignRef = doc(this.firestore, 'campaigns', campaignId);
    const threadRef = doc(this.firestore, 'conversations', id);
    const messageRef = doc(collection(this.firestore, 'conversations', id, 'messages'));
    await runTransaction(this.firestore, async tx => {
      const [campaignSnapshot, threadSnapshot] = await Promise.all([tx.get(campaignRef), tx.get(threadRef)]);
      const campaign = campaignSnapshot.data() as Campaign | undefined;
      if (!campaign || campaign.gmUserId !== uid || campaign.status === 'Completed' || !campaign.pendingPlayerIds.includes(applicantUid)) throw new Error('This application is no longer awaiting a decision.');
      tx.update(campaignRef, accepted ? acceptPatch(campaign, uid, applicantUid) : { pendingPlayerIds: campaign.pendingPlayerIds.filter(player => player !== applicantUid) });
      if (!threadSnapshot.exists()) tx.set(threadRef, { campaignId, campaignName: campaign.name, participantIds, createdBy: uid, createdAt: serverTimestamp() });
      tx.set(messageRef, { senderId: uid, text: textFor(campaign.name), decision, createdAt: serverTimestamp() });
    });
  }

  watchUnread(uid: string): Observable<Record<string, number>> {
    const cached = this.unreadStreams.get(uid); if (cached) return cached;
    const stream = this.watchInbox(uid).pipe(switchMap(rows => rows.length ? combineLatest(rows.map(c => {
      const receipt = this.firestore
        ? runInInjectionContext(this.injector, () => docData(doc(this.firestore!, 'conversations', c.id, 'reads', uid))).pipe(map(data => data?.['readThrough'] as Timestamp | undefined))
        : this.readTimes.pipe(map(times => times[`${c.id}/${uid}`]));
      return combineLatest([this.watchMessages(c.id), receipt]).pipe(map(([messages, readThrough]) => [c.id, messages.filter(m => m.senderId !== uid && m.createdAt && (!readThrough || m.createdAt.valueOf() > readThrough.valueOf())).length] as const));
    })).pipe(map(entries => Object.fromEntries(entries))) : of({})), shareReplay({ bufferSize: 1, refCount: true }));
    this.unreadStreams.set(uid, stream); return stream;
  }
  async markRead(conversationId: string, incoming: Message[]): Promise<void> {
    const uid = this.requireUser();
    const dated = incoming.filter(m => m.senderId !== uid && m.createdAt);
    if (!dated.length) return;
    const latest = dated.reduce((a, b) => a.createdAt!.valueOf() > b.createdAt!.valueOf() ? a : b).createdAt!;
    if (!this.firestore) {
      const key = `${conversationId}/${uid}`;
      if (!this.readTimes.value[key] || latest.valueOf() > this.readTimes.value[key].valueOf()) this.readTimes.next({ ...this.readTimes.value, [key]: latest });
      return;
    }
    const reference = doc(this.firestore, 'conversations', conversationId, 'reads', uid);
    await runTransaction(this.firestore, async tx => {
      const existing = (await tx.get(reference)).data()?.['readThrough'] as Timestamp | undefined;
      if (!existing || latest.valueOf() > existing.valueOf()) tx.set(reference, { readThrough: latest });
    });
  }

  watchInbox(uid: string): Observable<Conversation[]> {
    if (!this.firestore) return this.conversations.pipe(map(rows => rows.filter(c => c.participantIds.includes(uid))));
    return runInInjectionContext(this.injector, () => collectionData(query(collection(this.firestore!, 'conversations'), where('participantIds', 'array-contains', uid)), { idField: 'id' }) as Observable<Conversation[]>);
  }
  watchMessages(id: string): Observable<Message[]> {
    if (!this.firestore) return this.messages.pipe(map(rows => rows[id] ?? []));
    return runInInjectionContext(this.injector, () => collectionData(query(collection(this.firestore!, 'conversations', id, 'messages'), orderBy('createdAt', 'asc')), { idField: 'id' }) as Observable<Message[]>);
  }
  async contact(campaignId: string, targetUid: string): Promise<string> {
    const uid = this.requireUser();
    if (uid === targetUid) throw new Error('Choose another person to message.');
    const [campaign, target] = await Promise.all([firstValueFrom(this.campaigns.watchCampaign(campaignId)), firstValueFrom(this.campaigns.watchProfile(targetUid))]);
    if (!campaign || !target) throw new Error('This campaign or player profile is unavailable.');
    const eligible = targetUid === campaign.gmUserId || ((campaign.playerIds.includes(targetUid) || campaign.retiredPlayerIds.includes(targetUid)) && target.allowCampaignMessages);
    if (!eligible) throw new Error('This player has not opted into campaign messages.');
    const participantIds = [uid, targetUid].sort();
    const id = `${campaignId}_${participantIds.join('_')}`;
    if (!this.firestore) {
      if (!this.conversations.value.some(c => c.id === id)) this.conversations.next([...this.conversations.value, { id, campaignId, campaignName: campaign.name, participantIds, createdBy: uid, createdAt: Timestamp.now() }]);
      return id;
    }
    const reference = doc(this.firestore, 'conversations', id);
    await runTransaction(this.firestore, async transaction => {
      const existing = await transaction.get(reference);
      if (!existing.exists()) transaction.set(reference, { campaignId, campaignName: campaign.name, participantIds, createdBy: uid, createdAt: serverTimestamp() });
    });
    return id;
  }
  async send(conversation: Conversation, text: string): Promise<void> {
    const uid = this.requireUser();
    const body = text.trim();
    if (!body || body.length > 4000) throw new Error('Write a message of up to 4,000 characters.');
    if (!conversation.participantIds.includes(uid)) throw new Error('This conversation is private.');
    const targetUid = conversation.participantIds.find(id => id !== uid)!;
    const [campaign, target] = await Promise.all([firstValueFrom(this.campaigns.watchCampaign(conversation.campaignId)), firstValueFrom(this.campaigns.watchProfile(targetUid))]);
    if (!campaign || !target || !(targetUid === conversation.createdBy || targetUid === campaign.gmUserId || ((campaign.playerIds.includes(targetUid) || campaign.retiredPlayerIds.includes(targetUid)) && target.allowCampaignMessages))) throw new Error('This recipient is not accepting campaign messages.');
    if (!this.firestore) {
      this.messages.next({ ...this.messages.value, [conversation.id]: [...(this.messages.value[conversation.id] ?? []), { id: crypto.randomUUID(), senderId: uid, text: body, createdAt: Timestamp.now() }] });
      return;
    }
    await addDoc(collection(this.firestore, 'conversations', conversation.id, 'messages'), { senderId: uid, text: body, createdAt: serverTimestamp() });
  }
  private requireUser(): string { return this.auth.requireParticipation(true); }
}

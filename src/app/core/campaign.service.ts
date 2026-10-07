import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, collectionData } from '@angular/fire/firestore';
import {
  Timestamp, collection, doc, getDoc, query, runTransaction,
  setDoc, where,
} from 'firebase/firestore';
import { BehaviorSubject, Observable, of, map } from 'rxjs';
import { AuthService } from './auth.service';
import {
  Campaign, CampaignInput, Profile, Review, LifecycleStatus,
  joinPatch, leavePatch, validateInput, applyPatch, acceptPatch,
} from './models';
import { demoCampaigns, demoProfiles } from './demo-data';
import { localToDate, scheduleDay } from './time';
import { validProfilePhoto, validCampaignBackground } from './profile-photo';

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly samples = new BehaviorSubject<Campaign[]>(demoCampaigns());
  private readonly profiles = new BehaviorSubject<Record<string, Profile>>(demoProfiles());
  private readonly reviews = new BehaviorSubject<Record<string, Review[]>>({});

  readonly discoverableCampaigns$: Observable<Campaign[]> = this.firestore
    ? collectionData(query(collection(this.firestore, 'campaigns'), where('status', 'in', ['Preparing', 'Open', 'Full', 'Closed', 'Completed'])), { idField: 'id' }) as Observable<Campaign[]>
    : this.samples.asObservable();

  readonly openCampaigns$: Observable<Campaign[]> = this.firestore
    ? collectionData(query(collection(this.firestore, 'campaigns'), where('status', '==', 'Open')), { idField: 'id' }) as Observable<Campaign[]>
    : this.samples.pipe(map(rows => rows.filter(c => c.status === 'Open')));

  watchCampaign(id: string): Observable<Campaign | null> {
    if (!this.firestore) return this.samples.pipe(map(rows => rows.find(c => c.id === id) ?? null));
    return runInInjectionContext(this.injector, () =>
      collectionData(query(collection(this.firestore!, 'campaigns'), where('__name__', '==', id)), { idField: 'id' })
        .pipe(map(rows => rows.length ? rows[0] as Campaign : null)),
    );
  }
  watchMine(uid: string): Observable<Campaign[]> {
    if (!this.firestore) return this.samples.pipe(map(rows => rows.filter(c => c.gmUserId === uid || c.playerIds.includes(uid))));
    // Merge these in the feature; two indexed queries avoid reading the whole catalog.
    return runInInjectionContext(this.injector, () => collectionData(
      query(collection(this.firestore!, 'campaigns'), where('playerIds', 'array-contains', uid)), { idField: 'id' },
    ) as Observable<Campaign[]>);
  }
  watchHosted(uid: string): Observable<Campaign[]> {
    if (!this.firestore) return this.samples.pipe(map(rows => rows.filter(c => c.gmUserId === uid)));
    return runInInjectionContext(this.injector, () => collectionData(
      query(collection(this.firestore!, 'campaigns'), where('gmUserId', '==', uid)), { idField: 'id' },
    ) as Observable<Campaign[]>);
  }
  watchApplications(uid: string): Observable<Campaign[]> {
    if (!this.firestore) return this.samples.pipe(map(rows => rows.filter(c => c.pendingPlayerIds.includes(uid))));
    return runInInjectionContext(this.injector, () => collectionData(
      query(collection(this.firestore!, 'campaigns'), where('pendingPlayerIds', 'array-contains', uid)), { idField: 'id' },
    ) as Observable<Campaign[]>);
  }
  watchRetired(uid: string): Observable<Campaign[]> {
    if (!this.firestore) return this.samples.pipe(map(rows => rows.filter(c => c.retiredPlayerIds.includes(uid))));
    return runInInjectionContext(this.injector, () => collectionData(
      query(collection(this.firestore!, 'campaigns'), where('retiredPlayerIds', 'array-contains', uid)), { idField: 'id' },
    ) as Observable<Campaign[]>);
  }
  watchProfile(uid: string): Observable<Profile | null> {
    if (!this.firestore) return this.profiles.pipe(map(profiles => profiles[uid] ?? { username: 'Sample adventurer', biography: '', pastPlayerReviews: [], allowCampaignMessages: false }));
    return runInInjectionContext(this.injector, () => collectionData(
      query(collection(this.firestore!, 'users'), where('__name__', '==', uid)),
    ).pipe(map(rows => rows.length ? rows[0] as Profile : null)));
  }
  watchReviews(uid: string): Observable<Review[]> {
    if (!this.firestore) return this.reviews.pipe(map(all => all[uid] ?? []));
    return runInInjectionContext(this.injector, () => collectionData(
      collection(this.firestore!, 'users', uid, 'reviews'), { idField: 'id' },
    ) as Observable<Review[]>);
  }
  async saveProfile(username: string, biography: string, uid = this.requireUser(), allowCampaignMessages = true, photoURL = ''): Promise<void> {
    if (uid !== this.requireUser()) throw new Error('You can only edit your own profile.');
    if (!validProfilePhoto(photoURL)) throw new Error('Choose a valid profile picture.');
    if (!username.trim() || username.length > 60 || biography.length > 4000) throw new Error('Enter a name of up to 60 characters and a biography of up to 4,000.');
    if (!this.firestore) {
      const old = this.profiles.value[uid];
      this.profiles.next({ ...this.profiles.value, [uid]: { username: username.trim(), biography, pastPlayerReviews: old?.pastPlayerReviews ?? [], allowCampaignMessages, photoURL } });
      return;
    }
    const reference = doc(this.firestore, 'users', uid);
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) transaction.update(reference, { username: username.trim(), biography, allowCampaignMessages, photoURL });
      else transaction.set(reference, { username: username.trim(), biography, pastPlayerReviews: [], allowCampaignMessages, photoURL });
    });
  }
  async saveCampaign(input: CampaignInput, existingId?: string): Promise<string> {
    const uid = this.requireUser();
    validateInput(input);
    if (!validCampaignBackground(input.backgroundImageURL ?? '')) throw new Error('Choose a valid campaign background.');
    const start = input.localDateTime ? localToDate(input.localDateTime, input.timeZone, input.occurrence) : null;
    if (start && start.getTime() <= Date.now()) throw new Error('Choose a future session time.');
    const profile = this.firestore
      ? (await getDoc(doc(this.firestore, 'users', uid))).data() as Profile | undefined
      : this.profiles.value[uid];
    if (!profile) throw new Error('Create your player profile before hosting a campaign.');
    const scheduling = {
      backgroundImageURL: input.backgroundImageURL ?? '',
      tableType: input.tableType,
      location: input.tableType === 'Physical' ? input.location.trim() : '',
      virtualPlatform: input.tableType === 'Virtual' ? input.virtualPlatform : null,
      platformOther: input.tableType === 'Virtual' && input.virtualPlatform === 'Other' ? input.platformOther.trim() : '',
      voiceService: input.tableType !== 'Physical' ? input.voiceService : null,
      voiceOther: input.tableType !== 'Physical' && input.voiceService === 'Other' ? input.voiceOther.trim() : '',
      recorded: input.recorded, broadcast: input.broadcast, paid: input.paid,
      name: input.name.trim(), systemType: input.systemType,
      minPlayers: input.minPlayers, maxPlayers: input.maxPlayers,
      description: input.description, sessionLengthHours: input.sessionLengthHours,
      frequency: input.frequency, timeZone: input.timeZone,
      startMode: input.startMode,
      localStartTime: start ? input.localDateTime.slice(11) : null, dayOfWeek: start ? scheduleDay(input.localDateTime) : null,
      startTime: start, scheduleState: 'Recruiting' as const,
    };
    if (!this.firestore) {
      const old = existingId ? this.samples.value.find(c => c.id === existingId) : undefined;
      if (existingId && (!old || old.gmUserId !== uid || old.status === 'Completed')) throw new Error('This campaign cannot be edited.');
      if (old && old.currentPlayers > input.maxPlayers) throw new Error('Maximum seats cannot be fewer than current players.');
      this.validateRollingSchedule(input, start, old);
      const id = existingId ?? crypto.randomUUID();
      const row: Campaign = {
        ...scheduling, id, gmUserId: uid, gmName: profile.username,
        playerIds: old?.playerIds ?? [], pendingPlayerIds: old?.pendingPlayerIds ?? [], retiredPlayerIds: old?.retiredPlayerIds ?? [], currentPlayers: old?.currentPlayers ?? 0,
        startTime: start ? Timestamp.fromDate(start) : null, scheduleRevision: old ? old.scheduleRevision + 1 : 0, lifecycleStatus: old?.lifecycleStatus ?? (input.openRecruitment ? 'New' : 'Preparing'), status: old ? (old.status === 'Preparing' ? 'Preparing' : old.status === 'Closed' ? 'Closed' : old.currentPlayers === input.maxPlayers ? 'Full' : 'Open') : (input.openRecruitment ? 'Open' : 'Preparing'),
      };
      this.samples.next([...this.samples.value.filter(c => c.id !== id), row]);
      return id;
    }
    const reference = existingId ? doc(this.firestore, 'campaigns', existingId) : doc(collection(this.firestore, 'campaigns'));
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      if (existingId) {
        if (!snapshot.exists()) throw new Error('Campaign no longer exists.');
        const old = snapshot.data() as Campaign;
        if (old.gmUserId !== uid || old.status === 'Completed') throw new Error('This campaign cannot be edited.');
        if (old.currentPlayers > input.maxPlayers) throw new Error('Maximum seats cannot be fewer than current players.');
        this.validateRollingSchedule(input, start, old);
        transaction.update(reference, { ...scheduling, scheduleRevision: old.scheduleRevision + 1, status: old.status === 'Preparing' ? 'Preparing' : old.status === 'Closed' ? 'Closed' : old.currentPlayers === input.maxPlayers ? 'Full' : 'Open' });
      } else {
        this.validateRollingSchedule(input, start);
        // Firestore converts this JS Date to a UTC-backed native Timestamp.
        transaction.set(reference, { ...scheduling, gmUserId: uid, gmName: profile.username, playerIds: [], pendingPlayerIds: [], retiredPlayerIds: [], currentPlayers: 0, scheduleRevision: 0, status: input.openRecruitment ? 'Open' : 'Preparing', lifecycleStatus: input.openRecruitment ? 'New' : 'Preparing' });
      }
    });
    return reference.id;
  }
  async join(id: string): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => c.startMode === 'Rolling' ? applyPatch(c, uid) : joinPatch(c, uid));
  }
  async accept(id: string, applicantUid: string): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => acceptPatch(c, uid, applicantUid));
  }
  async reject(id: string, applicantUid: string): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => {
      if (c.gmUserId !== uid || c.status === 'Completed' || !c.pendingPlayerIds.includes(applicantUid)) throw new Error('This application cannot be declined.');
      return { pendingPlayerIds: c.pendingPlayerIds.filter(player => player !== applicantUid) };
    });
  }
  async withdraw(id: string): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => {
      if (c.status === 'Completed' || !c.pendingPlayerIds.includes(uid)) throw new Error('No active application to withdraw.');
      return { pendingPlayerIds: c.pendingPlayerIds.filter(player => player !== uid) };
    });
  }
  async leave(id: string): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => leavePatch(c, uid));
  }
  async confirm(id: string): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => {
      if (c.gmUserId !== uid || c.status === 'Completed') throw new Error('Only the GM can confirm an active campaign.');
      if (c.currentPlayers < c.minPlayers) throw new Error('The minimum number of players has not been reached.');
      if (!c.startTime || c.startTime.toMillis() <= Date.now()) throw new Error('Schedule a future session before confirming.');
      return { scheduleState: 'Confirmed' };
    });
  }
  async complete(id: string): Promise<void> {
    await this.setLifecycle(id, 'Completed');
  }
  async setLifecycle(id: string, lifecycleStatus: LifecycleStatus): Promise<void> {
    const uid = this.requireUser();
    await this.change(id, c => {
      if (c.gmUserId !== uid || c.status === 'Completed') throw new Error('Only the GM can change an active campaign’s status.');
      if (lifecycleStatus === 'Established' && (c.lifecycleStatus === 'Preparing' || !c.startTime)) throw new Error('Schedule the first session before marking the campaign established.');
      if (lifecycleStatus === 'Preparing' && (c.playerIds.length || c.pendingPlayerIds.length || c.retiredPlayerIds.length)) throw new Error('Use Closed to pause recruitment for a campaign with player history.');
      return { lifecycleStatus, status: lifecycleStatus === 'Preparing' ? 'Preparing' : lifecycleStatus === 'Completed' ? 'Completed' : lifecycleStatus === 'Closed' ? 'Closed' : c.currentPlayers === c.maxPlayers ? 'Full' : 'Open' };
    });
  }
  async review(targetUid: string, campaignId: string, rating: number, text: string): Promise<void> {
    const uid = this.requireUser();
    if (uid === targetUid || !Number.isInteger(rating) || rating < 1 || rating > 5 || !text.trim() || text.length > 2000) throw new Error('Choose a rating from 1–5 and write a review of up to 2,000 characters.');
    const id = `${campaignId}_${uid}`;
    if (!this.firestore) {
      const c = this.samples.value.find(row => row.id === campaignId);
      const members = c ? [c.gmUserId, ...c.playerIds, ...c.retiredPlayerIds] : [];
      if (!c || c.status !== 'Completed' || !members.includes(uid) || !members.includes(targetUid)) throw new Error('Reviews require a completed campaign you both participated in.');
      const old = this.reviews.value[targetUid] ?? [];
      if (old.some(r => r.id === id)) throw new Error('You already reviewed this player for this campaign.');
      const review: Review = { id, rating, text: text.trim(), reviewerId: uid, reviewerName: this.profiles.value[uid]?.username ?? 'Sample adventurer', campaignId, createdAt: Timestamp.now() };
      this.reviews.next({ ...this.reviews.value, [targetUid]: [...old, review] });
      const target = this.profiles.value[targetUid] ?? { username: 'Sample adventurer', biography: '', pastPlayerReviews: [], allowCampaignMessages: false };
      this.profiles.next({ ...this.profiles.value, [targetUid]: { ...target, pastPlayerReviews: [...target.pastPlayerReviews, review].slice(0, 20) } });
      return;
    }
    const reviewRef = doc(this.firestore, 'users', targetUid, 'reviews', id);
    const targetRef = doc(this.firestore, 'users', targetUid);
    const reviewerRef = doc(this.firestore, 'users', uid);
    const campaignRef = doc(this.firestore, 'campaigns', campaignId);
    await runTransaction(this.firestore, async transaction => {
      const [existing, target, reviewer, campaign] = await Promise.all([
        transaction.get(reviewRef), transaction.get(targetRef), transaction.get(reviewerRef), transaction.get(campaignRef),
      ]);
      if (existing.exists()) throw new Error('You already reviewed this player for this campaign.');
      if (!target.exists() || !reviewer.exists() || !campaign.exists()) throw new Error('A player profile or campaign is missing.');
      const c = campaign.data() as Campaign;
      const members = [c.gmUserId, ...c.playerIds, ...c.retiredPlayerIds];
      if (c.status !== 'Completed' || !members.includes(uid) || !members.includes(targetUid)) throw new Error('Reviews require a completed campaign you both participated in.');
      const review: Review = { id, rating, text: text.trim(), reviewerId: uid, reviewerName: (reviewer.data() as Profile).username, campaignId, createdAt: Timestamp.now() };
      transaction.set(reviewRef, review);
      const cache = (target.data() as Profile).pastPlayerReviews;
      if (cache.length < 20) transaction.update(targetRef, { pastPlayerReviews: [...cache, review] });
    });
  }
  private requireUser(): string {
    const user = this.auth.user();
    if (!user) throw new Error('Sign in to take a seat or host a campaign.');
    return user.uid;
  }
  private validateRollingSchedule(input: CampaignInput, start: Date | null, old?: Campaign): void {
    if (old && old.startMode !== input.startMode) throw new Error('The start policy cannot change after publication.');
    if (old?.startTime && !start) throw new Error('Choose a replacement date when rescheduling an existing session.');
    if (input.startMode === 'Rolling' && start && !old?.startTime && (old?.currentPlayers ?? 0) < input.minPlayers) throw new Error('Accept the minimum number of players before scheduling the first session.');
  }
  private async change(id: string, change: (c: Campaign) => Partial<Campaign>): Promise<void> {
    if (!this.firestore) {
      const c = this.samples.value.find(row => row.id === id);
      if (!c) throw new Error('Campaign no longer exists.');
      const patch = change(c);
      this.samples.next(this.samples.value.map(row => row.id === id ? { ...row, ...patch } : row));
      return;
    }
    const reference = doc(this.firestore, 'campaigns', id);
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error('Campaign no longer exists.');
      transaction.update(reference, change({ ...snapshot.data(), id } as Campaign));
    });
  }
}




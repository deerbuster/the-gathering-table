import { CampaignPreferences, validatePreferences } from './campaign-preferences';
import { Timestamp } from 'firebase/firestore';

export const SYSTEMS = ['Rolemaster Classic', 'RMSS', 'RMFRP', 'RMU', 'Space Master', 'MERP', 'HARP'] as const;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const FREQUENCIES = ['One-shot', 'Weekly', 'Biweekly', 'Monthly'] as const;
export const PLATFORMS = ['Fantasy Grounds', 'FoundryVTT', 'Roll20', 'Other'] as const;
export const VOICE_SERVICES = ['Discord', 'Zoom', 'Google Meet', 'Microsoft Teams', 'Other'] as const;
export interface TableDetails {
  tableType: 'Physical' | 'Virtual' | 'Theater of the Mind';
  location: string;
  virtualPlatform: typeof PLATFORMS[number] | null;
  platformOther: string;
  voiceService: typeof VOICE_SERVICES[number] | null;
  voiceOther: string;
  recorded: boolean;
  broadcast: boolean;
}
export type System = typeof SYSTEMS[number];
export type Frequency = typeof FREQUENCIES[number];
export type Day = typeof DAYS[number];
export type LifecycleStatus = 'Preparing' | 'New' | 'Established' | 'Closed' | 'Completed';
export interface Campaign extends TableDetails, CampaignPreferences {
  moderationRevision?: number;
  lastModerationId?: string;
  backgroundImageURL?: string;
  paid?: boolean;
  id: string;
  name: string;
  systemType: System;
  gmUserId: string;
  gmName: string;
  minPlayers: number;
  maxPlayers: number;
  currentPlayers: number;
  playerIds: string[];
  pendingPlayerIds: string[];
  retiredPlayerIds: string[];
  startMode: 'Fixed' | 'Rolling';
  status: 'Preparing' | 'Open' | 'Full' | 'Closed' | 'Completed';
  lifecycleStatus: LifecycleStatus;
  scheduleState: 'Recruiting' | 'Confirmed';
  scheduleRevision: number;
  description: string;
  dayOfWeek: Day | null;
  sessionLengthHours: number;
  frequency: Frequency;
  startTime: Timestamp | null;
  timeZone: string;
  localStartTime: string | null;
}
export type CampaignInput = TableDetails & CampaignPreferences & Pick<Campaign, 'name' | 'systemType' | 'minPlayers' | 'maxPlayers' | 'description' | 'sessionLengthHours' | 'frequency' | 'timeZone' | 'startMode'> & {
  paid: boolean;
  openRecruitment?: boolean;
  backgroundImageURL?: string;
  localDateTime: string;
  occurrence: 'reject' | 'earlier' | 'later';
};
export interface Review {
  id?: string;
  rating: number;
  text: string;
  reviewerName: string;
  reviewerId: string;
  campaignId: string;
  createdAt: Timestamp;
}
export interface Profile {
  photoURL?: string;
  username: string;
  biography: string;
  pastPlayerReviews: Review[];
  allowCampaignMessages: boolean;
}
export interface Identity { uid: string; email: string | null; emailVerified?: boolean; }

export function validateInput(input: CampaignInput): void {
  validatePreferences(input);
  if (typeof input.paid !== 'boolean') throw new Error('Specify whether this is a paid game.');
  if (!['Physical', 'Virtual', 'Theater of the Mind'].includes(input.tableType)) throw new Error('Choose a table type.');
  if (input.tableType === 'Physical' && (!input.location.trim() || input.location.length > 300)) throw new Error('Enter a meeting location of up to 300 characters.');
  if (input.tableType === 'Virtual' && (!input.virtualPlatform || !PLATFORMS.includes(input.virtualPlatform))) throw new Error('Choose a virtual tabletop.');
  if (input.tableType === 'Virtual' && input.virtualPlatform === 'Other' && (!input.platformOther.trim() || input.platformOther.length > 100)) throw new Error('Specify your virtual tabletop (up to 100 characters).');
  if (input.tableType !== 'Physical' && (!input.voiceService || !VOICE_SERVICES.includes(input.voiceService))) throw new Error('Choose a voice service.');
  if (input.tableType !== 'Physical' && input.voiceService === 'Other' && (!input.voiceOther.trim() || input.voiceOther.length > 100)) throw new Error('Specify your voice service (up to 100 characters).');
  if (typeof input.recorded !== 'boolean' || typeof input.broadcast !== 'boolean') throw new Error('Specify recording and broadcast preferences.');
  if (!input.name.trim() || input.name.length > 120) throw new Error('Enter a campaign name of up to 120 characters.');
  if (!SYSTEMS.includes(input.systemType)) throw new Error('Choose an ICE system.');
  if (!FREQUENCIES.includes(input.frequency)) throw new Error('Choose a session frequency.');
  if (!['Fixed', 'Rolling'].includes(input.startMode)) throw new Error('Choose a start policy.');
  if (input.startMode === 'Fixed' && !input.localDateTime) throw new Error('Fixed-start campaigns need a session date.');
  if (!Number.isInteger(input.minPlayers) || !Number.isInteger(input.maxPlayers) || input.minPlayers < 1 || input.maxPlayers > 20 || input.minPlayers > input.maxPlayers) throw new Error('Choose 1–20 seats, with the minimum no greater than the maximum.');
  if (!Number.isFinite(input.sessionLengthHours) || input.sessionLengthHours < 0.5 || input.sessionLengthHours > 24) throw new Error('Choose a session length between 0.5 and 24 hours.');
  if (!input.description.trim() || input.description.length > 20000) throw new Error('Enter a description of up to 20,000 characters.');
}
export function matchesPaymentFilter(campaign: Pick<Campaign, 'paid'>, filter: 'all' | 'free' | 'paid'): boolean {
  return filter === 'all' || (filter === 'paid' ? campaign.paid === true : campaign.paid !== true);
}
export function joinPatch(c: Campaign, uid: string, now = Date.now()): Pick<Campaign, 'playerIds' | 'currentPlayers' | 'status'> {
  if (c.startMode === 'Rolling') throw new Error('This campaign requires GM acceptance. Apply for a seat first.');
  if (c.gmUserId === uid) throw new Error('The GM does not occupy a player seat.');
  if (c.playerIds.includes(uid)) throw new Error('You already have a seat at this table.');
  if (!recruitingOpen(c, now)) throw new Error('This table is no longer accepting players.');
  const playerIds = [...c.playerIds, uid];
  return { playerIds, currentPlayers: playerIds.length, status: playerIds.length === c.maxPlayers ? 'Full' : 'Open' };
}
export function recruitingOpen(c: Campaign, now = Date.now()): boolean {
  return c.status === 'Open' && c.currentPlayers < c.maxPlayers && (!c.startTime || c.startTime.toMillis() > now);
}
export function applyPatch(c: Campaign, uid: string): Pick<Campaign, 'pendingPlayerIds'> {
  if (c.startMode !== 'Rolling' || !recruitingOpen(c)) throw new Error('This campaign is not accepting applications.');
  if (c.gmUserId === uid || c.playerIds.includes(uid) || c.pendingPlayerIds.includes(uid)) throw new Error('You already belong to this table or have an application pending.');
  if (c.pendingPlayerIds.length >= 50) throw new Error('The application queue is full. Try again later.');
  return { pendingPlayerIds: [...c.pendingPlayerIds, uid] };
}
export function acceptPatch(c: Campaign, gmUid: string, applicantUid: string): Pick<Campaign, 'pendingPlayerIds' | 'playerIds' | 'currentPlayers' | 'status'> {
  if (c.gmUserId !== gmUid || c.startMode !== 'Rolling' || !recruitingOpen(c) || !c.pendingPlayerIds.includes(applicantUid)) throw new Error('This applicant cannot be accepted.');
  const playerIds = [...c.playerIds, applicantUid];
  return { playerIds, currentPlayers: playerIds.length, status: playerIds.length === c.maxPlayers ? 'Full' : 'Open', pendingPlayerIds: c.pendingPlayerIds.filter(id => id !== applicantUid) };
}
export function leavePatch(c: Campaign, uid: string): Pick<Campaign, 'playerIds' | 'retiredPlayerIds' | 'currentPlayers' | 'status' | 'scheduleState'> {
  if (c.status === 'Completed') throw new Error('Completed campaigns preserve their participant history.');
  if (!c.playerIds.includes(uid)) throw new Error('You do not have a seat at this table.');
  const playerIds = c.playerIds.filter(id => id !== uid);
  return { playerIds, retiredPlayerIds: c.retiredPlayerIds.includes(uid) ? c.retiredPlayerIds : [...c.retiredPlayerIds, uid], currentPlayers: playerIds.length, status: c.status === 'Closed' ? 'Closed' : 'Open', scheduleState: playerIds.length < c.minPlayers ? 'Recruiting' : c.scheduleState };
}

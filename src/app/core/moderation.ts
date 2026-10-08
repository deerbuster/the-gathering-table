import { Timestamp } from 'firebase/firestore';
export type SiteRole = 'Member' | 'Moderator' | 'Admin';
export type AccountAction = 'Role' | 'Timeout' | 'Mute' | 'Ban' | 'ClearTimeout' | 'ClearMute' | 'Unban';
export const SHORT_DURATIONS = [{ label: '1 hour', seconds: 3600 }, { label: '1 day', seconds: 86400 }, { label: '1 week', seconds: 604800 }];
export const BAN_DURATIONS = [{ label: '1 week', seconds: 604800 }, { label: '1 month (30 days)', seconds: 2592000 }, { label: '3 months (90 days)', seconds: 7776000 }, { label: 'Permanent', seconds: 0 }];
export interface Restriction { startedAt: Timestamp | null; seconds: number; permanent: boolean; }
export interface AccountAccess { role: SiteRole; timeout: Restriction | null; mute: Restriction | null; ban: Restriction | null; revision: number; lastActionId: string; updatedAt: Timestamp | null; }
export interface AuditEntry { id?: string; actorUid: string; actorName: string; reason: string; createdAt: Timestamp | null; kind: string; before: unknown; after: unknown; }
export function defaultAccess(): AccountAccess { return { role: 'Member', timeout: null, mute: null, ban: null, revision: 0, lastActionId: '', updatedAt: null }; }
export function restrictionActive(value: Restriction | null, now = Date.now()): boolean { return !!value && (value.permanent || (value.startedAt?.toMillis() ?? Infinity) + value.seconds * 1000 > now); }
export function restrictionEnd(value: Restriction | null): Date | null { return value?.startedAt && !value.permanent ? new Date(value.startedAt.toMillis() + value.seconds * 1000) : null; }
export function validateAction(kind: AccountAction, value: string | number, reason: string): void {
  if (!reason.trim() || reason.length > 2000) throw new Error('A reason of up to 2,000 characters is required.');
  if (kind === 'Role' && !['Member','Moderator','Admin'].includes(String(value))) throw new Error('Choose a role.');
  if (['Timeout','Mute'].includes(kind) && !SHORT_DURATIONS.some(d => d.seconds === Number(value))) throw new Error('Choose 1 hour, 1 day, or 1 week.');
  if (kind === 'Ban' && !BAN_DURATIONS.some(d => d.seconds === Number(value))) throw new Error('Choose a ban duration.');
  if (!['Role','Timeout','Mute','Ban','ClearTimeout','ClearMute','Unban'].includes(kind)) throw new Error('Choose an account action.');
}

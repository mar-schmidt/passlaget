export interface Team {
  id: string;
  slug: string;
  name: string;
  clubName: string;
  contactName: string;
  contactPhone: string;
  reminderDays: number[];
}
export interface Child {
  id: string;
  name: string;
  familyId: string;
  active: boolean;
}
export interface Adult {
  id: string;
  name: string;
  phone: string;
  email?: string;
  familyIds: string[];
  active: boolean;
}
export interface Family {
  id: string;
  label: string;
  active: boolean;
  exempt: boolean;
  unavailable?: { startsAt: string; endsAt: string }[];
}
export interface Role {
  id: string;
  name: string;
  instructions: string;
}
export type SlotStatus = 'pending' | 'confirmed' | 'completed' | 'absent' | 'cancelled';
export interface Slot {
  id: string;
  familyId?: string;
  adultId?: string;
  adultName?: string;
  adultPhone?: string;
  answer?: string;
  locked: boolean;
  revision: number;
  status: SlotStatus;
  confirmedAt?: string;
  confirmedRevision?: number;
  reminderRequestedAt?: string;
  reminderRevision?: number;
}
export interface Shift {
  /** Tasks use a single deadline: startsAt === endsAt; no on-site time interval. */
  kind?: 'shift' | 'task';
  title?: string;
  group?: string;
  countsTowardBalance?: boolean;
  endIsApproximate?: boolean;
  sharedPrompt?: string;
  sharedAnswer?: string;
  answerPrompt?: string;
  id: string;
  roleId: string;
  roleName: string;
  instructions: string;
  startsAt: string;
  endsAt: string;
  externalTeam?: string;
  slots: Slot[];
}
export interface EventDetails {
  bookingMode?: 'admin' | 'self';
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string;
  shifts: Shift[];
}
export interface PortalEvent {
  id: string;
  draft: EventDetails;
  published?: EventDetails;
  publication: number;
  cancelled: boolean;
  updatedAt: string;
}
export interface HistoryEntry {
  id: string;
  familyId: string;
  assignmentId: string;
  eventTitle: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  source: 'portal' | 'import';
  verified: boolean;
}
export interface ChangeRequest {
  id: string;
  eventId: string;
  slotId: string;
  familyId: string;
  message: string;
  requestedAt: string;
  status: 'open' | 'resolved' | 'declined';
}
export interface AuditEntry {
  id: string;
  at: string;
  actor: 'admin' | 'public';
  action: string;
  summary: string;
}
export interface PortalState {
  version: number;
  team: Team;
  families: Family[];
  children: Child[];
  adults: Adult[];
  roles: Role[];
  events: PortalEvent[];
  history: HistoryEntry[];
  requests: ChangeRequest[];
  audit: AuditEntry[];
}
export interface PublicState {
  version: number;
  team: Team;
  families: Family[];
  children: Child[];
  adults: Adult[];
  roles: Role[];
  events: PortalEvent[];
  requests: ChangeRequest[];
}
export type PortalCommand =
  | { type: 'save_family'; family: Family; children: Child[]; adults: Adult[] }
  | { type: 'save_role'; role: Role }
  | { type: 'save_event'; event: PortalEvent }
  | { type: 'copy_event'; eventId: string; newId: string; startDate: string }
  | { type: 'auto_plan'; eventId: string }
  | { type: 'publish_event'; eventId: string }
  | { type: 'cancel_event'; eventId: string }
  | {
      type: 'confirm';
      answer?: string;
      sharedAnswer?: string;
      eventId: string;
      slotId: string;
      revision: number;
      familyId: string;
      adultId?: string;
      adultName: string;
      adultPhone: string;
      adultEmail: string;
    }
  | {
      type: 'book';
      answer?: string;
      sharedAnswer?: string;
      eventId: string;
      slotId: string;
      revision: number;
      familyId: string;
      adultId?: string;
      adultName: string;
      adultPhone: string;
      adultEmail: string;
    }
  | {
      type: 'remind_confirmation';
      eventId: string;
      slotId: string;
      familyId: string;
      revision: number;
    }
  | {
      type: 'request_change';
      eventId: string;
      slotId: string;
      revision: number;
      familyId: string;
      message: string;
    }
  | {
      type: 'update_answers';
      eventId: string;
      slotId: string;
      revision: number;
      familyId: string;
      answer?: string;
      sharedAnswer?: string;
    }
  | { type: 'resolve_request'; requestId: string; status: 'resolved' | 'declined' }
  | { type: 'complete_slot'; eventId: string; slotId: string; completed: boolean }
  | { type: 'complete_slots'; eventId: string; slotIds: string[]; completed: boolean }
  | { type: 'review_history'; historyId: string; verified: boolean }
  | {
      type: 'import_data';
      families: Family[];
      children: Child[];
      adults: Adult[];
      history: HistoryEntry[];
    }
  | { type: 'update_team'; team: Team };
export interface Balance {
  familyId: string;
  completed: number;
  reserved: number;
  total: number;
  latest: string;
}
export interface PlanningResult {
  state: PortalState;
  notices: string[];
}
export interface CalendarEvent {
  deadline?: boolean;
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  description: string;
  url: string;
}

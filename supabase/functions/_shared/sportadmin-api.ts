/** Read-only SportAdmin adapter. Wire fields verified against SportAdmin's own protobuf models. */
export class SportAdminError extends Error {
  constructor(
    public code: 'auth' | 'upstream' | 'schema' | 'access',
    message = 'SportAdmin kunde inte läsas. Försök uppdatera igen.',
  ) {
    super(message);
  }
}
type Field = { number: number; value: number | bigint | Uint8Array };
export type Message = Field[];
const decoder = new TextDecoder('utf-8', { fatal: true });
const bad = (): never => {
  throw new SportAdminError(
    'schema',
    'SportAdmin skickade ett oväntat svar. Inga spelare har avaktiverats.',
  );
};
export function protobuf(bytes: Uint8Array): Message {
  let pos = 0;
  const read = () => {
    let n = 0n;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) return bad();
      const v = bytes[pos++];
      if (i === 9 && v > 1) return bad();
      n |= BigInt(v & 127) << BigInt(7 * i);
      if (!(v & 128)) {
        return n > BigInt(Number.MAX_SAFE_INTEGER) ? n : Number(n);
      }
    }
    return bad();
  };
  const result: Message = [];
  while (pos < bytes.length) {
    const tag = read();
    if (typeof tag !== 'number') return bad();
    const number = Math.floor(tag / 8),
      wire = tag % 8;
    if (!number) return bad();
    if (wire === 0) result.push({ number, value: read() });
    else if (wire === 2) {
      const length = read();
      if (typeof length !== 'number' || length > bytes.length - pos) return bad();
      result.push({ number, value: bytes.slice(pos, pos + length) });
      pos += length;
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4;
      if (pos > bytes.length) return bad();
    } else return bad();
  }
  return result;
}
export const number = (m: Message, n: number) => {
  const v = m.find((f) => f.number === n)?.value;
  if (v === undefined) return 0;
  if (typeof v !== 'number') return bad();
  return v;
};
export const text = (m: Message, n: number) => {
  const v = m.find((f) => f.number === n)?.value;
  if (v === undefined) return '';
  if (!(v instanceof Uint8Array)) return bad();
  try {
    return decoder.decode(v);
  } catch {
    return bad();
  }
};
export const messages = (m: Message, n: number): Message[] =>
  m
    .filter((f) => f.number === n)
    .map((f) => (f.value instanceof Uint8Array ? protobuf(f.value) : bad()));
const nestedNumber = (m: Message, n: number) => number(messages(m, n)[0] || [], 1);
const nestedText = (m: Message, n: number) => text(messages(m, n)[0] || [], 1);
export function encode(fields: [number, number | Uint8Array][]): Uint8Array {
  const bytes: number[] = [];
  const put = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0) return bad();
    let v = BigInt(n);
    do {
      const tail = v >> 7n;
      bytes.push(Number(v & 127n) | (tail ? 128 : 0));
      v = tail;
    } while (v);
  };
  for (const [field, value] of fields) {
    put(field * 8 + (typeof value === 'number' ? 0 : 2));
    if (typeof value === 'number') put(value);
    else {
      put(value.length);
      for (const byte of value) bytes.push(byte);
    }
  }
  return new Uint8Array(bytes);
}
export function decodeFrames(input: string): Message {
  if (input.length > 8_000_000) return bad();
  // gRPC-Web may base64-encode each frame independently, including padding.
  const chunks = input.replace(/\s/g, '').match(/[A-Za-z0-9+/]+={0,2}/g) || [];
  if (chunks.join('') !== input.replace(/\s/g, '')) return bad();
  const arrays = chunks.map((chunk) => {
    try {
      return Uint8Array.from(atob(chunk), (c) => c.charCodeAt(0));
    } catch {
      return bad();
    }
  });
  const bytes = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    bytes.set(a, offset);
    offset += a.length;
  }
  let pos = 0,
    message: Message | undefined,
    status: string | undefined;
  while (pos < bytes.length) {
    if (bytes.length - pos < 5) return bad();
    const flag = bytes[pos],
      size = new DataView(bytes.buffer).getUint32(pos + 1);
    pos += 5;
    if (size > bytes.length - pos) return bad();
    const body = bytes.slice(pos, pos + size);
    pos += size;
    if (flag === 128) status = decoder.decode(body).match(/(?:^|\r?\n)grpc-status:\s*(\d+)/)?.[1];
    else if (flag === 0 && !message) message = protobuf(body);
    else return bad();
  }
  if (status === '16')
    throw new SportAdminError('auth', 'Anslut SportAdmin igen. Inloggningen har löpt ut.');
  if (status === '7')
    throw new SportAdminError('access', 'Kontot saknar behörighet till dessa uppgifter.');
  if (status !== '0' || !message) return bad();
  return message;
}
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
export async function token(
  fields: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<Session> {
  const response = await fetcher('https://identity.sportadmin.se/connect/token', {
    method: 'POST',
    headers: {
      authorization: 'Basic U2EuQXBwLk1hdWk6',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new SportAdminError(
      response.status === 400 || response.status === 401 ? 'auth' : 'upstream',
      'SportAdmin kunde inte anslutas. Kontrollera inloggningen.',
    );
  const value = await response.json();
  if (
    typeof value.access_token !== 'string' ||
    typeof value.refresh_token !== 'string' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0
  )
    return bad();
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: Date.now() + value.expires_in * 1000,
  };
}
export interface Membership {
  clubId: number;
  clubName: string;
  memberId: number;
  groupId: number;
  subId: number;
  groupName?: string;
}
export interface Guardian {
  position: number;
  name: string;
  phone: string;
  email: string;
}
export interface RosterPlayer {
  id: number;
  name: string;
  active: boolean;
  guardians: Guardian[];
}
export interface Roster {
  clubId: number;
  groupId: number;
  groupName: string;
  checkedAt: string;
  players: RosterPlayer[];
}
interface LeaderContext {
  clubId: number;
  userId: number;
  groupId: number;
  teamId: number;
  periodId: number;
  groupName: string;
}
const readMethods = new Map([
  ['/GrpcMemberUserProfileService/GetUserProfiles', false],
  ['/GrpcMemberActivitiesService/GetMemberAppHomeActivities', false],
  ['/GrpcMemberActivitiesService/GetMemberAppActivityInformation', false],
  ['/GrpcMemberCallingsService/GetActivityCalling', false],
  ['/GrpcUserProfileService/GetUserProfiles', true],
  ['/GrpcTeamRegisterTeamService/GetTeamMembers', true],
  ['/GrpcUserGroupsService/GetMemberDetail', true],
]);
export function parseRoster(root: Message): RosterPlayer[] {
  if (number(root, 1) !== 1)
    throw new SportAdminError('access', 'Spelarregistret kunde inte läsas för det valda laget.');
  const seen = new Set<number>();
  const rows = messages(root, 2).filter((m) => number(m, 7) !== 1);
  // This endpoint returns the complete group, without pagination. An empty or
  // malformed response is never evidence that everyone has left the team.
  if (!rows.length || rows.length > 1000) return bad();
  return rows.map((m) => {
    const id = number(m, 2),
      name = `${text(m, 3)} ${text(m, 4)}`.trim();
    if (!id || !name || seen.has(id)) return bad();
    seen.add(id);
    return { id, name, active: number(m, 10) !== 1 && number(m, 19) === 1, guardians: [] };
  });
}
export function parseGuardians(root: Message, memberId: number): Guardian[] {
  const detail = messages(root, 3)[0];
  if (number(root, 1) !== 1 || !detail || number(detail, 17) !== memberId) return bad();
  if (number(detail, 19) === 1)
    throw new SportAdminError(
      'access',
      'En skyddad medlemsprofil behöver hanteras i SportAdmin. Inventeringen är oförändrad.',
    );
  return [
    [1, 12, 10, 11],
    [2, 15, 13, 14],
  ].flatMap(([position, nameField, phoneField, emailField]) => {
    const name = text(detail, nameField).trim();
    const phone = text(detail, phoneField).trim();
    const email = text(detail, emailField).trim().toLocaleLowerCase('sv');
    if (!name && !phone && !email) return [];
    if (name.length > 160 || phone.length > 80 || email.length > 254) return bad();
    return [{ position, name: name || `Vårdnadshavare ${position}`, phone, email }];
  });
}
export interface Activity {
  id: number;
  callingId: number;
  memberId: number;
  clubId: number;
  groupId: number;
  title: string;
  startsAt: string;
  endsAt: string;
}
export interface Participant {
  id: number;
  name: string;
  birthYear: string;
  answer: 'yes' | 'no' | 'unanswered' | 'unknown';
  hasQuit: boolean;
  removed: boolean;
}
export function parseParticipants(root: Message): Participant[] {
  if (number(root, 1) !== 1)
    throw new SportAdminError('access', 'Kallelsesvaren är inte tillgängliga för ditt konto.');
  const seen = new Set<number>();
  return messages(root, 10)
    .filter((m) => number(m, 7) !== 1 || number(m, 28) === 1)
    .map((m) => {
      const id = number(m, 1),
        name = `${text(m, 2)} ${text(m, 3)}`.trim();
      if (!id || !name || seen.has(id)) return bad();
      seen.add(id);
      const code = number(m, 9);
      return {
        id,
        name,
        birthYear: text(m, 5),
        answer:
          number(m, 11) !== 1
            ? 'unanswered'
            : code === 1
              ? 'yes'
              : code === 2
                ? 'no'
                : code === 10
                  ? 'unanswered'
                  : 'unknown',
        hasQuit: number(m, 23) === 1,
        removed: number(m, 22) === 1,
      };
    });
}
export class SportAdmin {
  private leaderContext?: LeaderContext;
  constructor(
    private session: Session,
    private memberships: Membership[] = [],
    private fetcher: typeof fetch = fetch,
  ) {}
  async call(
    path: string,
    fields: [number, number | Uint8Array][],
    leader = false,
  ): Promise<Message> {
    if (!readMethods.has(path) || readMethods.get(path) !== leader)
      throw new SportAdminError('access', 'Integrationen får bara läsa från SportAdmin.');
    const data = encode(fields),
      frame = new Uint8Array(data.length + 5);
    new DataView(frame.buffer).setUint32(1, data.length);
    frame.set(data, 5);
    const response = await this.fetcher(
      `https://${leader ? 'appapi' : 'appmemberapi'}.sportadmin.se${path}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: `Bearer ${this.session.access_token}`,
          'content-type': 'application/grpc-web-text',
          accept: 'application/grpc-web-text',
          'x-grpc-web': '1',
          'x-user-agent': 'grpc-web-dotnet/1.0',
          'grpc-accept-encoding': 'identity',
          ...(leader && this.leaderContext
            ? {
                sa_gid: String(this.leaderContext.groupId),
                sa_uid: String(this.leaderContext.userId),
                sa_rid: String(this.leaderContext.clubId),
              }
            : {}),
          ...(!leader && this.memberships.length
            ? {
                sa_msp: this.memberships
                  .map((m) => `${m.clubId}_${m.memberId}_${m.groupId}_${m.subId || ''}_True`)
                  .join('-'),
              }
            : {}),
        },
        body: btoa(String.fromCharCode(...frame)),
      },
    );
    if (response.status === 401) throw new SportAdminError('auth', 'Anslut SportAdmin igen.');
    if (response.status === 403)
      throw new SportAdminError('access', 'Kontot saknar behörighet till dessa uppgifter.');
    if (!response.ok) throw new SportAdminError('upstream');
    return decodeFrames(await response.text());
  }
  async profiles(): Promise<Membership[]> {
    const root = await this.call('/GrpcMemberUserProfileService/GetUserProfiles', [[1, 1]]);
    return messages(root, 3)
      .map((m) => ({
        clubId: number(m, 7),
        clubName: text(m, 8),
        memberId: number(m, 4),
        groupId: number(m, 14),
        subId: nestedNumber(m, 18),
        groupName: text(m, 15),
      }))
      .filter((m) => m.clubId && m.memberId && m.groupId);
  }
  async leaderClubs(): Promise<number[]> {
    return messages(await this.call('/GrpcUserProfileService/GetUserProfiles', [], true), 3).map(
      (m) => nestedNumber(m, 9),
    );
  }
  async roster(): Promise<Roster> {
    const deadline = Date.now() + 90_000;
    const selected = this.memberships.length === 1 ? this.memberships[0] : undefined;
    if (!selected) throw new SportAdminError('access', 'Välj ett lag för spelarinventeringen.');
    const profiles = await this.call('/GrpcUserProfileService/GetUserProfiles', [], true);
    if (number(profiles, 1) !== 1) return bad();
    const contexts = messages(profiles, 3)
      .filter((p) => nestedNumber(p, 9) === selected.clubId)
      .flatMap((p) =>
        messages(p, 23)
          .filter((g) => number(g, 3) === selected.groupId && number(g, 10) === 1)
          .map((g) => ({
            clubId: selected.clubId,
            userId: nestedNumber(p, 12),
            groupId: number(g, 3),
            teamId: nestedNumber(g, 4),
            periodId: number(g, 2),
            groupName: text(g, 7),
          })),
      );
    if (contexts.length !== 1 || !contexts[0].userId || !contexts[0].periodId)
      throw new SportAdminError(
        'access',
        'Ledarbehörighet för det anslutna lagets aktiva period saknas.',
      );
    this.leaderContext = contexts[0];
    const context = contexts[0];
    const players = parseRoster(
      await this.call(
        '/GrpcTeamRegisterTeamService/GetTeamMembers',
        [
          [1, context.teamId],
          [2, context.groupId],
        ],
        true,
      ),
    );
    // Four simultaneous read requests keep this within Supabase Free's runtime.
    // Keep the entire snapshot uncommitted if any contact request fails.
    for (let i = 0; i < players.length; i += 4) {
      if (Date.now() > deadline - 20_000)
        throw new SportAdminError(
          'upstream',
          'Spelarregistret tog för lång tid att läsa. Senaste inventeringen behålls.',
        );
      await Promise.all(
        players
          .slice(i, i + 4)
          .filter((p) => p.active)
          .map(async (p) => {
            p.guardians = parseGuardians(
              await this.call(
                '/GrpcUserGroupsService/GetMemberDetail',
                [
                  [1, p.id],
                  [4, context.periodId],
                ],
                true,
              ),
              p.id,
            );
          }),
      );
    }
    return {
      clubId: context.clubId,
      groupId: context.groupId,
      groupName: context.groupName,
      checkedAt: new Date().toISOString(),
      players,
    };
  }
  async activities(): Promise<Activity[]> {
    const root = await this.call('/GrpcMemberActivitiesService/GetMemberAppHomeActivities', [
      [3, 25],
      [4, 500],
      [5, 1],
      [6, 1],
      [9, encode([[1, Math.floor(Date.now() / 1000) - 7 * 86400]])],
    ]);
    const rows = messages(root, 4);
    if (rows.length >= 500)
      throw new SportAdminError(
        'schema',
        'För många aktiviteter. Begränsa anslutningen till rätt lag.',
      );
    const found = new Map<number, Activity>();
    for (const m of rows) {
      const clubId = number(m, 1),
        memberId = nestedNumber(m, 16),
        groupId = number(m, 14),
        id = number(m, 3),
        callingId = nestedNumber(m, 9);
      if (
        !this.memberships.some(
          (p) => p.clubId === clubId && p.memberId === memberId && p.groupId === groupId,
        )
      )
        continue;
      if (!id || !callingId || !nestedNumber(m, 5)) continue;
      found.set(id, {
        id,
        callingId,
        clubId,
        memberId,
        groupId,
        title:
          nestedText(m, 2) ||
          nestedText(m, 12) ||
          ({ 1: 'Träning', 2: 'Match', 3: 'Evenemang', 4: 'Möte' } as Record<number, string>)[
            number(m, 4)
          ] ||
          'Aktivitet',
        startsAt: new Date(nestedNumber(m, 5) * 1000).toISOString(),
        endsAt: new Date((nestedNumber(m, 6) || nestedNumber(m, 5)) * 1000).toISOString(),
      });
    }
    return [...found.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  async participants(activity: Activity): Promise<Participant[]> {
    if (
      !this.memberships.some(
        (m) =>
          m.clubId === activity.clubId &&
          m.groupId === activity.groupId &&
          m.memberId === activity.memberId,
      )
    )
      throw new SportAdminError('access');
    const detail = await this.call('/GrpcMemberActivitiesService/GetMemberAppActivityInformation', [
      [1, activity.callingId],
      [2, activity.memberId],
      [3, 15],
      [4, activity.clubId],
    ]);
    if (
      number(detail, 1) !== activity.id ||
      number(detail, 20) !== activity.clubId ||
      number(detail, 47) !== activity.groupId ||
      nestedNumber(detail, 22) !== activity.callingId
    )
      return bad();
    return parseParticipants(
      await this.call('/GrpcMemberCallingsService/GetActivityCalling', [
        [1, activity.callingId],
        [2, activity.clubId],
        [3, activity.groupId],
      ]),
    );
  }
}

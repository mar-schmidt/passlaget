import { expect, test } from 'vitest';
import {
  encode,
  protobuf,
  parseParticipants,
  decodeFrames,
  SportAdminError,
  token,
} from '../functions/_shared/sportadmin-api';
const str = (s: string) => new TextEncoder().encode(s);
const participant = (status: number, extra: [number, number | Uint8Array][] = []) =>
  encode([
    [1, 123],
    [2, str('Åke')],
    [3, str('Test')],
    [4, str('private@example.test')],
    [9, status],
    [11, 1],
    ...extra,
  ]);
test('verified statuses and contact data minimisation', () => {
  for (const [code, answer] of [
    [1, 'yes'],
    [2, 'no'],
    [10, 'unanswered'],
    [99, 'unknown'],
  ] as const) {
    const [p] = parseParticipants(
      protobuf(
        encode([
          [1, 1],
          [10, participant(code)],
        ]),
      ),
    );
    expect(p).toEqual({
      id: 123,
      name: 'Åke Test',
      birthYear: '',
      answer,
      hasQuit: false,
      removed: false,
    });
  }
});
test('leaders excluded, unknown access does not become empty success', () => {
  expect(
    parseParticipants(
      protobuf(
        encode([
          [1, 1],
          [10, participant(1, [[7, 1]])],
        ]),
      ),
    ),
  ).toEqual([]);
  expect(() => parseParticipants([])).toThrow(SportAdminError);
});
test('malformed messages and duplicate identities rejected; unknown int64 fields accepted', () => {
  expect(() => protobuf(new Uint8Array([10, 10, 0]))).toThrow();
  expect(() =>
    parseParticipants(
      protobuf(
        encode([
          [1, 1],
          [10, participant(1)],
          [10, participant(2)],
        ]),
      ),
    ),
  ).toThrow();
  expect(
    protobuf(new Uint8Array([8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1])),
  ).toHaveLength(1);
});
const frame = (flag: number, b: Uint8Array) => {
  const f = new Uint8Array(b.length + 5);
  f[0] = flag;
  new DataView(f.buffer).setUint32(1, b.length);
  f.set(b, 5);
  return btoa(String.fromCharCode(...f));
};
test('separately padded grpc frames, trailers and failed responses', () => {
  const data = frame(0, encode([[1, 1]]));
  expect(decodeFrames(data + frame(128, str('grpc-status: 0\r\n')))).toEqual([
    { number: 1, value: 1 },
  ]);
  expect(() => decodeFrames(data)).toThrow();
  expect(() => decodeFrames(data + frame(128, str('grpc-status: 7\r\n')))).toThrow();
  expect(() => decodeFrames('%%%')).toThrow();
});
test('refresh persists rotated token and does not expose upstream errors', async () => {
  const fetcher = async () =>
    new Response(
      JSON.stringify({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 }),
    );
  expect(
    (await token({ grant_type: 'refresh_token', refresh_token: 'old' }, fetcher as typeof fetch))
      .refresh_token,
  ).toBe('rotated');
  await expect(
    token({}, (async () => new Response('private details', { status: 401 })) as typeof fetch),
  ).rejects.toThrow('Kontrollera inloggningen');
});

test('leader roster excludes leaders, honors explicit departure and minimizes personal data', async () => {
  const { parseRoster, parseGuardians } = await import('../functions/_shared/sportadmin-api');
  const row = (id: number, extra: [number, number | Uint8Array][] = []) =>
    encode([
      [2, id],
      [3, str('Barn')],
      [4, str('Test')],
      [19, 1],
      [5, str('PRIVATE-DOB')],
      ...extra,
    ]);
  const rows = parseRoster(
    protobuf(
      encode([
        [1, 1],
        [2, row(1)],
        [2, row(2, [[7, 1]])],
        [2, row(3, [[10, 1]])],
      ]),
    ),
  );
  expect(rows.map((p) => [p.id, p.active])).toEqual([
    [1, true],
    [3, false],
  ]);
  expect(JSON.stringify(rows)).not.toContain('PRIVATE');
  expect(() => parseRoster(protobuf(encode([[1, 1]])))).toThrow();
  expect(() =>
    parseRoster(
      protobuf(
        encode([
          [1, 1],
          [2, row(1)],
          [2, row(1)],
        ]),
      ),
    ),
  ).toThrow();
  const detail = protobuf(
    encode([
      [1, 1],
      [
        3,
        encode([
          [17, 1],
          [3, str('PRIVATE-SSN')],
          [4, str('PRIVATE-ADDRESS')],
          [10, str('0701112233')],
          [11, str('PARENT@example.test')],
          [12, str('Vuxen Test')],
          [13, str('0702223344')],
          [14, str('second@example.test')],
          [15, str('Andra Vuxen')],
        ]),
      ],
    ]),
  );
  expect(parseGuardians(detail, 1)).toEqual([
    { position: 1, name: 'Vuxen Test', phone: '0701112233', email: 'parent@example.test' },
    { position: 2, name: 'Andra Vuxen', phone: '0702223344', email: 'second@example.test' },
  ]);
  expect(() => parseGuardians(detail, 2)).toThrow();
});
test('read adapter refuses every write endpoint before making any network request', async () => {
  const { SportAdmin } = await import('../functions/_shared/sportadmin-api');
  let calls = 0;
  const api = new SportAdmin(
    { access_token: 'private', refresh_token: 'private', expires_at: 0 },
    [],
    (async () => {
      calls++;
      throw new Error('should not fetch');
    }) as typeof fetch,
  );
  for (const path of [
    '/GrpcUserGroupsService/SaveMemberDetail',
    '/GrpcMemberCallingsService/Respond',
    '/GrpcTeamRegisterTeamService/DeleteMember',
    '//other.example/',
  ])
    await expect(api.call(path, [], true)).rejects.toThrow('bara läsa');
  expect(calls).toBe(0);
});
test('leader roster and contact requests are scoped to the selected club, group, user and period', async () => {
  const { SportAdmin } = await import('../functions/_shared/sportadmin-api');
  const seen: { path: string; headers: Headers }[] = [];
  const roots = [
    encode([
      [1, 1],
      [
        3,
        encode([
          [9, encode([[1, 4]])],
          [12, encode([[1, 6]])],
          [
            23,
            encode([
              [2, 8],
              [3, 5],
              [4, encode([[1, 7]])],
              [7, str('P2018')],
              [10, 1],
            ]),
          ],
        ]),
      ],
    ]),
    encode([
      [1, 1],
      [
        2,
        encode([
          [2, 9],
          [3, str('Barn')],
          [4, str('Test')],
          [19, 1],
        ]),
      ],
    ]),
    encode([
      [1, 1],
      [
        3,
        encode([
          [17, 9],
          [12, str('Vuxen Test')],
        ]),
      ],
    ]),
  ];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ path: new URL(url).pathname, headers: new Headers(init.headers) });
    return new Response(frame(0, roots.shift()!) + frame(128, str('grpc-status: 0\r\n')));
  }) as typeof fetch;
  const api = new SportAdmin(
    { access_token: 'private', refresh_token: 'private', expires_at: 0 },
    [{ clubId: 4, groupId: 5, memberId: 6, subId: 7, clubName: 'Test' }],
    fetcher,
  );
  const roster = await api.roster();
  expect(roster).toMatchObject({
    clubId: 4,
    groupId: 5,
    groupName: 'P2018',
    players: [{ id: 9, active: true }],
  });
  expect(seen.map((s) => s.path)).toEqual([
    '/GrpcUserProfileService/GetUserProfiles',
    '/GrpcTeamRegisterTeamService/GetTeamMembers',
    '/GrpcUserGroupsService/GetMemberDetail',
  ]);
  expect(seen[1].headers.get('sa_rid')).toBe('4');
  expect(seen[1].headers.get('sa_gid')).toBe('5');
  expect(seen[1].headers.get('sa_uid')).toBe('6');
});

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

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'invalid_request',
  ) {
    super(message);
  }
}
export function stringValue(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new HttpError(400, `Ogiltigt fält: ${name}.`);
  return value.trim();
}
export function normalizeEmail(value: unknown): string {
  const email = stringValue(value, 'email', 254).toLowerCase();
  // One mailbox only. MailApp treats commas as recipient separators; do not accept
  // display names, delimiters, header controls or an address list here.
  const [local, domain, ...extra] = email.split('@');
  if (
    extra.length ||
    !local ||
    !domain ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
    !domain.includes('.')
  ) {
    throw new HttpError(400, 'Ange en giltig mejladress.');
  }
  return email;
}
export function uuidValue(value: unknown): string {
  const id = stringValue(value, 'id', 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new HttpError(400, 'Ogiltigt id.');
  return id;
}
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || expected.length < 32) return false;
  let difference = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0);
  return difference === 0;
}
export async function signToken(id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`unsubscribe:${id}`),
  );
  return `${id}.${[...new Uint8Array(signature)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
export async function readToken(value: unknown, secret: string): Promise<string> {
  const token = stringValue(value, 'token', 120),
    id = uuidValue(token.split('.')[0]);
  if (!secretMatches(token, await signToken(id, secret)))
    throw new HttpError(400, 'Länken är ogiltig.');
  return id;
}
export function portalLink(appUrl: string, param: string, value: string): string {
  const url = new URL(appUrl);
  url.hash = '';
  url.searchParams.set(param, value);
  return url.toString();
}
export function configuredUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('APP_URL must use HTTPS (except local development)');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('APP_URL must not contain credentials, a query or fragment');
  return url.toString();
}

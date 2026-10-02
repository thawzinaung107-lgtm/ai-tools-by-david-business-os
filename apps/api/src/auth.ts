import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';

const scrypt = promisify(scryptCallback);
const TOKEN_TTL_SECONDS = 60 * 60 * 8;

type ScryptResult = Buffer | string;

export type AuthContext = {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set and contain at least 32 characters');
  }
  return secret;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function safeCompare(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password: string) {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as ScryptResult;
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const derived = await scrypt(password, salt, expected.length) as ScryptResult;
  return timingSafeEqual(expected, Buffer.from(derived));
}

function signToken(payload: Record<string, unknown>) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const signature = createHmac('sha256', getAuthSecret()).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyToken(token: string) {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) throw new Error('Invalid token');
  const unsigned = `${header}.${body}`;
  const expected = createHmac('sha256', getAuthSecret()).update(unsigned).digest('base64url');
  if (!safeCompare(signature, expected)) throw new Error('Invalid token signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: string; exp?: number };
  if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired token');
  return payload;
}

export async function createAccessToken(userId: string, email: string) {
  return signToken({
    sub: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
}

export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  const result = await pool.query(`
    select u.id, u.email::text, u.display_name,
           coalesce(array_agg(distinct r.code) filter (where r.code is not null), '{}') as roles,
           coalesce(array_agg(distinct p.code) filter (where p.code is not null), '{}') as permissions
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where u.id = $1 and u.status = 'ACTIVE' and u.deleted_at is null
    group by u.id
  `, [userId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles ?? [],
    permissions: row.permissions ?? [],
  };
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
  try {
    const payload = verifyToken(header.slice('Bearer '.length).trim());
    const context = await loadAuthContext(payload.sub as string);
    if (!context) return reply.code(401).send({ error: 'User is inactive or no longer exists' });
    request.auth = context;
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired authentication token' });
  }
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticateRequest(request, reply);
    if (authResult) return authResult;
    if (!request.auth?.permissions.includes(permission)) {
      return reply.code(403).send({ error: 'Insufficient permission', required_permission: permission });
    }
  };
}

export function publicUser(context: AuthContext) {
  return {
    id: context.userId,
    email: context.email,
    display_name: context.displayName,
    roles: context.roles,
    permissions: context.permissions,
  };
}

export function verifyBootstrapSecret(candidate: string) {
  const expected = process.env.BOOTSTRAP_SECRET;
  return Boolean(expected && expected.length >= 24 && safeCompare(candidate, expected));
}

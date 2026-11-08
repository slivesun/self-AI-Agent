import crypto from 'crypto';

/**
 * 密码哈希：scrypt + 随机盐（Node 内置，无原生依赖）。
 * 存储格式：scrypt$N$r$p$saltHex$hashHex
 *
 * 兼容历史数据：早期版本用单次 sha256（64 位 hex），
 * 校验时仍可识别，登录成功后由调用方升级为新格式。
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function bufferEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 是否是历史 sha256 哈希（无盐，需要升级） */
export function isLegacyHash(stored: string | null | undefined): boolean {
  return !!stored && /^[0-9a-f]{64}$/i.test(stored);
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;

  if (isLegacyHash(stored)) {
    const legacy = crypto.createHash('sha256').update(password).digest('hex');
    return bufferEqualHex(legacy, stored);
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  try {
    const derived = crypto.scryptSync(password, Buffer.from(parts[4], 'hex'), KEY_LEN, { N: n, r, p });
    return bufferEqualHex(derived.toString('hex'), parts[5]);
  } catch {
    return false;
  }
}

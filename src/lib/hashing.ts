import crypto from 'crypto';
import { normalizeIdentifier, IdentifierType } from './security/normalization';

const HASH_SECRET = process.env.ALIAS_PEPPER as string;

export const hashIdentifier = (type: IdentifierType, identifier: string): string => {
  if (!HASH_SECRET) {
    throw new Error('CRITICAL: HASH_SECRET environment variable is missing.');
  }

  // 🚨 NEW: Force normalization before the hash is ever computed
  const standardizedIdentifier = normalizeIdentifier(type, identifier);

  return crypto
    .createHmac('sha256', HASH_SECRET)
    .update(`${type}:${standardizedIdentifier}`)
    .digest('hex');
};

export type AliasType = 'phone' | 'telegram' | 'instagram';
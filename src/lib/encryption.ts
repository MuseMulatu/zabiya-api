import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Ensure this is a 32-byte secure string in production
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex'); 
const ALGORITHM = 'aes-256-gcm';

if (ENCRYPTION_KEY.length !== 32) {
  throw new Error("CRITICAL: ENCRYPTION_KEY must be a 32-byte hex string.");
}

/**
 * Encrypts sensitive personal data (like the user's root phone number)
 * using AES-256-GCM. Returns an iv:authTag:encrypted payload.
 */
export const encryptData = (text: string): string => {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypts AES-256-GCM payloads.
 */
export const decryptData = (encryptedText: string): string => {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  // 1. Explicitly type the destructured variables as string to resolve 'string | undefined' errors
  const ivHex: string = parts[0] as string;
  const authTagHex: string = parts[1] as string;
  const encrypted: string = parts[2] as string;
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  // 2. Explicitly define 'decrypted' as a string to resolve the concatenation type error
  let decrypted: string = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};
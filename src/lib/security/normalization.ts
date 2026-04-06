export type IdentifierType = 'phone' | 'telegram' | 'instagram';

export const normalizeIdentifier = (type: IdentifierType, value: string): string => {
  if (!value) return '';

  if (type === 'phone') {
    // 1. Strip all spaces, dashes, parentheses, and letters
    let cleaned = value.replace(/[^\d+]/g, '');

    // 2. Convert '00' prefix to '+' (e.g., 00251 -> +251)
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    }
    
    // 3. Handle Ethiopian local formats (starts with 09 or 07) -> Convert to +251
    if (/^0[79]\d{8}$/.test(cleaned)) {
      cleaned = '+251' + cleaned.substring(1);
    }
    
    // 4. Handle missing '+' sign for standard 251 inputs
    if (/^251\d{9}$/.test(cleaned)) {
      cleaned = '+' + cleaned;
    }

    // 5. Fallback: Ensure it starts with a plus (if they just typed a random country code without it)
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  if (type === 'telegram' || type === 'instagram') {
    // Strip whitespace, convert to lowercase, and remove leading '@'
    return value.trim().toLowerCase().replace(/^@/, '');
  }

  return value.trim();
};

export const formatArifpayPhone = (phone: string): string => {
  // 1. Strip all non-numeric characters (removes spaces, +, -, etc.)
  let cleaned = phone.replace(/[^\d]/g, '');

  // 2. Convert local 09/07 numbers to 2519/2517
  if (cleaned.startsWith('09') || cleaned.startsWith('07')) {
    cleaned = '251' + cleaned.substring(1);
  }

  // 3. If it starts with 251, it's already good. 
  // If someone just typed '911000000', append 251.
  if (!cleaned.startsWith('251') && cleaned.length === 9) {
    cleaned = '251' + cleaned;
  }

  return cleaned;
};
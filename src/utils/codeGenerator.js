import crypto from 'crypto';

// Characters excluding ambiguous 0, O, 1, I, L
const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Generates a clean, human-readable room code (e.g. "K7X9PQ")
 * @param {number} length 
 * @returns {string}
 */
export function generateRoomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

/**
 * Normalizes user-input room code (uppercase, trim whitespace, remove dashes)
 * @param {string} input 
 * @returns {string}
 */
export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

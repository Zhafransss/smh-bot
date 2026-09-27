/**
 * Input validation utilities
 */

/**
 * Parse registration form from a single message.
 * Expected format:
 *   Nama: [nama]
 *   HP: [nomor hp]
 *   Alamat: [alamat]
 *
 * @param {string} text - The raw message text
 * @returns {{ valid: boolean, data?: { nama: string, nomor_hp: string, alamat: string }, error?: string }}
 */
function parseRegistrationForm(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, error: 'Pesan kosong.' };
  }

  const namaMatch = text.match(/nama\s*:\s*(.+)/i);
  const hpMatch = text.match(/hp\s*:\s*(.+)/i);
  const alamatMatch = text.match(/alamat\s*:\s*(.+)/i);

  if (!namaMatch || !hpMatch || !alamatMatch) {
    return {
      valid: false,
      error: 'Format tidak sesuai. Pastikan mengisi Nama, HP, dan Alamat.',
    };
  }

  const nama = namaMatch[1].trim();
  const nomor_hp = hpMatch[1].trim();
  const alamat = alamatMatch[1].trim();

  if (nama.length < 2) {
    return { valid: false, error: 'Nama terlalu pendek (minimal 2 karakter).' };
  }

  if (!isValidPhone(nomor_hp)) {
    return { valid: false, error: 'Nomor HP tidak valid. Gunakan format: 08xxxxxxxxxx.' };
  }

  if (alamat.length < 5) {
    return { valid: false, error: 'Alamat terlalu pendek (minimal 5 karakter).' };
  }

  return {
    valid: true,
    data: { nama, nomor_hp, alamat },
  };
}

/**
 * Validate Indonesian phone number (basic check)
 */
function isValidPhone(phone) {
  // Accept formats: 08xx, 628xx, +628xx (8-15 digits after prefix)
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^(\+?62|0)8[0-9]{7,12}$/.test(cleaned);
}

const { KATEGORI_MENU } = require('../config/constants');

/**
 * Validate category selection (1-9)
 */
function isValidCategory(input) {
  const num = parseInt(input, 10);
  return !isNaN(num) && KATEGORI_MENU.some((k) => k.id === num);
}

/**
 * Validate confirmation input (1 or 2)
 */
function isValidConfirmation(input) {
  const trimmed = input.trim();
  return trimmed === '1' || trimmed === '2';
}

module.exports = {
  parseRegistrationForm,
  isValidPhone,
  isValidCategory,
  isValidConfirmation,
};

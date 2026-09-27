/**
 * Application-wide constants for Selis Molis Hoki (SMH) Support
 */

// Ticket statuses
const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  PENDING: 'pending',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

// Statuses considered "active" (laporan/servis masih berjalan)
const ACTIVE_STATUSES = [
  TICKET_STATUS.OPEN,
  TICKET_STATUS.IN_PROGRESS,
  TICKET_STATUS.PENDING,
];

// User roles
const USER_ROLES = {
  PELANGGAN: 'pelanggan',
  ADMIN: 'admin',
  TEKNISI: 'teknisi',
  MANAGER: 'manager',
};

// Chat direction
const CHAT_DIRECTION = {
  MASUK: 'masuk',
  KELUAR: 'keluar',
};

// Conversation states (state machine)
const CONV_STATE = {
  REG_AWAITING_DATA: 'REG_AWAITING_DATA',
  REG_AWAITING_CONFIRM: 'REG_AWAITING_CONFIRM',
  TKT_AWAITING_CATEGORY: 'TKT_AWAITING_CATEGORY',
  TKT_AWAITING_DESCRIPTION: 'TKT_AWAITING_DESCRIPTION',
  TKT_AWAITING_CONFIRM: 'TKT_AWAITING_CONFIRM',
};

// Priority Levels (3 Tiers)
const PRIORITY_LEVELS = {
  LOW: { id: 1, name: 'Low', label: 'Rendah', level: 1 },
  MEDIUM: { id: 2, name: 'Medium', label: 'Sedang', level: 2 },
  HIGH: { id: 3, name: 'High', label: 'Tinggi', level: 3 },
};

// Default priority ID (Medium / Sedang)
const DEFAULT_PRIORITY_ID = PRIORITY_LEVELS.MEDIUM.id;

// Conversation TTL in seconds (default 24 hours)
const CONVERSATION_TTL = parseInt(process.env.CONVERSATION_TTL, 10) || 86400;

// Kategori gangguan/layanan Sepeda Listrik & Motor Listrik SMH (modular, dapat disesuaikan)
const KATEGORI_MENU = [
  // High Priority (Prioritas Tinggi - Kendaraan Mati / Komponen Vital)
  { id: 1, label: 'Kendala Baterai & Charger (Drop / Tidak Bisa Cas / Kembung)', priority_id: PRIORITY_LEVELS.HIGH.id, priority_name: PRIORITY_LEVELS.HIGH.name, priority_label: PRIORITY_LEVELS.HIGH.label },
  { id: 2, label: 'Dinamo / Motor Penggerak (Mati Total / Tersendat / Kasar)', priority_id: PRIORITY_LEVELS.HIGH.id, priority_name: PRIORITY_LEVELS.HIGH.name, priority_label: PRIORITY_LEVELS.HIGH.label },
  { id: 3, label: 'Kontroller & Sistem Gas (Tidak Respon / Error / Terbakar)', priority_id: PRIORITY_LEVELS.HIGH.id, priority_name: PRIORITY_LEVELS.HIGH.name, priority_label: PRIORITY_LEVELS.HIGH.label },
  
  // Medium Priority (Prioritas Sedang - Fungsi Berkurang / Keamanan)
  { id: 4, label: 'Kelistrikan, Lampu & Speedometer Mati', priority_id: PRIORITY_LEVELS.MEDIUM.id, priority_name: PRIORITY_LEVELS.MEDIUM.name, priority_label: PRIORITY_LEVELS.MEDIUM.label },
  { id: 5, label: 'Sistem Pengereman & Roda / Ban (Rem Blong / Bocor / Oleng)', priority_id: PRIORITY_LEVELS.MEDIUM.id, priority_name: PRIORITY_LEVELS.MEDIUM.name, priority_label: PRIORITY_LEVELS.MEDIUM.label },
  { id: 6, label: 'Rantai, Belt & Mekanikal (Lepas / Kendor / Bunyi Kasar)', priority_id: PRIORITY_LEVELS.MEDIUM.id, priority_name: PRIORITY_LEVELS.MEDIUM.name, priority_label: PRIORITY_LEVELS.MEDIUM.label },
  
  // Low Priority (Prioritas Rendah - Perawatan & Pengecekan Rutin)
  { id: 7, label: 'Servis Berkala & Tune-Up Rutin Sepeda / Motor Listrik', priority_id: PRIORITY_LEVELS.LOW.id, priority_name: PRIORITY_LEVELS.LOW.name, priority_label: PRIORITY_LEVELS.LOW.label },
  { id: 8, label: 'Pemasangan / Penggantian Aksesoris & Kelengkapan', priority_id: PRIORITY_LEVELS.LOW.id, priority_name: PRIORITY_LEVELS.LOW.name, priority_label: PRIORITY_LEVELS.LOW.label },
  { id: 9, label: 'Konsultasi Teknis & Kendala Lainnya', priority_id: PRIORITY_LEVELS.LOW.id, priority_name: PRIORITY_LEVELS.LOW.name, priority_label: PRIORITY_LEVELS.LOW.label },
];

/**
 * Get priority ID and info by category ID (Rule-Based Mapping)
 * @param {number|string} categoryId
 * @returns {object} Priority object { id, name, label, level }
 */
function getPriorityByCategoryId(categoryId) {
  const category = KATEGORI_MENU.find((k) => k.id === parseInt(categoryId, 10));
  if (category) {
    return {
      id: category.priority_id,
      name: category.priority_name,
      label: category.priority_label,
    };
  }
  return {
    id: DEFAULT_PRIORITY_ID,
    name: PRIORITY_LEVELS.MEDIUM.name,
    label: PRIORITY_LEVELS.MEDIUM.label,
  };
}

// Anti-ban Rate Limiter (1 minute 10 messages)
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 10;
const RATE_LIMIT_DURATION_MS = parseInt(process.env.RATE_LIMIT_DURATION_MS, 10) || 60000;

// Typing Presence Animation duration (10 seconds)
const TYPING_DURATION_MS = parseInt(process.env.TYPING_DURATION_MS, 10) || 10000;

// Message Debounce Delay for Consecutive Messages (PRD Bagian 5 & 9)
const MESSAGE_DEBOUNCE_DELAY_MS = parseInt(process.env.MESSAGE_DEBOUNCE_DELAY_MS, 10) || 3000;

module.exports = {
  TICKET_STATUS,
  ACTIVE_STATUSES,
  USER_ROLES,
  CHAT_DIRECTION,
  CONV_STATE,
  PRIORITY_LEVELS,
  DEFAULT_PRIORITY_ID,
  CONVERSATION_TTL,
  KATEGORI_MENU,
  getPriorityByCategoryId,
  RATE_LIMIT_MAX,
  RATE_LIMIT_DURATION_MS,
  TYPING_DURATION_MS,
  MESSAGE_DEBOUNCE_DELAY_MS,
};

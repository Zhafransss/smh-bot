const { User } = require('../models');
const { USER_ROLES } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Find user by WhatsApp number
 * @param {string} phoneNumber - Normalized phone number (e.g. "6281234567890")
 */
async function findByWhatsApp(phoneNumber) {
  return User.findOne({
    where: { nomor_whatsapp: phoneNumber },
  });
}

/**
 * Register a new pelanggan
 * @param {{ nomor_whatsapp: string, nama: string, nomor_hp: string, alamat: string }} data
 */
async function register(data) {
  const user = await User.create({
    nama: data.nama,
    nomor_whatsapp: data.nomor_whatsapp,
    nomor_hp: data.nomor_hp,
    alamat: data.alamat,
    role: USER_ROLES.PELANGGAN,
  });
  logger.info({ userId: user.id, phone: data.nomor_whatsapp }, 'New pelanggan registered');
  return user;
}

module.exports = {
  findByWhatsApp,
  register,
};

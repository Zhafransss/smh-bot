const { Op } = require('sequelize');
const { Ticket, LogStatus, KategoriGangguan, PrioritasGangguan, User } = require('../models');
const { ACTIVE_STATUSES, TICKET_STATUS, DEFAULT_PRIORITY_ID, getPriorityByCategoryId } = require('../config/constants');
const { generateTicketNumber, startOfTodayWIB } = require('../utils/formatter');
const logger = require('../utils/logger');

/**
 * Find active ticket for a user (status in open/in_progress/pending)
 * @param {number} userId
 * @returns {Promise<Ticket|null>}
 */
async function findActiveByUserId(userId) {
  return Ticket.findOne({
    where: {
      user_id: userId,
      status: { [Op.in]: ACTIVE_STATUSES },
    },
    include: [
      { model: KategoriGangguan, as: 'kategori' },
      { model: PrioritasGangguan, as: 'prioritas' },
    ],
    order: [['created_at', 'DESC']],
  });
}

/**
 * Create a new ticket with initial log_status and rule-based priority mapping
 * @param {{ user_id: number, kategori_gangguan_id: number, deskripsi: string, prioritas_gangguan_id?: number }} data
 * @returns {Promise<Ticket>}
 */
async function create(data) {
  // Count today's tickets for sequence number
  const todayStart = startOfTodayWIB();
  const todayCount = await Ticket.count({
    where: {
      created_at: { [Op.gte]: todayStart },
    },
  });

  const ticketNumber = generateTicketNumber(todayCount + 1);

  // Rule-based priority assignment
  const priorityInfo = getPriorityByCategoryId(data.kategori_gangguan_id);
  const priorityId = data.prioritas_gangguan_id || priorityInfo.id;

  const ticket = await Ticket.create({
    ticket_number: ticketNumber,
    user_id: data.user_id,
    kategori_gangguan_id: data.kategori_gangguan_id,
    prioritas_gangguan_id: priorityId,
    deskripsi: data.deskripsi,
    status: TICKET_STATUS.OPEN,
  });

  // Create initial log_status entry
  await LogStatus.create({
    ticket_id: ticket.id,
    status_dari: null,
    status_ke: TICKET_STATUS.OPEN,
    changed_by: null, // System-created
    catatan: 'Tiket dibuat otomatis dari chatbot WhatsApp SMH Support',
  });

  logger.info({ ticketId: ticket.id, ticketNumber, userId: data.user_id, priorityId }, 'New ticket created with rule-based priority');
  return ticket;
}

/**
 * Get ticket by ID with full relations
 */
async function findById(ticketId) {
  return Ticket.findByPk(ticketId, {
    include: [
      { model: User, as: 'pelanggan', attributes: ['id', 'nama', 'nomor_whatsapp', 'alamat'] },
      { model: User, as: 'teknisi', attributes: ['id', 'nama'], required: false },
      { model: KategoriGangguan, as: 'kategori' },
      { model: PrioritasGangguan, as: 'prioritas' },
      { model: LogStatus, as: 'statusLogs', order: [['created_at', 'ASC']] },
    ],
  });
}

/**
 * Get all tickets with filters & pagination
 */
async function findAll({ page = 1, limit = 20, status, userId } = {}) {
  const where = {};
  if (status) where.status = status;
  if (userId) where.user_id = userId;

  const offset = (page - 1) * limit;
  const { rows, count } = await Ticket.findAndCountAll({
    where,
    include: [
      { model: User, as: 'pelanggan', attributes: ['id', 'nama', 'nomor_whatsapp'] },
      { model: KategoriGangguan, as: 'kategori' },
      { model: PrioritasGangguan, as: 'prioritas' },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return {
    tickets: rows,
    total: count,
    page,
    totalPages: Math.ceil(count / limit),
  };
}

/**
 * Update ticket status and create log entry
 */
async function updateStatus(ticketId, newStatus, changedBy, catatan = null) {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const oldStatus = ticket.status;
  ticket.status = newStatus;
  await ticket.save();

  await LogStatus.create({
    ticket_id: ticketId,
    status_dari: oldStatus,
    status_ke: newStatus,
    changed_by: changedBy,
    catatan,
  });

  logger.info({ ticketId, oldStatus, newStatus, changedBy }, 'Ticket status updated');
  return ticket;
}

/**
 * Assign technician to ticket
 */
async function assignTechnician(ticketId, technicianId) {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  ticket.assigned_to = technicianId;
  await ticket.save();

  logger.info({ ticketId, technicianId }, 'Technician assigned');
  return ticket;
}

/**
 * Update ticket priority
 */
async function updatePriority(ticketId, priorityId) {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  ticket.prioritas_gangguan_id = priorityId;
  await ticket.save();

  logger.info({ ticketId, priorityId }, 'Ticket priority updated');
  return ticket;
}

module.exports = {
  findActiveByUserId,
  create,
  findById,
  findAll,
  updateStatus,
  assignTechnician,
  updatePriority,
};

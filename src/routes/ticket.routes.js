const express = require('express');
const router = express.Router();
const ticketService = require('../services/ticket.service');
const logger = require('../utils/logger');

/**
 * GET /api/tickets
 * List tickets with optional filters and pagination
 * Query params: page, limit, status, userId
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;
    const result = await ticketService.findAll({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status: status || undefined,
      userId: userId ? parseInt(userId, 10) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tickets/:id
 * Get ticket detail with chat history and status logs
 */
router.get('/:id', async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(parseInt(req.params.id, 10));
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
    }
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/tickets/:id/status
 * Update ticket status
 * Body: { status: string, changed_by: number, catatan?: string }
 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, changed_by, catatan } = req.body;

    if (!status || !changed_by) {
      return res.status(400).json({
        success: false,
        message: 'Field status dan changed_by wajib diisi',
      });
    }

    const validStatuses = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Pilihan: ${validStatuses.join(', ')}`,
      });
    }

    const ticket = await ticketService.updateStatus(
      parseInt(req.params.id, 10),
      status,
      parseInt(changed_by, 10),
      catatan || null
    );

    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err.message === 'Ticket not found') {
      return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
    }
    next(err);
  }
});

/**
 * PATCH /api/tickets/:id/assign
 * Assign technician to ticket
 * Body: { technician_id: number }
 */
router.patch('/:id/assign', async (req, res, next) => {
  try {
    const { technician_id } = req.body;

    if (!technician_id) {
      return res.status(400).json({
        success: false,
        message: 'Field technician_id wajib diisi',
      });
    }

    const ticket = await ticketService.assignTechnician(
      parseInt(req.params.id, 10),
      parseInt(technician_id, 10)
    );

    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err.message === 'Ticket not found') {
      return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
    }
    next(err);
  }
});

/**
 * PATCH /api/tickets/:id/priority
 * Update ticket priority
 * Body: { priority_id: number }
 */
router.patch('/:id/priority', async (req, res, next) => {
  try {
    const { priority_id } = req.body;

    if (!priority_id) {
      return res.status(400).json({
        success: false,
        message: 'Field priority_id wajib diisi',
      });
    }

    const priorityNum = parseInt(priority_id, 10);
    if (![1, 2, 3].includes(priorityNum)) {
      return res.status(400).json({
        success: false,
        message: 'Priority ID tidak valid. Pilihan: 1 (Low), 2 (Medium), 3 (High)',
      });
    }

    const ticket = await ticketService.updatePriority(
      parseInt(req.params.id, 10),
      priorityNum
    );

    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err.message === 'Ticket not found') {
      return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
    }
    next(err);
  }
});

module.exports = router;

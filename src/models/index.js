const { Sequelize } = require('sequelize');
const dbConfig = require('../config/database');
const logger = require('../utils/logger');

const env = process.env.NODE_ENV || 'development';
const config = dbConfig[env];

const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    timezone: config.timezone,
    logging: config.logging,
    define: config.define,
  }
);

// Import models
const User = require('./User')(sequelize);
const Ticket = require('./Ticket')(sequelize);
const LogStatus = require('./LogStatus')(sequelize);
const HistoryChat = require('./HistoryChat')(sequelize);
const KategoriGangguan = require('./KategoriGangguan')(sequelize);
const PrioritasGangguan = require('./PrioritasGangguan')(sequelize);
const ItemService = require('./ItemService')(sequelize);
const BotChatLog = require('./BotChatLog')(sequelize);

// ── Associations ──

// User → Ticket (1:M) — pelanggan membuat tiket
User.hasMany(Ticket, { foreignKey: 'user_id', as: 'tickets' });
Ticket.belongsTo(User, { foreignKey: 'user_id', as: 'pelanggan' });

// User → Ticket (1:M) — teknisi ditugaskan ke tiket
User.hasMany(Ticket, { foreignKey: 'assigned_to', as: 'assignedTickets' });
Ticket.belongsTo(User, { foreignKey: 'assigned_to', as: 'teknisi' });

// User → HistoryChat (1:M)
User.hasMany(HistoryChat, { foreignKey: 'user_id', as: 'chats' });
HistoryChat.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Ticket → LogStatus (1:M)
Ticket.hasMany(LogStatus, { foreignKey: 'ticket_id', as: 'statusLogs' });
LogStatus.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });

// Ticket → HistoryChat (1:M)
Ticket.hasMany(HistoryChat, { foreignKey: 'ticket_id', as: 'chats' });
HistoryChat.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });

// Ticket → KategoriGangguan (M:1)
KategoriGangguan.hasMany(Ticket, { foreignKey: 'kategori_gangguan_id', as: 'tickets' });
Ticket.belongsTo(KategoriGangguan, { foreignKey: 'kategori_gangguan_id', as: 'kategori' });

// Ticket → PrioritasGangguan (M:1)
PrioritasGangguan.hasMany(Ticket, { foreignKey: 'prioritas_gangguan_id', as: 'tickets' });
Ticket.belongsTo(PrioritasGangguan, { foreignKey: 'prioritas_gangguan_id', as: 'prioritas' });

// LogStatus → User (changed_by)
LogStatus.belongsTo(User, { foreignKey: 'changed_by', as: 'changedByUser' });

// ItemService → BotChatLog (1:M)
ItemService.hasMany(BotChatLog, { foreignKey: 'matched_item_id', as: 'chatLogs' });
BotChatLog.belongsTo(ItemService, { foreignKey: 'matched_item_id', as: 'matchedItem' });

/**
 * Test database connection
 */
async function testConnection() {
  try {
    await sequelize.authenticate();
    logger.info('✅ Database connected');
  } catch (err) {
    logger.error({ err }, '❌ Database connection failed');
    throw err;
  }
}

module.exports = {
  sequelize,
  User,
  Ticket,
  LogStatus,
  HistoryChat,
  KategoriGangguan,
  PrioritasGangguan,
  ItemService,
  BotChatLog,
  testConnection,
};

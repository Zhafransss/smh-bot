const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const HistoryChat = sequelize.define('HistoryChat', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    ticket_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Null if message is during registration (no ticket yet)
    },
    wa_message_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true, // For deduplication
    },
    isi_pesan: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    arah: {
      type: DataTypes.ENUM('masuk', 'keluar'),
      allowNull: false,
    },
  }, {
    tableName: 'history_chat',
    updatedAt: false, // Chat entries are immutable
  });

  return HistoryChat;
};

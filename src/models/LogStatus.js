const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LogStatus = sequelize.define('LogStatus', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    ticket_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status_dari: {
      type: DataTypes.ENUM('open', 'in_progress', 'pending', 'resolved', 'closed'),
      allowNull: true, // null for initial status
    },
    status_ke: {
      type: DataTypes.ENUM('open', 'in_progress', 'pending', 'resolved', 'closed'),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.INTEGER,
      allowNull: true, // null if changed by system
    },
    catatan: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'log_status',
    updatedAt: false, // Log entries are immutable
  });

  return LogStatus;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Ticket = sequelize.define('Ticket', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    ticket_number: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    kategori_gangguan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    prioritas_gangguan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2, // Normal
    },
    deskripsi: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('open', 'in_progress', 'pending', 'resolved', 'closed'),
      allowNull: false,
      defaultValue: 'open',
    },
    assigned_to: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'ticket',
  });

  return Ticket;
};

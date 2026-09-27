const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PrioritasGangguan = sequelize.define('PrioritasGangguan', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nama_prioritas: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  }, {
    tableName: 'prioritas_gangguan',
    updatedAt: false,
  });

  return PrioritasGangguan;
};

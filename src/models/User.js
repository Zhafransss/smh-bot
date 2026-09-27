const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nama: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    nomor_whatsapp: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    nomor_hp: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    alamat: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    role: {
      type: DataTypes.ENUM('pelanggan', 'admin', 'noc', 'teknisi', 'manager'),
      allowNull: false,
      defaultValue: 'pelanggan',
    },
  }, {
    tableName: 'user',
  });

  return User;
};

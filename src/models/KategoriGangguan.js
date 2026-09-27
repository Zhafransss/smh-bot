const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const KategoriGangguan = sequelize.define('KategoriGangguan', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nama_kategori: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
  }, {
    tableName: 'kategori_gangguan',
    updatedAt: false,
  });

  return KategoriGangguan;
};

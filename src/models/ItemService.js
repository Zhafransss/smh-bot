const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ItemService = sequelize.define(
    'ItemService',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      price: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      unit: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      jenis: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: 'debit',
      },
      category: {
        type: DataTypes.ENUM('baterai', 'sparepart', 'aksesoris', 'service', 'trade'),
        allowNull: false,
        defaultValue: 'service',
      },
      meta: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const raw = this.getDataValue('meta');
          if (!raw) return null;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          }
          return raw;
        },
        set(value) {
          if (typeof value === 'object' && value !== null) {
            this.setDataValue('meta', value);
          } else {
            this.setDataValue('meta', value);
          }
        },
      },
      lokasi: {
        type: DataTypes.ENUM('Gudang Aki', 'Etalase Inovasi', 'Etalase Sparepart', 'Pre order', 'Custom'),
        allowNull: true,
      },
      picture: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      keterangan: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'item_services',
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return ItemService;
};

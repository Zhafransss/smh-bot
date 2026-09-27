'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const tableExists = tables.includes('item_services');

    if (!tableExists) {
      await queryInterface.createTable('item_services', {
        id: {
          type: Sequelize.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        code: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        name: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        price: {
          type: Sequelize.BIGINT,
          allowNull: false,
          defaultValue: 0,
        },
        unit: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        jenis: {
          type: Sequelize.STRING(255),
          allowNull: false,
          defaultValue: 'debit',
        },
        category: {
          type: Sequelize.ENUM('baterai', 'sparepart', 'aksesoris', 'service', 'trade'),
          allowNull: false,
          defaultValue: 'service',
        },
        meta: {
          type: Sequelize.TEXT('long'),
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        lokasi: {
          type: Sequelize.ENUM('Gudang Aki', 'Etalase Inovasi', 'Etalase Sparepart', 'Pre order', 'Custom'),
          allowNull: true,
        },
        picture: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        keterangan: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
      });

      await queryInterface.addIndex('item_services', ['code'], {
        name: 'item_services_code_index',
      });
      await queryInterface.addIndex('item_services', ['jenis'], {
        name: 'item_services_jenis_index',
      });
      await queryInterface.addIndex('item_services', ['lokasi'], {
        name: 'item_services_lokasi_index',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('item_services');
  },
};

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('log_status', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ticket', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status_dari: {
        type: Sequelize.ENUM('open', 'in_progress', 'pending', 'resolved', 'closed'),
        allowNull: true,
      },
      status_ke: {
        type: Sequelize.ENUM('open', 'in_progress', 'pending', 'resolved', 'closed'),
        allowNull: false,
      },
      changed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'user', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      catatan: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('log_status', ['ticket_id'], {
      name: 'idx_log_status_ticket',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('log_status');
  },
};

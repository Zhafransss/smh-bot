'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('history_chat', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'user', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'ticket', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      wa_message_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
        unique: true,
      },
      isi_pesan: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      arah: {
        type: Sequelize.ENUM('masuk', 'keluar'),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('history_chat', ['user_id'], {
      name: 'idx_history_chat_user',
    });
    await queryInterface.addIndex('history_chat', ['ticket_id'], {
      name: 'idx_history_chat_ticket',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('history_chat');
  },
};

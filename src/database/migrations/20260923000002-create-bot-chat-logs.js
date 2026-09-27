'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('bot_chat_logs')) {
      await queryInterface.createTable('bot_chat_logs', {
        id: {
          type: Sequelize.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        phone_number: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        incoming_message: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        matched_layer: {
          type: Sequelize.STRING(50),
          allowNull: true,
          comment: 'LAYER_A, LAYER_B, LAYER_C, LAYER_D_FALLBACK',
        },
        matched_item_id: {
          type: Sequelize.BIGINT.UNSIGNED,
          allowNull: true,
          references: {
            model: 'item_services',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        raw_score: {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        threshold_used: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 2,
        },
        reply_message: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        is_escalated: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        escalation_reason: {
          type: Sequelize.STRING(100),
          allowNull: true,
          comment: 'e.g. no_match, tie_score, low_score, jual_beli_non_harga',
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
        },
      });

      await queryInterface.addIndex('bot_chat_logs', ['phone_number'], {
        name: 'idx_bot_chat_logs_phone_number',
      });
      await queryInterface.addIndex('bot_chat_logs', ['is_escalated'], {
        name: 'idx_bot_chat_logs_is_escalated',
      });
      await queryInterface.addIndex('bot_chat_logs', ['created_at'], {
        name: 'idx_bot_chat_logs_created_at',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('bot_chat_logs');
  },
};

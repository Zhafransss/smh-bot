const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BotChatLog = sequelize.define(
    'BotChatLog',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      phone_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      incoming_message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      matched_layer: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'LAYER_A, LAYER_B, LAYER_C, LAYER_D_FALLBACK',
      },
      matched_item_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      raw_score: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      threshold_used: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 2,
      },
      reply_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_escalated: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      escalation_reason: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'e.g. no_match, tie_score, low_score, jual_beli_non_harga',
      },
    },
    {
      tableName: 'bot_chat_logs',
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return BotChatLog;
};

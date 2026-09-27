'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('prioritas_gangguan', [
      { id: 1, nama_prioritas: 'Low', level: 1, created_at: new Date() },
      { id: 2, nama_prioritas: 'Medium', level: 2, created_at: new Date() },
      { id: 3, nama_prioritas: 'High', level: 3, created_at: new Date() },
    ], {
      updateOnDuplicate: ['nama_prioritas', 'level'],
    });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('prioritas_gangguan', null, {});
  },
};

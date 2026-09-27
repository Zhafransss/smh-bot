'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('kategori_gangguan', [
      { id: 1, nama_kategori: 'Kendala Baterai & Charger (Drop / Tidak Bisa Cas / Kembung)', created_at: new Date() },
      { id: 2, nama_kategori: 'Dinamo / Motor Penggerak (Mati Total / Tersendat / Kasar)', created_at: new Date() },
      { id: 3, nama_kategori: 'Kontroller & Sistem Gas (Tidak Respon / Error / Terbakar)', created_at: new Date() },
      { id: 4, nama_kategori: 'Kelistrikan, Lampu & Speedometer Mati', created_at: new Date() },
      { id: 5, nama_kategori: 'Sistem Pengereman & Roda / Ban (Rem Blong / Bocor / Oleng)', created_at: new Date() },
      { id: 6, nama_kategori: 'Rantai, Belt & Mekanikal (Lepas / Kendor / Bunyi Kasar)', created_at: new Date() },
      { id: 7, nama_kategori: 'Servis Berkala & Tune-Up Rutin Sepeda / Motor Listrik', created_at: new Date() },
      { id: 8, nama_kategori: 'Pemasangan / Penggantian Aksesoris & Kelengkapan', created_at: new Date() },
      { id: 9, nama_kategori: 'Konsultasi Teknis & Kendala Lainnya', created_at: new Date() },
    ], {
      updateOnDuplicate: ['nama_kategori'],
    });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('kategori_gangguan', null, {});
  },
};

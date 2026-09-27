# SMH Support - WhatsApp Ticketing & Service System

Sistem chatbot WhatsApp untuk otomasi pendaftaran keluhan, jadwal servis, dan penanganan kendala sepeda listrik serta motor listrik **Selis Molis Hoki (SMH)**.

## Tech Stack

- **Backend:** Node.js + Express.js
- **WhatsApp:** Baileys (@whiskeysockets/baileys)
- **Database:** MySQL (via Sequelize ORM)
- **Queue:** BullMQ + Redis
- **Alert:** Nodemailer (Gmail SMTP)
- **Logger:** Pino + Pino-pretty

## Prerequisites

- Node.js >= 18
- MySQL (XAMPP / standalone)
- Redis Server
- WhatsApp (HP admin/bot untuk scan QR code)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Konfigurasi Environment

```bash
cp .env.example .env
```

Edit `.env` dan sesuaikan:
- `DB_USER`, `DB_PASSWORD` — kredensial MySQL
- `DB_NAME` — nama database (default: `smh_ticketing`)
- `API_KEY` — kunci otorisasi untuk mengakses API `/api/tickets` (header: `x-api-key` atau `Authorization: Bearer <API_KEY>`)
- `CORS_ORIGIN` — daftar domain dashboard yang diizinkan (pisahkan koma) atau `*` untuk dev
- `SMTP_USER`, `SMTP_PASS` — Gmail App Password untuk alert
- `ALERT_RECIPIENTS` — email tujuan alert teknisi/admin

### 3. Buat Database

```bash
npm run db:create
```

### 4. Jalankan Migration & Seeder

```bash
npm run db:migrate
npm run db:seed
```

### 5. Jalankan Aplikasi

```bash
# Development (auto-reload & auto redis)
npm run dev

# Production
npm start
```

### 6. Scan QR Code

Setelah aplikasi berjalan, QR code akan muncul di terminal.
Scan menggunakan WhatsApp di HP yang akan dipakai sebagai chatbot SMH Support.

## API Endpoints

> **Catatan Autentikasi:** Semua endpoint `/api/tickets` membutuhkan header `x-api-key: <API_KEY>` atau `Authorization: Bearer <API_KEY>`. Endpoint `/api/health` dapat diakses secara publik.

| Method | Endpoint | Auth | Keterangan |
|--------|----------|------|------------|
| GET | `/api/health` | Publik | System health check (DB, Redis, WA) |
| GET | `/api/tickets` | API Key | List tiket (filter: status, userId, page, limit) |
| GET | `/api/tickets/:id` | API Key | Detail tiket lengkap beserta riwayat kendala |
| PATCH | `/api/tickets/:id/status` | API Key | Update status pengerjaan tiket |
| PATCH | `/api/tickets/:id/assign` | API Key | Penugasan teknisi SMH |
| PATCH | `/api/tickets/:id/priority` | API Key | Update tingkat prioritas tiket |

## Kategori Layanan Kendaraan Listrik (SMH)

1. **Kendala Baterai & Charger** (High)
2. **Dinamo / Motor Penggerak** (High)
3. **Kontroller & Sistem Gas / Throttle** (High)
4. **Kelistrikan, Lampu & Speedometer** (Medium)
5. **Sistem Pengereman & Roda/Ban** (Medium)
6. **Rantai, Belt & Mekanikal** (Medium)
7. **Servis Berkala & Tune-Up Rutin** (Low)
8. **Pemasangan / Penggantian Aksesoris** (Low)
9. **Konsultasi & Kendala Lainnya** (Low)

*(Catatan: Kategori ini dapat disesuaikan di `src/config/constants.js` dan seeder database)*

## Database Reset

Untuk reset seluruh database:

```bash
npm run db:reset
```

## Scan QR Ulang

1. Hapus folder `auth_state/`
2. Restart aplikasi: `npm run dev`
3. Scan QR code baru yang muncul di terminal

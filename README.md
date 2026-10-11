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

## Menjalankan 24/7 dengan PM2

PM2 menjaga bot tetap hidup: otomatis restart saat crash (dengan jeda bertahap maks. 15 detik) dan saat memori > 500 MB. Konfigurasi ada di `ecosystem.config.js`.

> ⚠️ Bot **wajib 1 proses saja** (satu sesi WhatsApp). Jangan ubah `instances` / jangan jalankan `npm run dev` bersamaan dengan PM2 — dua proses akan saling menendang sesi WhatsApp.

**Persiapan (sekali saja):**

```bash
npm install -g pm2
npm run db:migrate          # mode production TIDAK menjalankan sequelize.sync()
npm start                   # jika belum pernah login: scan QR, lalu Ctrl+C
```

**Perintah harian:**

| Perintah | Fungsi |
|---|---|
| `npm run pm2:start` | Menjalankan bot (NODE_ENV=production) |
| `npm run pm2:status` | Cek status proses |
| `npm run pm2:logs` | Lihat log (QR code juga muncul di sini bila perlu scan ulang) |
| `npm run pm2:restart` | Restart setelah update kode / `.env` |
| `npm run pm2:stop` | Menghentikan bot |

Log tersimpan di folder `logs/`. Pada mode production format log berupa JSON (tanpa pino-pretty).

**Redis:** bot membutuhkan Redis yang selalu hidup. Di Linux/VPS gunakan service OS (`sudo systemctl enable --now redis-server`). Di Windows tanpa service Redis, PM2 bisa sekaligus menjaga Redis:

```powershell
$env:REDIS_SERVER_PATH = "C:\path\ke\redis-server.exe"
npm run pm2:start           # menjalankan smh-redis + smh-bot
```

**Otomatis jalan saat server/PC menyala:**

- **Linux:** `pm2 startup` (ikuti perintah yang dicetak), lalu `pm2 save`.
- **Windows:** `pm2 startup` tidak didukung. Gunakan paket pihak ketiga, misalnya `pm2-installer` (memasang PM2 sebagai Windows Service), lalu `pm2 save`.

**Perilaku reconnect WhatsApp:** bot terus mencoba reconnect tanpa batas (jeda 2s → 5s → 10s → 30s → 60s, lalu tiap 60s). Email alert dikirim **sekali** saat gagal 5x berturut-turut. Kondisi yang butuh tindakan manual (bot berhenti mencoba + email alert): **logout** (scan QR ulang), **nomor diblokir (403)**, dan **sesi diambil alih koneksi lain (440)**.

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

## Halaman QR Code & Koneksi WhatsApp

Buka `http://<host>:<PORT>/whatsapp` di browser lalu masukkan `API_KEY`. Halaman menampilkan:

- **QR code** (persis string yang dikeluarkan Baileys, berganti otomatis) bila sesi belum terhubung / `auth_state` hilang,
- **Terhubung** beserta nomor akun bila sudah login, plus tombol **Logout WhatsApp**,
- tombol **Sambungkan ulang** bila koneksi dihentikan WhatsApp (403 / sesi diambil alih 440).

Logout (dari halaman ini maupun dari HP lewat *Perangkat tertaut*) menghapus folder `auth_state/` lalu otomatis meminta QR baru — tidak perlu restart bot.

| Method | Endpoint | Auth | Keterangan |
|--------|----------|------|------------|
| GET | `/api/whatsapp/status` | API Key | `status` (`connected`, `waiting_qr`, `connecting`, `disconnected`, `blocked`, `resetting`), `qr` (string Baileys), `qrImage` (PNG data URL), `user` |
| POST | `/api/whatsapp/logout` | API Key | Unlink perangkat, hapus sesi, mulai pairing baru |
| POST | `/api/whatsapp/connect` | API Key | Coba sambung ulang saat status `blocked` |

> QR code memberi kendali penuh atas akun WhatsApp bot — jangan membuka port ini ke publik tanpa HTTPS / pembatasan akses, dan gunakan `API_KEY` yang kuat.

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

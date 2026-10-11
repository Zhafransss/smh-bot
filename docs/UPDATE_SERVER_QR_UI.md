# Catatan Update Server — Halaman QR & Koneksi WhatsApp

| | |
|---|---|
| **Fitur** | Halaman web untuk scan QR, status koneksi, dan logout WhatsApp bot |
| **Tanggal** | 7 Oktober 2026 |
| **Target** | Server Ubuntu, domain `bot.selismolishoki.com` |
| **Dependensi baru** | `qrcode` (wajib `npm install` di server) |
| **Migrasi database** | Tidak ada |
| **Perubahan `.env`** | Tidak wajib (lihat bagian 4 untuk rekomendasi produksi) |

---

## 1. Ringkasan perubahan

Sebelumnya QR hanya muncul di terminal / `pm2 logs`. Sekarang tersedia halaman `/whatsapp`:

| Kondisi bot | Tampilan halaman |
|---|---|
| Belum terhubung / `auth_state/` hilang | QR code (string persis dari Baileys, berganti otomatis) |
| Sudah terhubung | "Terhubung" + nama & nomor akun + tombol **Logout WhatsApp** |
| Dihentikan WhatsApp (403 / sesi diambil alih 440) | Alasan + tombol **Sambungkan ulang** |

### File yang berubah / baru

| File | Status | Keterangan |
|---|---|---|
| `src/services/whatsapp.service.js` | diubah | Simpan QR terakhir, `getSessionInfo`, `logoutWhatsApp`, `connectWhatsApp`, auto-wipe sesi saat logout |
| `src/routes/whatsapp.routes.js` | **baru** | `GET /status`, `POST /logout`, `POST /connect` |
| `src/public/whatsapp.html` | **baru** | Halaman UI (HTML + CSS + JS inline, tanpa CDN) |
| `src/app.js` | diubah | Mendaftarkan `/api/whatsapp` (wajib API key) dan `GET /whatsapp` |
| `package.json`, `package-lock.json` | diubah | Dependensi `qrcode` |
| `README.md` | diubah | Bagian "Halaman QR Code & Koneksi WhatsApp" |

> Pastikan folder `src/public/` ikut ter-commit dan ter-deploy. Tanpa file `whatsapp.html`, halaman `/whatsapp` akan error.

---

## 2. Endpoint baru

Semua endpoint `/api/whatsapp/*` wajib header `x-api-key: <API_KEY>` (atau `Authorization: Bearer <API_KEY>`).

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/whatsapp` | Halaman UI (HTML statis, tanpa data rahasia — meminta API key di browser) |
| GET | `/api/whatsapp/status` | Status: `connected`, `waiting_qr`, `connecting`, `disconnected`, `blocked`, `resetting`; plus `qr` (string Baileys), `qrImage` (PNG data URL), `user` |
| POST | `/api/whatsapp/logout` | Unlink perangkat, hapus `auth_state/`, mulai pairing baru (QR baru) |
| POST | `/api/whatsapp/connect` | Coba sambung ulang saat status `blocked` |

---

## 3. Perubahan perilaku yang perlu diketahui

1. **Logout dari HP** (Perangkat tertaut → keluar): dulu bot berhenti dan menunggu hapus `auth_state/` manual. Sekarang sesi dihapus otomatis dan QR baru muncul di halaman. Email alert tetap dikirim.
2. **QR kedaluwarsa tidak di-scan**: dulu masuk backoff hingga 60 detik dan memicu email alert setelah 5 kali. Sekarang QR baru diminta dalam 1 detik tanpa dihitung sebagai gangguan.
3. **Logout lewat halaman** membuat bot berhenti membalas konsumen sampai QR baru dipindai.
4. Di Baileys `7.0.0-rc14`, string QR berbentuk URL `https://wa.me/settings/linked_devices#2@...`. Halaman menampilkannya apa adanya, sama dengan yang tercetak di terminal.

---

## 4. Langkah update di server

### 4.1 Deploy kode

```bash
cd /path/ke/smh-backend
git pull                      # pastikan src/public/ ikut
npm install                   # WAJIB: memasang dependensi qrcode
npm run pm2:restart           # = pm2 restart ecosystem.config.js --update-env
npm run pm2:status            # status harus "online"
npm run pm2:logs              # pastikan tidak ada error saat start
```

> Bot **harus 1 proses saja**. Jangan jalankan `npm run dev` bersamaan dengan PM2.

### 4.2 Rekomendasi `.env` produksi

```env
NODE_ENV=production
PORT=3000
API_KEY=<string acak panjang, mis. hasil: openssl rand -hex 32>
CORS_ORIGIN=https://bot.selismolishoki.com
```

`API_KEY` adalah satu-satunya pengaman halaman ini. Jangan pakai nilai contoh. Setelah mengubah `.env`, jalankan `npm run pm2:restart`.

### 4.3 Izin folder sesi

Folder `auth_state/` (atau path di `WA_SESSION_PATH`) harus bisa ditulis oleh user yang menjalankan PM2. Logout menghapus dan membuat ulang folder tersebut.

### 4.4 Sesi WhatsApp

- `auth_state/` tidak ikut git (sengaja di-gitignore). Di server baru, bot mulai dari QR baru.
- **Matikan bot di PC lokal sebelum scan di server.** Dua bot untuk satu nomor akan saling menendang (status 440).

---

## 5. Setup domain `bot.selismolishoki.com`

### 5.1 DNS

| Type | Name | Value |
|---|---|---|
| A | `bot` | IP publik server Ubuntu |

Hanya menambah subdomain; website utama tidak terpengaruh. Jika memakai Cloudflare, awalnya set **DNS only** agar certbot lancar. Cek: `dig +short bot.selismolishoki.com`.

### 5.2 Firewall & paket

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
# Jangan buka port 3000 — Nginx mengakses lewat localhost
```

### 5.3 Nginx

`/etc/nginx/snippets/smh-proxy.conf`:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 60s;
```

`/etc/nginx/sites-available/bot.selismolishoki.com`:

```nginx
# Batasi percobaan tebak API key
limit_req_zone $binary_remote_addr zone=wa_ctrl:10m rate=30r/m;

server {
    listen 80;
    server_name bot.selismolishoki.com;

    location = /whatsapp {
        limit_req zone=wa_ctrl burst=10 nodelay;
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/snippets/smh-proxy.conf;
    }
    location /api/whatsapp/ {
        limit_req zone=wa_ctrl burst=10 nodelay;
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/snippets/smh-proxy.conf;
    }

    # Endpoint lain (/api/tickets, /api/health) tidak diekspos ke internet
    location / { return 404; }
}
```

Aktifkan + SSL:

```bash
sudo ln -s /etc/nginx/sites-available/bot.selismolishoki.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bot.selismolishoki.com     # pilih redirect HTTP → HTTPS
sudo certbot renew --dry-run                       # cek pembaruan otomatis
```

### 5.4 Pembatasan akses tambahan (sangat disarankan)

QR + API key memberi kendali penuh atas akun WhatsApp bot. Tambahkan salah satu di **kedua** `location` di atas:

- **Batasi IP:** `allow IP_KANTOR; deny all;`
- **Basic auth:** `auth_basic "SMH"; auth_basic_user_file /etc/nginx/.htpasswd;` (buat dengan `sudo htpasswd -c /etc/nginx/.htpasswd namaanda`)

---

## 6. Checklist verifikasi setelah deploy

- [ ] `npm run pm2:status` → `smh-bot` online, restart count tidak naik terus
- [ ] `curl -I https://bot.selismolishoki.com/whatsapp` → `200`
- [ ] `curl -I https://bot.selismolishoki.com/api/health` → `404` (sengaja ditutup)
- [ ] `curl -s https://bot.selismolishoki.com/api/whatsapp/status` tanpa key → `401`
- [ ] Buka `https://bot.selismolishoki.com/whatsapp`, masukkan API key → badge & QR muncul
- [ ] Scan QR dari ponsel bot (Perangkat tertaut → Tautkan perangkat) → halaman berubah "Terhubung" + nomor akun benar
- [ ] Kirim pesan uji ke nomor bot → bot membalas
- [ ] (Opsional) Uji **Logout WhatsApp** → QR baru muncul tanpa restart; scan ulang agar bot aktif lagi

---

## 7. Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| Halaman 404 di `/whatsapp` | Nginx belum di-reload, atau `server_name` tidak cocok |
| Halaman `Cannot GET` / error `ENOENT whatsapp.html` | Folder `src/public/` belum ter-deploy |
| `Cannot find module 'qrcode'` di log PM2 | Lupa `npm install` di server |
| Status `blocked` | WhatsApp menolak (403) atau sesi diambil koneksi lain (440). Pastikan hanya 1 bot aktif, lalu klik **Sambungkan ulang** |
| Halaman minta API key terus | Key salah (cek `.env` server dan restart PM2 setelah mengubahnya) |
| QR tidak muncul, status `connecting` terus | Server tidak bisa keluar ke internet / WhatsApp; cek `pm2 logs` |
| Gagal scan, "tidak dapat menautkan perangkat" | QR sudah kedaluwarsa (berganti ±20 detik) atau jam server salah; cek `timedatectl` |
| Log "API key tidak valid" selalu IP `127.0.0.1` | Normal di balik Nginx; `trust proxy` belum diaktifkan di `app.js` |

---

## 8. Rollback

```bash
cd /path/ke/smh-backend
git log --oneline -5              # catat commit sebelum update
git checkout <commit-sebelumnya>
npm install
npm run pm2:restart
```

Rollback tidak menyentuh `auth_state/`, jadi sesi WhatsApp yang sudah terhubung tetap aman.

---

## 9. Catatan keamanan & pekerjaan lanjutan

- Pemeriksaan API key di `auth.middleware.js` memakai `!==`, bukan perbandingan waktu-konstan (`crypto.timingSafeEqual`). Layak diperbaiki karena halaman kini dibuka ke internet.
- Opsional: `app.set('trust proxy', 1)` di `app.js` agar IP asli tercatat di log, dan bind `app.listen` ke `127.0.0.1` sebagai lapisan kedua di luar firewall.
- Jangan membagikan layar atau screenshot halaman saat QR tampil; siapa pun yang memindainya dapat menautkan perangkat ke nomor bot.

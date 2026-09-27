# Product Requirements Document
## Chatbot WhatsApp — Selis Molis Hoki (rule-based + klasifikasi keluhan Gemini)

| | |
|---|---|
| **Status** | Disetujui — revisi v1.2 |
| **Dokumen versi** | 1.2 |
| **Tanggal** | v1.1: 22-23 September 2026 · v1.2: 27 September 2026 |

### Riwayat Revisi

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.1 | 22-23 Sep 2026 | Draft awal: Layer A dari `item_services` + keyword `meta` (Gemini hanya batch/offline). |
| 1.2 | 27 Sep 2026 | **Revisi scope disadari & disetujui pemilik.** Estimasi biaya tidak lagi dari `item_services`, melainkan dari **jenis kerusakan website** (`GET /api/jenis-kerusakan`). Keluhan konsumen diklasifikasikan **real-time oleh Gemini** ke salah satu jenis kerusakan (atau jenis *default*), dikonfirmasi konsumen, lalu dipakai untuk **membuat reservasi Home Service** via `POST /api/home-service`. Layer A & skrip keyword `item_services` dihapus. Servis bengkel (garage) tetap di luar scope bot. |

---

## 1. Ringkasan & Latar Belakang

Selis Molis Hoki (bengkel sepeda & motor listrik) menerima banyak pertanyaan berulang dari konsumen via WhatsApp — soal harga servis, jam operasional, home service, dan ketersediaan unit/part. Pemilik usaha saat ini membalas semua pesan ini secara manual.

Dibutuhkan bot WhatsApp yang dapat menjawab pertanyaan-pertanyaan tersebut secara otomatis, **berbasis aturan (rule-based)**, dengan jawaban yang diambil dari data yang benar-benar dimiliki toko (tabel `item_services` dan aturan operasional yang ditetapkan pemilik) — bukan jawaban yang dikarang atau diperkirakan oleh AI.

## 2. Tujuan (Goals)

- Mengurangi beban pemilik usaha membalas pesan berulang secara manual.
- Memberikan jawaban yang **akurat dan konsisten**, bersumber dari data toko (harga, jam, lokasi).
- Menjamin bot **tidak pernah "halu"** — jika bot tidak yakin/tidak punya data pasti, pesan dialihkan ke admin, bukan dijawab dengan tebakan.
- Membuat sistem yang mudah dirawat: saat harga/data servis berubah di database, jawaban bot otomatis ikut berubah tanpa perlu ubah kode.

## 3. Non-Goals (di luar cakupan versi ini)

- Bot **tidak** menjawab pertanyaan katalog produk umum (sparepart/aksesoris/baterai) di luar konteks servis/trade **pada versi rilis pertama** — perluasan ke katalog produk sudah disepakati sebagai arah pengembangan berikutnya, lihat Bagian 7.5.
- Bot **tidak** melakukan negosiasi harga, konfirmasi jadwal aktual, atau transaksi apa pun secara otomatis.
- Bot **tidak** menjawab pertanyaan jual-beli unit bekas (stok, kondisi, nego) — ini otomatis dialihkan ke admin.
- LLM (Gemini) **tidak pernah menulis jawaban** untuk konsumen. Sejak v1.2 Gemini hanya dipakai sebagai *pengklasifikasi* keluhan → ID jenis kerusakan (lihat Bagian 8).
- Bot hanya mendaftarkan **Home Service**. Reservasi servis di bengkel (garage) tidak ditangani bot — konsumen diarahkan datang langsung.

## 4. Arsitektur Sistem

| Layer | Library / Teknologi | Tujuan Utama |
|---|---|---|
| Platform | Node.js (CommonJS) | JavaScript Runtime |
| HTTP Server | Express.js v5 | API Endpoints & Middlewares |
| Messaging Client | Baileys v7 | WhatsApp Web Socket Protocol |
| Message Queue | BullMQ v6 | Antrean background, rate-limiting, typing delay |
| Cache / State | ioredis + Redis 6+ | Chatbot conversation state machine & queue store |
| Database | MySQL + Sequelize ORM | Relational data persistence & audit trails |
| Alerting | Nodemailer | Notifikasi email saat koneksi WA down / eskalasi admin |
| Logger | Pino | High-performance structured logging |
| Security | Custom API Key & CORS Whitelist | Keamanan REST API |
| Klasifikasi keluhan *(real-time, output terstruktur)* | Gemini API (`gemini-3.8-flash`, cadangan `gemini-3.1-flash-lite`, beberapa API key bergiliran) → cadangan **Groq API** (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) | Memetakan keluhan konsumen ke 1 ID jenis kerusakan website — kebijakan lengkap di Bagian 8 |
| Integrasi Website | REST API website (X-API-KEY) | `GET /api/jenis-kerusakan` (daftar & estimasi), `POST /api/home-service` (buat reservasi) |

## 5. Alur Proses Utama (v1.2)

```
Pesan masuk (WhatsApp) → gabung pesan beruntun (debounce) → status "mengetik…"
    │
    ├─ Status "admin-handled" (24 jam) ─────────────────────► Bot diam
    ├─ Sedang dalam alur pendaftaran ───────────────────────► lanjutkan langkah berikutnya
    ├─ Layer C: jual-beli unit non-harga ───────────────────► eskalasi admin
    ├─ Layer B info: sapaan / lokasi / jam / luar kota ─────► jawaban statis
    │      (sapaan → mempersilakan konsumen menceritakan keluhan)
    ├─ Diagnosis keluhan (Gemini) ──────────────────────────► jenis kerusakan + estimasi (dari DB website)
    ├─ Layer B servis tanpa keluhan (mau servis / harga) ───► minta konsumen menceritakan keluhan
    └─ Tidak cocok ─────────────────────────────────────────► Layer D: eskalasi admin
```

**Alur diagnosis & reservasi:**

1. Konsumen menceritakan keluhan (bebas).
2. Bot mengambil daftar jenis kerusakan dari website, Gemini memilih **satu ID** yang paling sesuai. Tidak ada yang cocok → jenis **default** (`DEFAULT_JENIS_KERUSAKAN_ID`).
3. Jika jenis kerusakan yang terpilih dibedakan sepeda/motor dan konsumen belum menyebutkan kendaraannya → bot **bertanya dulu** (harga berbeda).
4. Bot menyampaikan **nama jenis kerusakan & estimasi biaya dari database website**, lalu bertanya: *YA* (daftar Home Service) / *TIDAK* / ceritakan lebih detail (diagnosis ulang, maks. 3 kali lalu eskalasi admin).
5. *YA* → nama & alamat → foto unit (diunduh bot) → **pin lokasi konsumen** → hari & jam kunjungan → (nomor WA bila tidak terbaca).
6. Bot `POST /api/home-service` → reservasi `pending` di website → konsumen menerima **no. resi, estimasi biaya, biaya perjalanan, jadwal yang diminta**.
7. Admin mengonfirmasi / **reschedule** jadwal langsung dengan konsumen.

Status "admin-handled" di Redis otomatis reset setelah 24 jam. Ketik *batal* kapan saja untuk membatalkan pendaftaran.

## 6. Model Data

### 6.1 Sumber data estimasi: `jenis_kerusakans` (website)

Diakses bot hanya lewat API website (tidak membaca DB website langsung):

| Kolom | Keterangan |
|---|---|
| `id` | Dikirim sebagai `idJenisKerusakan` saat membuat reservasi |
| `nama` | Pola `Kategori_Detail`, banyak dibedakan sepeda/motor (mis. `Charger_Motor Listrik Tidak bisa Mengisi`) |
| `biaya_estimasi` | Satu-satunya sumber angka estimasi yang disampaikan ke konsumen |

Jenis **default** (mis. "Pengecekan Umum") ditambahkan di website produksi; ID-nya diset di `.env` bot (`DEFAULT_JENIS_KERUSAKAN_ID`) dan **tidak pernah** ditawarkan ke Gemini sebagai pilihan.

### 6.2 `item_services`

Sejak v1.2 **tidak lagi dipakai oleh bot**. Temuan kualitas data v1.1 (duplikat, `code` kosong) tetap relevan untuk website/POS, bukan untuk bot.

### 6.3 Data reservasi yang dikirim (`POST /api/home-service`)

`namaLengkap`, `noTelp` (nomor WA pengirim, format lokal `08…`), `alamatLengkap`, `latitude`/`longitude` (pin lokasi konsumen), `idJenisKerusakan` (hasil diagnosis), `deskripsi` (kata-kata konsumen + catatan internal untuk admin), `gambar` (foto unit), `tanggal`, `waktuMulai`, `waktuSelesai` (slot 2 jam dari permintaan konsumen).

## 7. Spesifikasi Fungsional

### 7.1 Diagnosis Keluhan & Estimasi Biaya (menggantikan Layer A v1.1)

- Input: cerita keluhan konsumen (bisa beberapa pesan; detail tambahan digabung).
- Gemini mengembalikan JSON terstruktur `{ is_complaint, vehicle, jenis_id, ringkasan }`; bot **memvalidasi** `jenis_id` harus ada di daftar yang dikirim.
- Jenis kendaraan hanya diambil dari kata yang **benar-benar ditulis konsumen** (bukan tebakan Gemini).
- Balasan ke konsumen dirakit dari template + `nama` & `biaya_estimasi` jenis kerusakan (database). Ringkasan Gemini hanya masuk ke `deskripsi` reservasi sebagai catatan internal admin.
- Konsumen wajib mengonfirmasi (YA/TIDAK/detail) sebelum data pendaftaran diminta.

### 7.2 Layer B — Info Operasional (hardcode, statis)

Data final yang sudah dikonfirmasi pemilik usaha:

- **Jam Bengkel:** Senin–Sabtu, 09.00–17.00 WIB. Minggu tutup.
- **Jam Home Service:** Senin–Sabtu, 09.00–20.00 WIB.
- **Alamat Toko 1 (Pusat):** Jl. Jend Sudirman No. 32, Kebontebu Berkoh, Purwokerto Selatan, Jawa Tengah.
- **Alamat Toko 2 (Cadangan):** Jl. Sultan Agung Sumber Sumber, Cirebon, Jawa Barat.
- Sapaan, pertanyaan "mau servis/home service/harga" tanpa keluhan → bot mempersilakan konsumen menceritakan keluhan. **Tidak ada daftar harga hardcode** (v1.2).
- Jadwal kunjungan yang diminta divalidasi terhadap jam Home Service (Senin–Sabtu 09.00–20.00 WIB); bot tetap aktif 24 jam.

### 7.3 Layer C — Jual-Beli Unit

Pertanyaan jual-beli unit (bekas, stok, kondisi, nego) — tanpa jawaban generik — langsung dialihkan ke admin (Bagian 7.4).

### 7.4 Layer D — Fallback / Eskalasi ke Admin

- Dipicu jika: pesan bukan keluhan dan tidak cocok aturan mana pun; diagnosis belum sesuai setelah 3 kali penjelasan; daftar jenis kerusakan / jenis default tidak tersedia; atau pembuatan reservasi di website gagal.
- Bot mengirim **satu kali** pesan pemberitahuan (jujur — tidak pernah menyatakan reservasi berhasil bila gagal), status percakapan diset "admin-handled" (24 jam), dicatat ke MySQL, dan email admin di-throttle berisi seluruh data yang sudah terkumpul.

### 7.5 Pendaftaran Home Service

- Foto unit diunduh bot dari WhatsApp dan dikirim sebagai file; lokasi wajib **pin lokasi WhatsApp** (link Google Maps ditolak dengan panduan).
- Hari & jam ditulis bebas ("Senin jam 10", "besok jam 2 siang", "28/09 jam 13.00"); ditolak jika Minggu, di luar 09.00–20.00, sudah lewat, atau > 90 hari.
- Nomor WhatsApp: nomor asli pengirim (ID `@lid` WhatsApp diterjemahkan); jika tetap tidak terbaca, bot menanyakan nomor.
- `POST` tidak diulang otomatis (mencegah reservasi ganda); kegagalan → eskalasi admin.

## 8. Kebijakan Anti-Halusinasi & Peran Gemini API (revisi v1.2)

### 8.1 Peran Gemini

Gemini dipakai **real-time**, tetapi **hanya sebagai pengklasifikasi**: memilih satu ID dari daftar jenis kerusakan yang dikirim bot. Gemini tidak menulis kalimat untuk konsumen dan tidak pernah menyebut harga.

### 8.2 Jaminan desain

- Setiap nama jenis kerusakan & angka estimasi yang dikirim ke konsumen **berasal langsung dari database website**.
- Output Gemini dibatasi skema JSON; ID di luar daftar diabaikan (→ jenis default).
- Konsumen mengonfirmasi hasil diagnosis; admin memverifikasi reservasi (`pending`).
- Hanya teks keluhan yang dikirim ke penyedia AI (Gemini / Groq) — tanpa nama, nomor, alamat — pertimbangan privasi / UU PDP.

### 8.3 Ketahanan (fallback)

| Kondisi | Perilaku |
|---|---|
| Satu API key Gemini kena limit (429) | Pindah ke key Gemini berikutnya (`GEMINI_API_KEYS`); key diistirahatkan sesuai waktu tunggu Google |
| Model Gemini padat (503) / timeout / semua key limit | Coba model cadangan Gemini (`GEMINI_FALLBACK_MODEL`) |
| Seluruh Gemini gagal | Pindah ke **Groq** (`CLASSIFIER_PROVIDERS=gemini,groq`), prompt & validasi yang sama |
| Semua AI provider gagal & pesan tampak seperti keluhan | Pakai jenis default + catatan "estimasi dikonfirmasi ulang admin" |
| Semua AI provider gagal & pesan bukan keluhan | Eskalasi admin |
| Daftar jenis kerusakan / jenis default tidak tersedia | Eskalasi admin (bot tidak menebak estimasi) |

## 9. Kualitas & Nuansa Respons

- Tunggu jeda beberapa detik untuk menggabungkan pesan yang dikirim beruntun oleh konsumen (banyak konsumen mengetik pertanyaan dicicil per baris) sebelum diproses sebagai satu konteks.
- Simulasi status "mengetik..." + delay sebelum membalas, agar terasa natural (memanfaatkan BullMQ).
- Sapaan pembuka hanya muncul sekali per percakapan baru, tidak di setiap balasan.
- Setiap keputusan pencocokan (pesan masuk → item/intent terpilih → skor → jawaban) dicatat ke MySQL untuk keperluan audit dan tuning threshold di kemudian hari.

## 10. Kebutuhan Non-Fungsional

- Bahasa respons: Bahasa Indonesia, gaya bicara sesuai contoh percakapan asli toko (informal-sopan, seperti pola jawaban di lampiran).
- Keamanan API: menggunakan API key kustom & CORS whitelist (sudah ada di arsitektur).
- Audit trail: seluruh interaksi (masuk & keluar) tersimpan di MySQL via Sequelize.
- Observability: logging terstruktur via Pino untuk seluruh alur proses pesan.

## 11. Risiko & Hal yang Perlu Ditindaklanjuti

1. **Kuota & latensi Gemini** — kunci saat ini *free tier* (± 5 request/menit per model) dan model sering "high demand"; latensi teramati 3–10 detik. Untuk produksi disarankan mengaktifkan billing (paid tier).
2. **Salah klasifikasi** — beberapa jenis kerusakan mirip dengan harga berbeda jauh (mis. "tidak bisa digas": Rp120.000–Rp485.000). Dimitigasi dengan konfirmasi konsumen, pertanyaan jenis kendaraan, dan verifikasi admin.
3. **Privasi** — teks keluhan dikirim ke Google (Gemini). Cantumkan di kebijakan privasi toko bila diperlukan.
4. **Ketergantungan API website** — endpoint `/api/jenis-kerusakan` & `/api/home-service` harus ter-deploy di produksi; `API_KEY` default yang tercantum di dokumentasi wajib diganti.
5. **Jenis default** — `DEFAULT_JENIS_KERUSAKAN_ID` wajib diisi sesuai ID di produksi; tanpa itu keluhan yang tidak cocok akan dialihkan ke admin.

## 12. Lampiran

### 12.1 Contoh Q&A asli (rujukan gaya bahasa & pola pertanyaan — pola jawaban harga di tabel ini dari v1.1, sejak v1.2 estimasi diambil dari jenis kerusakan website)

| Pertanyaan Konsumen | Pola Jawaban |
|---|---|
| Bisa service cas an motor listrik ? | Jelaskan kemungkinan penyebab (baterai vs charger) + biaya servis elektris + estimasi waktu |
| Bengkel Tutup jam berapa ? | Jam bengkel + jam home service |
| Mau Home service atau panggilan ke rumah bisa ? | Konfirmasi bisa + arahkan ke reservasi (link/format data) |
| Bengkel belum buka di kota tertentu | Tawarkan konsultasi remote + kirim part |
| Sepeda listrik tiba-tiba mati saat diparkir | Konfirmasi bisa dicek + biaya pengecekan kelistrikan sepeda |
| Ada jual Molis seken? | *(Sekarang: dialihkan ke admin — lihat Bagian 7.3)* |
| Ganti aki tapi jalan masih pelan | Biaya pengecekan kelistrikan sepeda + kemungkinan penyebab (ECU/jalur power) |
| Motor listrik tidak mau digas | Kemungkinan penyebab (sensor/ECU) + biaya pengecekan kelistrikan motor |
| Rantai sepeda macet | Biaya servis mekanis + catatan di luar sparepart |
| Home service jam 8 pagi | Tolak halus (di luar jam) + tetap arahkan ke reservasi |
| Cek rem molis | Kemungkinan penyebab + biaya servis mekanis |
| Home service sekarang | Arahkan ke reservasi (link + format data) |

### 12.2 Jam Operasional

- Bengkel: Senin–Sabtu, 09.00–17.00 WIB. Minggu tutup.
- Home service: Senin–Sabtu, 09.00–20.00 WIB.

### 12.3 Alamat

- Toko 1 (Pusat): Jl. Jend Sudirman No. 32, Kebontebu Berkoh, Purwokerto Selatan, Jawa Tengah.
- Toko 2 (Cadangan): Jl. Sultan Agung Sumber Sumber, Cirebon, Jawa Barat.

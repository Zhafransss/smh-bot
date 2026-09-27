# Product Requirements Document
## Chatbot WhatsApp Rule-Based — Selis Molis Hoki

| | |
|---|---|
| **Status** | Draft — hasil brainstorming |
| **Dokumen versi** | 1.1 |
| **Tanggal** | 22-23 September 2026 |

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
- Tidak ada pemahaman bahasa alami berbasis LLM untuk *menjawab* konsumen — hanya rule/keyword matching (lihat Bagian 8 soal peran Gemini API).

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
| Data Enrichment *(batch/offline, bukan jalur real-time)* | Gemini API | Menghasilkan kata kunci/sinonim per item `item_services`, disimpan ke kolom `meta` — lihat kebijakan lengkap di Bagian 8 |

## 5. Alur Proses Utama

```
Pesan masuk (WhatsApp)
    │
    ▼
BullMQ: tunggu jeda singkat untuk menggabungkan pesan beruntun
    │
    ▼
Cek status percakapan di Redis
    │
    ├─ Status = "admin-handled" & belum lewat masa reset ──► Bot diam, tidak diproses
    │
    ▼ (status normal / sudah reset)
Rule/Keyword Matcher
    │
    ├─ Cocok ke intent "info operasional" (hardcode) ──► Jawab dari data statis
    │
    ├─ Cocok ke item `item_services` (category service/trade) ──► Jawab dari DB
    │       (harga, nama, ringkasan dari `keterangan`)
    │
    ├─ Pertanyaan jual-beli & harga item ADA di DB ──► Jawab dari DB
    │
    └─ Tidak cocok / confidence rendah / jual-beli non-harga ──► FALLBACK
                │
                ▼
        Kirim 1x pesan "akan dibantu admin"
        Set status Redis = "admin-handled" (+ timestamp)
        Log ke MySQL untuk audit
        (opsional, di-throttle) Notifikasi email ke admin
```

Status "admin-handled" di Redis **otomatis reset setelah 24 jam** (keputusan final), sehingga bot aktif kembali untuk user tersebut tanpa perlu aksi manual admin.

## 6. Model Data

### 6.1 Tabel `item_services` (sudah ada, dump 22 September 2026)

```
id            bigint, PK
code          varchar, nullable   -- slug semantik, mis. "service_elektris" (belum lengkap, ±120/238 baris NULL)
name          varchar, not null
price         bigint, not null
unit          varchar, nullable   -- tidak konsisten: "item", "Pcs", "Km", "Panggil", dst.
jenis         varchar             -- "debit" / "kredit"
category      enum: baterai | sparepart | aksesoris | service | trade
meta          longtext (JSON)     -- saat ini kosong di semua baris; DIUSULKAN dipakai untuk keyword bot
created_at    timestamp
updated_at    timestamp
lokasi        enum: Gudang Aki | Etalase Inovasi | Etalase Sparepart | Pre order | Custom
picture       varchar
keterangan    text                -- deskripsi bebas, sumber konteks tambahan untuk jawaban bot
```

**Ruang lingkup data yang relevan untuk chatbot:** baris dengan `category IN ('service', 'trade')` — sekitar 41 dari 238 baris total.

### 6.2 Catatan kualitas data (temuan review, perlu ditindaklanjuti sebelum implementasi)

- Kolom `code` tidak konsisten diisi — jika dipakai sebagai kunci acuan intent, perlu dilengkapi.
- Ditemukan indikasi duplikat/kemiripan data:
  - `id 202` ("Kir Kelistrikan...") vs `id 203` ("Kit Kelistrikan...") — nama nyaris identik, harga sama (Rp375.000), kemungkinan salah ketik/duplikat entri.
  - `id 245` "Ongkos Jasa Angkut dalam Kota" (Rp50.000/Km) vs `id 251` "Biaya perjalanan" (Rp5.000/Km) — dua konsep ongkos jalan dengan tarif berbeda jauh; berisiko bot salah pilih saat menjawab soal ongkos ke lokasi konsumen.
- Ada pasangan harga "standar vs custom" untuk kasus elektris & mekanis:
  | code | name | price |
  |---|---|---|
  | `service_elektris` | Biaya Servis Elektris | Rp35.000 |
  | `service_elektris_custom` | Biaya Servis Elektris Custom | Rp50.000 |
  | (id 230) | Pengecekan Kelistrikan sepeda listrik | Rp25.000 |
  | (id 241) | Pengecekan Kelistrikan Motor Listrik Standar | Rp50.000 |
  | `service_mekanis` | Biaya Servis Mekanis | Rp25.000 |
  | (id 227) | Servis Mekanis Custom | Rp50.000 |

  Bot tidak dapat menentukan sendiri mana yang "custom" dari sekadar chat. Ketentuan produk: **selalu tawarkan harga standar dulu**, ditambah kalimat baku: *"Biaya bisa berbeda jika kondisi lebih rumit, akan dikonfirmasi teknisi setelah dicek."*

## 7. Spesifikasi Fungsional

### 7.1 Layer A — Servis & Harga (dinamis dari database)

- Sumber jawaban: baris `item_services` dengan `category IN ('service','trade')`.
- Setiap baris punya "profil kata kunci" yang dipakai untuk mencocokkan pesan konsumen (lihat Bagian 8 soal cara menghasilkan kata kunci).
- Jawaban dirakit dari template + nilai DB (`name`, `price`, ringkasan `keterangan`) — **bukan teks bebas yang di-generate ulang setiap kali**.
- Aturan standar vs custom (Bagian 6.2) berlaku di sini.

### 7.2 Layer B — Info Operasional (hardcode, statis)

Data final yang sudah dikonfirmasi pemilik usaha:

- **Jam Bengkel:** Senin–Sabtu, 09.00–17.00 WIB. Minggu tutup.
- **Jam Home Service:** Senin–Sabtu, 09.00–20.00 WIB.
- **Alamat Toko 1 (Pusat):** Jl. Jend Sudirman No. 32, Kebontebu Berkoh, Purwokerto Selatan, Jawa Tengah.
- **Alamat Toko 2 (Cadangan):** Jl. Sultan Agung Sumber Sumber, Cirebon, Jawa Barat.
- **Aturan penyebutan lokasi:** sebutkan kedua toko **hanya jika** ditanya eksplisit soal lokasi/alamat. Jika konteksnya default (mis. reservasi servis tanpa nanya lokasi), asumsikan Toko 1 Purwokerto.
- **Bot tetap aktif menjawab di luar jam operasional** — jam operasional hanya dipakai untuk validasi permintaan home service (mis. menolak halus permintaan di luar 09.00–20.00), bukan pembatas jam aktif bot itu sendiri.

### 7.3 Layer C — Jual-Beli Unit

- Bot **hanya** menjawab jika pertanyaan adalah soal **harga** item yang barisnya ada di `item_services`.
- Semua pertanyaan jual-beli lain (kondisi unit bekas, stok, nego, dll.) — **tanpa jawaban generik apa pun** — langsung dialihkan ke admin (masuk ke alur Fallback, Bagian 7.4).

### 7.4 Layer D — Fallback / Eskalasi ke Admin

- Dipicu jika: tidak ada intent/item yang cocok, confidence terlalu rendah, atau kasus Layer C yang bukan pertanyaan harga.
- Bot mengirim **satu kali** pesan pemberitahuan bahwa akan dibantu admin.
- Status percakapan untuk nomor tersebut diset "admin-handled" di Redis — bot berhenti membalas thread itu.
- Reset otomatis setelah durasi tertentu (default diusulkan 24 jam, dapat dikonfigurasi).
- Setiap eskalasi dicatat ke MySQL untuk audit.
- Notifikasi email ke admin (Nodemailer) di-throttle/batch — tidak satu email per satu eskalasi saat volume tinggi.

### 7.5 Layer E — Katalog Produk (arah pengembangan berikutnya, di luar rilis pertama)

Cakupan bot akan diperluas ke `category IN ('sparepart', 'aksesoris', 'baterai')` (≈197 dari 238 baris) — pertanyaan konsumen soal harga/ketersediaan produk fisik, bukan cuma jasa servis.

Prinsip yang sama tetap berlaku: **jawaban wajib berasal dari data di `item_services`, tidak boleh menebak.** Aturan tambahan khusus layer ini:

- **Kalau hasil pencocokan mengarah ke lebih dari satu item** (mis. konsumen tanya "baterai lithium 36v" dan ada beberapa varian di database) → bot pilih **item dengan skor kecocokan (raw count) tertinggi**, bukan menampilkan semua opsi ke konsumen.
- Kalau ada **skor seri (tie)** antar beberapa item → dianggap ambigu, bot tidak menebak, dialihkan ke admin (aturan ini konsisten dengan prinsip anti-halu di Bagian 8).
- Kalau tidak ada item yang cocok sama sekali → fallback ke admin seperti biasa (Bagian 7.4), bot **tidak** boleh menjawab dengan estimasi/perkiraan harga produk sejenis.

## 8. Kebijakan Anti-Halusinasi & Peran Gemini API

Ini adalah **prinsip inti** sistem: jawaban yang dikirim ke konsumen tidak pernah berasal dari teks yang di-generate bebas oleh model AI.

### 8.1 Pemisahan tegas: penyiapan data vs pelayanan pesan

| | Kapan dijalankan | Yang dilakukan | Boleh pakai Gemini API? |
|---|---|---|---|
| **Proses penyiapan (batch/offline)** | Sekali di awal untuk seluruh data servis, lalu diulang tiap ada item baru/berubah | Membaca `name` + `keterangan` tiap baris `item_services`, meminta Gemini menghasilkan daftar kata kunci/sinonim, menyimpan hasilnya ke kolom `meta` | **Ya** — karena hasilnya berupa metadata yang ditinjau/tersimpan, bukan langsung dikirim ke konsumen |
| **Proses pelayanan pesan (real-time)** | Setiap ada pesan masuk dari konsumen | Mencocokkan teks pesan ke kata kunci yang sudah tersimpan di `meta`, memilih item dengan skor tertinggi, merakit jawaban dari template + data pasti (`name`, `price`, `keterangan`) | **Tidak** — tidak ada pemanggilan model AI generatif pada jalur ini sama sekali |

"Offline" di sini bukan berarti tanpa koneksi internet — proses batch tetap memanggil Gemini API secara online. Maksudnya adalah **proses ini terpisah dari alur balasan real-time ke konsumen**, sehingga hasil kerja Gemini selalu melewati tahap "disimpan ke database" sebelum sampai ke konsumen, bukan langsung dikirim sebagai jawaban.

### 8.2 Jaminan yang diberikan desain ini

- Setiap kalimat harga, nama layanan, dan estimasi yang dikirim ke konsumen **berasal langsung dari kolom di `item_services`** (`price`, `name`, `keterangan`) yang diisi/dikelola pemilik usaha — bukan hasil karangan AI.
- Gemini API hanya berperan sebagai alat bantu **pelabelan/tagging**, setara pekerjaan yang sebelumnya harus dikerjakan manual satu per satu.
- Kalau hasil pencocokan kata kunci tidak cukup yakin (skor di bawah ambang batas — lihat 8.3), bot **tidak menjawab sebisanya**, melainkan langsung ke jalur eskalasi admin.

### 8.3 Parameter yang sudah diputuskan

- **Metode skor kecocokan:** *raw count* — jumlah kata kunci di `meta` yang cocok dengan pesan konsumen (angka bulat, bukan rasio/persentase). Bisa dievaluasi ulang ke metode rasio nanti kalau raw count terbukti kurang akurat setelah dipakai produksi.
- **Pemicu proses batch keyword:** manual sepenuhnya lewat developer, dengan alur: developer membuka database → import data item baru → menjalankan service Gemini → data keyword ter-generate → disimpan ke kolom `meta`. Tidak ada proses otomatis/terjadwal untuk versi ini.
- **Format `meta`:** lihat contoh struktur JSON di bawah.
- **Label audit `generated_by`:** batch yang disusun di luar pemanggilan Gemini API sungguhan (mis. penyiapan awal data) diberi label `"manual awal batch"`. Label `"gemini-batch-1"`, `"gemini-batch-2"`, dst. hanya dipakai untuk batch yang benar-benar dihasilkan lewat pemanggilan Gemini API, supaya kolom ini tetap bisa diaudit secara jujur.

Contoh struktur `meta`:

```json
{
  "keywords": ["cas", "charger", "tidak bisa dicas", "ngecas", "colokan rusak"],
  "vehicle_hint": ["motor"],
  "generated_by": "manual awal batch",
  "generated_at": "2026-09-23"
}
```

### 8.4 Parameter yang masih terbuka (perlu diuji di tahap teknis)

- Nilai ambang batas (*confidence threshold*) minimal — angka pasti skor *raw count* minimal agar bot dianggap "yakin" menjawab. Metode sudah ditentukan (8.3), tapi angkanya baru bisa ditentukan setelah diuji dengan data/percakapan riil.

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

1. **Duplikasi/ambiguitas data** (Bagian 6.2) sebaiknya dibersihkan di database sebelum go-live — untuk item `service`/`trade`, ini mencegah keyword matching salah pilih SKU; untuk item katalog produk (Bagian 7.5), duplikasi/kemiripan nama berisiko memicu kasus "skor seri" yang berujung eskalasi ke admin padahal sebenarnya konsumen bertanya hal yang jelas.
2. **Angka pasti ambang batas confidence** (Bagian 8.4) belum final — baru bisa ditentukan setelah diuji dengan data/percakapan riil pasca go-live.
3. Layer katalog produk (Bagian 7.5) baru berupa aturan konsep — belum ada rincian teknis (query, endpoint, dsb) karena memang di luar cakupan rilis pertama.

## 12. Lampiran

### 12.1 Contoh Q&A asli (rujukan gaya bahasa & pola pertanyaan)

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

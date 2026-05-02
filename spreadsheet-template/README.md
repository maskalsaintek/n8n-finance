# Spreadsheet Template

Template ini dibuat untuk dipakai sebagai source of truth trading, lalu nanti dibaca oleh `main-logic.js` / n8n.

## File

- `SETTINGS.csv`
- `TRADE_LOG.csv`
- `CYCLE_SUMMARY.csv`
- `DASHBOARD.csv`
- `TRADE_TOOLS.csv`

## Struktur yang disarankan di Google Sheets

1. Buat spreadsheet baru.
2. Import masing-masing CSV sebagai sheet terpisah.
3. Rename sheet persis seperti nama file tanpa `.csv`:
   - `SETTINGS`
   - `TRADE_LOG`
   - `CYCLE_SUMMARY`
   - `DASHBOARD`
   - `TRADE_TOOLS`

## Cara pakai

### 1. SETTINGS

Sheet `SETTINGS` sekarang difokuskan hanya untuk `config strategi manual`.

Artinya sheet ini tidak dipakai lagi untuk menyimpan harga live market.

#### Yang manual

Ini adalah parameter strategi. Biasanya tidak berubah tiap hari.

- `tp_anchor_pct`
- `tp_dip_pct`
- `tp_deep_dip_pct`
- `dip_threshold_pct`
- `deep_dip_threshold_pct`
- `troy_oz_to_gram`
- `monthly_budget_idr`
- `swing_ammo_idr`
- `anchor_day`

#### Penjelasan tiap variabel

`tp_anchor_pct`

Target take profit untuk posisi `Anchor`, dihitung dari harga beli anchor itu sendiri.

Contoh:

- jika `tp_anchor_pct = 2`
- dan anchor buy kamu di `3000 USD`
- maka TP anchor aktif saat harga sekitar `3060 USD`

Artinya posisi anchor tidak menunggu average seluruh aset, tapi melihat harga entry anchor secara spesifik.

`tp_dip_pct`

Target take profit untuk posisi `Dip`, dihitung dari harga beli dip itu sendiri.

Contoh:

- jika `tp_dip_pct = 3`
- dan dip buy kamu di `2900 USD`
- maka TP dip aktif saat harga sekitar `2987 USD`

Artinya posisi dip punya target sendiri, terpisah dari anchor maupun deep dip.

`tp_deep_dip_pct`

Target take profit untuk posisi `Deep Dip`, dihitung dari harga beli deep dip itu sendiri.

Contoh:

- jika `tp_deep_dip_pct = 5`
- dan deep dip buy kamu di `2800 USD`
- maka TP deep dip aktif saat harga sekitar `2940 USD`

Biasanya karena entry deep dip ada di koreksi yang lebih dalam, target profitnya juga bisa dibuat lebih besar.

`dip_threshold_pct`

Batas koreksi harga dari anchor yang dianggap cukup dalam untuk melakukan `Dip Buy`.

Contoh:

- anchor bulan ini `3000 USD`
- `dip_threshold_pct = 3`
- maka alert dip muncul saat harga turun ke sekitar `2910 USD`

Catatan penting:

- `dip_threshold_pct` bukan berarti semua penurunan di atas angka ini selalu dianggap `Dip Buy`
- range `Dip Buy` yang normal adalah:
- `drop >= dip_threshold_pct`
- dan `drop < deep_dip_threshold_pct`

Contoh jika:

- `dip_threshold_pct = 3`
- `deep_dip_threshold_pct = 5`

Maka:

- turun `3%` sampai `< 5%` = `Dip Buy`
- turun `>= 5%` = bukan `Dip Buy` lagi, tapi masuk `Deep Dip Buy`

`deep_dip_threshold_pct`

Batas koreksi harga yang lebih dalam untuk `Deep Dip Buy`.

Ini adalah level koreksi lanjutan setelah dip biasa.

Contoh:

- anchor `3000 USD`
- `deep_dip_threshold_pct = 5`
- maka alert deep dip muncul saat harga turun ke sekitar `2850 USD`

Hubungannya dengan `dip_threshold_pct`:

- `deep_dip_threshold_pct` harus lebih besar dari `dip_threshold_pct`
- nilai ini adalah batas lanjutan setelah zona dip biasa

Contoh struktur yang sehat:

- `dip_threshold_pct = 3`
- `deep_dip_threshold_pct = 5`

Artinya zona koreksi dibagi begini:

- `< 3%` = belum ada sinyal beli tambahan
- `3% s.d. < 5%` = `Dip Buy`
- `>= 5%` = `Deep Dip Buy`

`troy_oz_to_gram`

Angka konversi tetap dari `1 troy ounce` ke `gram`.

Nilainya standar:

- `31.1034768`

Biasanya tidak perlu diubah.

Dipakai agar sistem bisa menghitung:

- total gram emas
- estimasi gram dari pembelian PAXG

`monthly_budget_idr`

Budget bulanan untuk strategi akumulasi per cycle.

Nilai ini dipakai untuk membagi dana ke:

- anchor buy
- dip buy
- deep dip buy

Contoh:

- jika `monthly_budget_idr = 4.000.000`
- dan alokasi strategi 45% / 35% / 25%

Maka kira-kira:

- anchor: `1.800.000`
- dip: `1.400.000`
- deep dip: `1.000.000`

`swing_ammo_idr`

Dana terpisah untuk kebutuhan swing / trading, di luar budget akumulasi bulanan.

Ini berguna kalau kamu ingin memisahkan:

- dana investasi rutin
- dana trading yang diputar

Contoh:

- `monthly_budget_idr` untuk DCA bulanan
- `swing_ammo_idr` untuk posisi swing yang nanti dipakai take profit per posisi

Kalau strategi kamu memang memisahkan dua kantong dana, variabel ini penting.
Kalau belum dipakai penuh sekarang, tetap bagus disiapkan dari awal.

Penjelasan paling sederhananya:

- `monthly_budget_idr` = uang belanja rutin bulanan
- `swing_ammo_idr` = peluru/modal trading yang bisa dipakai, dijual lagi, lalu dipakai lagi

Cara membayangkannya:

Kamu punya dua dompet:

1. Dompet investasi rutin
   Dompet ini dipakai untuk akumulasi bulanan.
   Misalnya setiap bulan kamu memang siap setor `4.000.000` untuk beli emas.

2. Dompet swing
   Dompet ini dipakai untuk trading jangka pendek/menengah.
   Misalnya kamu siapkan `10.000.000` khusus untuk cari peluang buy saat koreksi lalu jual saat TP.

Jadi fungsi `swing_ammo_idr` bukan untuk menambah budget bulanan DCA, tapi untuk menunjukkan:

- berapa modal maksimum yang memang kamu siapkan untuk posisi swing
- berapa kapasitas trading yang boleh diputar
- berapa besar eksposur yang masih aman untuk strategi take profit per posisi

Contoh sederhana:

- `monthly_budget_idr = 4.000.000`
- `swing_ammo_idr = 10.000.000`

Artinya:

- kamu tetap punya rencana beli rutin bulanan sebesar `4 juta`
- di luar itu, kamu punya modal `10 juta` untuk posisi swing

Contoh alur:

1. Bulan ini kamu DCA seperti biasa dari `monthly_budget_idr`
2. Saat ada peluang swing yang bagus, kamu entry dari `swing_ammo_idr`
3. Saat harga naik ke target posisi masing-masing, posisi swing dijual
4. Hasil jual itu kembali lagi menjadi amunisi swing untuk peluang berikutnya

Jadi `swing_ammo_idr` sifatnya:

- bukan dana habis pakai per bulan
- tapi modal kerja yang berputar

Kapan variabel ini benar-benar terasa berguna:

- saat kamu ingin memisahkan investasi jangka panjang vs trading aktif
- saat kamu ingin tahu TP dihitung atas posisi swing, bukan seluruh aset
- saat kamu ingin membatasi agar trading tidak memakai seluruh dana investasi

Kalau kamu belum memisahkan dua gaya ini, kamu bisa anggap:

- `monthly_budget_idr` = modal akumulasi
- `swing_ammo_idr` = cadangan khusus trading

Kalau belum punya strategi swing terpisah, nilainya bisa tetap diisi sebagai placeholder dulu.
Nanti saat sistem makin matang, variabel ini bisa dipakai untuk:

- validasi ukuran posisi
- pembatas maksimum entry swing
- pemisahan laporan PnL antara DCA dan swing

### 2. TRADE_LOG

Sheet ini adalah ledger utama. Satu baris = satu aksi.

Kolom yang diisi manual:

- `date_time`
- `cycle_id`
- `action`
- `price_usd_oz`
- `usdt_idr`
- `gross_idr`
- `fee_pct`
- `posted_status`
- `note`

Penjelasan tiap kolom:

`date_time`

Waktu saat transaksi benar-benar terjadi.

Format yang disarankan:

- `YYYY-MM-DD HH:mm:ss`

Contoh:

- `2026-04-28 09:30:00`

Fungsi kolom ini:

- mencatat urutan transaksi
- memudahkan audit
- memudahkan cocokkan dengan riwayat exchange

`cycle_id`

Kode siklus strategi tempat transaksi itu masuk.

Format yang disarankan:

- `YYYY-MM`

Contoh:

- `2026-04`
- `2026-05`

Fungsi kolom ini:

- mengelompokkan transaksi berdasarkan siklus bulanan
- memudahkan ringkasan di `CYCLE_SUMMARY`

Praktiknya:

- transaksi anchor, dip, deep dip, dan TP dalam satu siklus biasanya memakai `cycle_id` yang sama

`action`

Jenis aksi transaksi yang dilakukan.

Contoh nilai yang dipakai:

- `BUY_ANCHOR`
- `BUY_DIP`
- `BUY_DEEP`
- `SELL_TP1`
- `SELL_TP2`

Fungsi kolom ini:

- memberi tahu sistem apakah row ini pembelian atau penjualan
- menentukan cara hitung posisi terbuka
- menentukan cara hitung realized PnL

Panduan sederhana:

- pakai `BUY_ANCHOR` untuk pembelian rutin anchor
- pakai `BUY_DIP` saat beli di koreksi level dip
- pakai `BUY_DEEP` saat beli di koreksi level deep dip
- pakai `SELL_TP1` atau `SELL_TP2` sesuai label jual yang kamu pilih di ledger
- untuk logic terbaru, keputusan TP dilihat dari posisi `Anchor`, `Dip`, atau `Deep Dip`, bukan dari average semua aset

`price_usd_oz`

Harga PAXG dalam USD per troy ounce saat transaksi dilakukan.

Contoh:

- `3325.50`

Fungsi kolom ini:

- menjadi harga referensi buy/sell
- dipakai untuk hitung estimasi qty PAXG
- dipakai untuk hitung koreksi dari anchor dan performa posisi terhadap harga masuknya

Penting:

- isi harga eksekusi aktual jika ada
- jangan isi harga perkiraan kalau kamu sudah tahu harga fill yang benar

`usdt_idr`

Nilai tukar USDT ke IDR saat transaksi dilakukan.

Contoh:

- `16250`

Fungsi kolom ini:

- mengubah harga USD menjadi nilai IDR
- dipakai untuk hitung qty, cost basis, dan PnL dalam rupiah

Saran:

- kalau exchange memberi kurs real transaksi, pakai angka itu
- kalau tidak ada, pakai kurs market terdekat saat order dieksekusi

`gross_idr`

Nilai transaksi kotor dalam rupiah, sebelum fee.

Untuk `BUY`:

- ini adalah jumlah uang yang kamu pakai untuk membeli

Untuk `SELL`:

- ini adalah hasil penjualan kotor sebelum dipotong fee

Contoh:

- buy anchor `1.800.000`
- sell posisi `2.250.000`

Kolom ini sangat penting karena:

- menjadi dasar hitung qty PAXG
- menjadi dasar hitung running cost
- menjadi dasar hitung realized PnL

`fee_pct`

Persentase biaya transaksi.

Contoh:

- `0.003` berarti `0,3%`

Fungsi kolom ini:

- menghitung biaya beli/jual
- membuat PnL lebih realistis

Kalau fee platform relatif tetap, kamu bisa isi angka default yang sama di banyak row.

`posted_status`

Status untuk menandai apakah transaksi itu sudah pernah diposting ke thread / sosial / kanal publik.

Nilai yang dipakai:

- `DONE` = sudah diposting, jangan buat draft/post lagi
- selain `DONE` = dianggap belum diposting

Contoh:

- `DONE`
- kosong

Fungsi kolom ini:

- mencegah draft yang sama muncul berulang
- memisahkan transaksi yang sudah selesai dipublikasikan vs yang belum
- memudahkan workflow n8n untuk skip posting ulang

`note`

Catatan tambahan bebas untuk transaksi tersebut.

Contoh isi:

- `manual buy after alert`
- `TP anchor executed`
- `deep dip karena CPI drop`

Fungsi kolom ini:

- membantu review manual
- membantu audit keputusan
- berguna kalau ada kondisi khusus yang tidak tercermin di angka

Rekomendasi praktis:

- kalau tidak ada catatan khusus, boleh dikosongkan
- kalau eksekusi manual, bagus diisi alasan singkat atau konteks order

Contoh `action`:

- `BUY_ANCHOR`
- `BUY_DIP`
- `BUY_DEEP`
- `SELL_TP1`
- `SELL_TP2`

Kolom formula:

- `qty_paxg`
- `qty_gram`
- `fee_idr`
- `net_idr`
- `running_open_qty`
- `running_open_cost_idr`
- `avg_entry_idr_per_paxg`
- `realized_cost_idr`
- `realized_pnl_idr`

Penjelasan tiap kolom formula:

`qty_paxg`

Jumlah PAXG yang terbeli atau terjual dari transaksi tersebut.

Cara membacanya:

- kalau ini row `BUY`, berarti berapa PAXG yang kamu dapat
- kalau ini row `SELL`, berarti berapa PAXG yang kamu lepas

Nilai ini biasanya dihitung dari:

- `gross_idr / (price_usd_oz x usdt_idr)`

Fungsi kolom ini:

- menjadi dasar hitung posisi terbuka
- menjadi dasar hitung rata-rata harga beli
- menjadi dasar hitung realized cost saat sell

`qty_gram`

Konversi `qty_paxg` ke gram emas.

Cara hitung sederhananya:

- `qty_paxg x 31.1034768`

Fungsi kolom ini:

- membantu melihat eksposur dalam satuan gram
- lebih mudah dipahami dibanding hanya satuan PAXG

Contoh:

- `0.025 PAXG` kira-kira setara `0.7776 gram`

`fee_idr`

Biaya transaksi dalam rupiah.

Cara hitung sederhananya:

- `gross_idr x fee_pct`

Fungsi kolom ini:

- menunjukkan biaya real transaksi
- membuat net cost dan PnL lebih akurat

Contoh:

- `gross_idr = 1.800.000`
- `fee_pct = 0.003`
- maka `fee_idr = 5.400`

`net_idr`

Nilai transaksi bersih setelah memperhitungkan fee.

Cara membacanya:

- untuk `BUY`, ini adalah total biaya riil yang keluar
- untuk `SELL`, ini adalah hasil bersih yang benar-benar masuk setelah fee

Secara konsep:

- `BUY` -> `gross_idr + fee_idr`
- `SELL` -> `gross_idr - fee_idr`

Fungsi kolom ini:

- memberi angka riil uang yang keluar/masuk
- dipakai dalam cost basis dan hasil jual bersih

`running_open_qty`

Jumlah total PAXG yang masih terbuka setelah row transaksi ini diproses.

Cara membacanya:

- setiap `BUY` menambah `running_open_qty`
- setiap `SELL` mengurangi `running_open_qty`

Fungsi kolom ini:

- menunjukkan posisi aktif saat ini
- memudahkan tahu apakah masih ada posisi yang belum dijual

Contoh:

- beli `0.03 PAXG`, lalu beli lagi `0.02 PAXG` -> open qty jadi `0.05 PAXG`
- lalu jual `0.02 PAXG` -> open qty turun jadi `0.03 PAXG`

`running_open_cost_idr`

Total modal rupiah yang masih menempel pada posisi terbuka setelah transaksi ini.

Cara membacanya:

- saat `BUY`, cost posisi aktif bertambah
- saat `SELL`, sebagian cost posisi aktif dilepas

Ini bukan total uang yang pernah dikeluarkan sepanjang sejarah, tapi:

- sisa modal yang masih melekat pada aset yang belum dijual

Fungsi kolom ini:

- dasar perhitungan average entry
- dasar perhitungan unrealized PnL

`avg_entry_idr_per_paxg`

Harga rata-rata beli posisi yang masih terbuka, dalam rupiah per 1 PAXG.

Cara hitung sederhananya:

- `running_open_cost_idr / running_open_qty`

Fungsi kolom ini:

- menjadi cost basis posisi aktif
- dipakai untuk menghitung cost basis posisi aktif
- dipakai untuk menghitung realized cost saat ada sell

Ini adalah salah satu kolom paling penting karena:

- target take profit sekarang dinilai per posisi buy yang masih terbuka
- `BUY_ANCHOR` memakai `tp_anchor_pct`
- `BUY_DIP` memakai `tp_dip_pct`
- `BUY_DEEP` memakai `tp_deep_dip_pct`

`realized_cost_idr`

Bagian modal yang dianggap keluar dari posisi saat terjadi transaksi `SELL`.

Cara membacanya:

- saat kamu menjual sebagian posisi, sistem harus tahu modal berapa yang “ikut terjual”
- nilai itulah yang masuk ke `realized_cost_idr`

Kalau `BUY`, biasanya nilainya `0`.

Fungsi kolom ini:

- menjadi dasar hitung profit/loss yang benar
- mencegah salah hitung PnL hanya dari selisih harga jual vs uang masuk

`realized_pnl_idr`

Keuntungan atau kerugian yang benar-benar sudah terealisasi dari transaksi `SELL`.

Cara hitung konsepnya:

- `hasil jual bersih - modal yang ikut terjual`

Atau secara sederhana:

- `net_idr - realized_cost_idr`

Fungsi kolom ini:

- menunjukkan profit yang sudah benar-benar “jadi uang”
- berbeda dengan unrealized PnL yang masih mengambang

Cara membacanya:

- positif = untung
- negatif = rugi

Kalau `BUY`, biasanya nilainya `0` karena belum ada profit yang direalisasikan.

Penting:

- Untuk `BUY`, `gross_idr` = nominal IDR yang dipakai membeli.
- Untuk `SELL`, `gross_idr` = nominal IDR hasil penjualan sebelum fee/spread.
- Formula row `2` dan `3` sudah disiapkan.
- Setelah import, drag formula di row `3` ke bawah untuk menyiapkan banyak baris.

### 3. CYCLE_SUMMARY

Isi `cycle_id` manual, misalnya:

- `2026-04`
- `2026-05`
- `2026-06`

Sheet ini merangkum performa per siklus:

- total buy
- total sell
- qty open
- average entry
- realized PnL
- target TP per posisi

Formula row `2` bisa didrag ke bawah.

### 4. DASHBOARD

Sheet `DASHBOARD` dipakai untuk menampilkan angka ringkasan terbaru.

Isi utamanya sekarang diupdate otomatis oleh n8n, termasuk:

- `current_paxg_usd`
- `current_usdt_idr`
- total open PAXG
- total gram
- average entry
- market value
- realized PnL
- unrealized PnL
- target TP posisi anchor / dip / deep dip

Jadi pembagian perannya:

- `SETTINGS` = aturan strategi manual
- `TRADE_LOG` = ledger transaksi
- `DASHBOARD` = summary live hasil olahan workflow

### 5. TRADE_TOOLS

Sheet `TRADE_TOOLS` adalah alat bantu hitung manual untuk membantu mengisi kolom penting di `TRADE_LOG`, khususnya:

- `price_usd_oz`
- `usdt_idr`
- `fee_pct`

Sheet ini berguna kalau data dari exchange yang kamu pegang bentuknya bukan langsung field `TRADE_LOG`, tetapi bentuk transaksi real seperti:

- total rupiah yang keluar
- qty PAXG bersih yang diterima
- kurs PAXG ke IDR
- pajak / potongan dalam satuan PAXG

#### Input utama

- `gross_idr`
  Total rupiah transaksi.

- `qty_paxg_net`
  Qty PAXG bersih yang benar-benar kamu terima.

- `kurs_paxg_idr`
  Harga 1 PAXG dalam rupiah.

- `tax_paxg`
  Potongan / pajak dalam satuan PAXG.
  Di model ini, potongan PAXG tersebut kita anggap setara `fee`.

- `usdt_idr_input`
  Diisi kalau kamu tahu kurs USDT/IDR saat transaksi.

- `price_usd_oz_input`
  Diisi kalau kamu tahu harga PAXG dalam USD/oz saat transaksi.

Catatan:

- kamu tidak perlu isi `usdt_idr_input` dan `price_usd_oz_input` sekaligus
- cukup isi salah satu, lalu sheet bantu hitung yang satunya

#### Output hitung

- `gross_qty_paxg_calc`
  Perkiraan qty sebelum dipotong pajak:
  `qty_paxg_net + tax_paxg`

- `fee_pct_calc`
  Persentase fee yang diaproksimasi dari potongan PAXG:
  `tax_paxg / gross_qty_paxg_calc`

- `effective_price_idr_per_paxg_calc`
  Harga efektif per 1 PAXG berdasarkan rupiah transaksi dan qty kotor.

- `price_usd_oz_calc`
  Dipakai kalau kamu mengisi `usdt_idr_input`.
  Rumus dasarnya:
  `kurs_paxg_idr / usdt_idr_input`

- `usdt_idr_calc`
  Dipakai kalau kamu mengisi `price_usd_oz_input`.
  Rumus dasarnya:
  `kurs_paxg_idr / price_usd_oz_input`

#### Cara pakai singkat

1. Isi `gross_idr`
2. Isi `qty_paxg_net`
3. Isi `kurs_paxg_idr`
4. Isi `tax_paxg`
5. Isi salah satu:
   - `usdt_idr_input`, atau
   - `price_usd_oz_input`
6. Ambil hasil dari:
   - `fee_pct_calc`
   - `price_usd_oz_calc` atau `usdt_idr_calc`

#### Asumsi model

Sheet ini memakai asumsi:

- `qty_paxg_net` adalah qty bersih setelah potongan
- `tax_paxg` adalah potongan qty dalam PAXG
- potongan qty tersebut diperlakukan sebagai `fee`

Kalau model potongan dari exchange kamu berbeda, hasil `fee_pct_calc` perlu disesuaikan manual.

## Catatan Model

Template ini memakai model `weighted average cost` untuk cost basis dan PnL, tetapi target take profit dibaca per posisi buy.

Artinya:

- cost basis portfolio tetap dihitung gabungan
- tetapi `BUY_ANCHOR`, `BUY_DIP`, dan `BUY_DEEP` masing-masing punya target TP sendiri
- TP dan PnL dinilai dari average cost posisi terbuka
- cocok untuk automation awal dan lebih sederhana dibaca n8n

## Next Step

Setelah kamu realisasikan online, kita bisa ubah `main-logic.js` agar membaca:

- posisi terbuka dari `DASHBOARD`
- TP target dari `DASHBOARD`
- ringkasan siklus dari `CYCLE_SUMMARY`
- event transaksi dari `TRADE_LOG`

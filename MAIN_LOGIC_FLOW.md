# Main Logic Flow

Dokumen ini menjelaskan alur sistem dari awal sampai akhir untuk strategi PAXG berbasis ledger spreadsheet.

## Tujuan

`main-logic.js` sekarang tidak lagi menganggap spreadsheet sebagai snapshot bulanan tunggal.
Yang dipakai sebagai source of truth adalah:

- `SETTINGS`
- `TRADE_LOG`

Lalu dari ledger itu kita turunkan:

- posisi terbuka
- average entry
- realized PnL
- unrealized PnL
- status cycle aktif
- sinyal buy/sell
- payload log yang siap di-append ke spreadsheet

## Sheet Yang Dipakai

### `SETTINGS`

Berisi parameter strategi:

- harga referensi market jika ingin diisi manual
- budget bulanan
- persen anchor / dip / deep dip
- target TP1 / TP2
- fee
- timezone

### `TRADE_LOG`

Ini adalah ledger utama.
Satu transaksi real = satu row.

Contoh action:

- `BUY_ANCHOR`
- `BUY_DIP`
- `BUY_DEEP`
- `SELL_TP1`
- `SELL_TP2`

## Alur Data

### 1. Market Data Masuk

n8n ambil:

- harga `PAXGUSDT`
- kurs `USDTIDR`

Data ini masuk sebagai:

- `market.paxgUsd`
- `market.usdtIdr`

### 2. Spreadsheet Dibaca

n8n baca:

- sheet `SETTINGS`
- sheet `TRADE_LOG`

Keduanya dibaca dalam format GViz JSON atau format lain yang setara.

### 3. `buildTradingContext()`

Fungsi ini menggabungkan semua input menjadi konteks trading lengkap:

- config final hasil merge default + sheet + override
- cycle aktif saat ini
- semua transaksi ledger
- posisi terbuka seluruh portfolio
- PnL realized dan unrealized
- koreksi terhadap anchor
- gain terhadap average entry

### 4. `parseTradeLogSheet()`

Semua row `TRADE_LOG` dibaca berurutan.

Untuk setiap row:

- `BUY_*` menambah `runningOpenQty`
- `BUY_*` menambah `runningOpenCostIdr`
- `SELL_*` mengurangi qty open
- `SELL_*` menghitung `realizedCostIdr`
- `SELL_*` menghitung `realizedPnlIdr`

Model yang dipakai adalah `weighted average cost`.

Artinya:

- semua posisi aktif digabung
- average entry dihitung dari total cost / total qty aktif
- TP dinilai dari average posisi aktif, bukan per lot

## Cara Hitung Posisi

### Open Position

Posisi terbuka didapat dari ledger, bukan dari snapshot cycle:

- `openQtyPaxg`
- `openCostIdr`
- `avgEntryIdrPerPaxg`
- `avgEntryUsd`

### Konversi Gram

`openQtyGram = openQtyPaxg * troyOzToGram`

### Unrealized PnL

`currentMarketValueIdr = openQtyPaxg * currentPaxgUsd * currentUsdtIdr`

`unrealizedPnlIdr = currentMarketValueIdr - openCostIdr`

### Realized PnL

Setiap sell menghitung:

`realizedCostIdr = qtySell * avgEntryIdrPerPaxgBeforeSell`

`realizedPnlIdr = grossSellIdr - feeIdr - realizedCostIdr`

## Cara Hitung Cycle

Cycle aktif ditentukan dari `anchorDay`.

Jika hari ini lewat tanggal 25, cycle aktif adalah bulan berjalan.
Jika belum lewat tanggal 25, cycle aktif adalah cycle bulan sebelumnya.

Contoh:

- `2026-04-10` -> cycle `2026-03`
- `2026-04-28` -> cycle `2026-04`

Dalam cycle aktif, logic mencari apakah sudah ada:

- `BUY_ANCHOR`
- `BUY_DIP`
- `BUY_DEEP`
- `SELL_TP1`
- `SELL_TP2`

## Sinyal Yang Dihasilkan

### `ANCHOR_REMINDER`

Muncul jika:

- hari ini anchor day
- belum ada `BUY_ANCHOR` di cycle aktif

### `DIP_BUY_ALERT`

Muncul jika:

- anchor cycle aktif sudah ada
- belum ada `BUY_DIP`
- belum ada `BUY_DEEP`
- harga turun >= `dipThresholdPct`
- harga belum masuk `deepDipThresholdPct`

### `DEEP_DIP_ALERT`

Muncul jika:

- anchor cycle aktif sudah ada
- belum ada `BUY_DEEP`
- harga turun >= `deepDipThresholdPct`

### `TP1_ALERT`

Muncul jika:

- masih ada posisi terbuka
- gain terhadap average entry >= `tp1Pct`
- gain masih < `tp2Pct`
- belum ada `SELL_TP1` / `SELL_TP2` di cycle aktif

### `TP2_ALERT`

Muncul jika:

- masih ada posisi terbuka
- gain terhadap average entry >= `tp2Pct`
- belum ada `SELL_TP2` di cycle aktif

## Draft Otomatis

Setelah transaksi benar-benar tercatat di `TRADE_LOG`, logic juga bisa mengeluarkan draft:

- `DRAFT_BUY_DIP`
- `DRAFT_BUY_DEEP`
- `DRAFT_SELL_TP1`
- `DRAFT_SELL_TP2`

Draft ini muncul dari transaksi yang sudah ada di ledger, jadi tidak lagi spekulatif.

## Automate Catat Log Ke Spreadsheet

Ada dua pola yang paling aman.

### Opsi A: Semi otomatis

1. Main logic kirim alert WhatsApp.
2. Kamu eksekusi buy/sell manual di exchange.
3. Kamu balas ke bot atau trigger webhook dengan payload eksekusi:
   - `action`
   - `gross_idr`
   - `price_usd_oz`
   - `usdt_idr`
4. n8n panggil `buildTradeLogRow()`.
5. Hasil row di-append ke `TRADE_LOG`.
6. Workflow berikutnya membaca ledger yang sudah update.

Ini paling aman karena transaksi dicatat setelah benar-benar terjadi.

### Opsi B: Full auto dari exchange

1. Main logic kirim alert.
2. Workflow place order ke exchange.
3. Setelah order sukses, ambil hasil fill actual:
   - executed price
   - executed amount
   - fee
4. Map hasil fill ke `buildTradeLogRow()`.
5. Append row ke `TRADE_LOG`.

Ini paling rapi kalau nanti kamu sudah punya execution API yang stabil.

## Payload Log Yang Dihasilkan

`buildTradeLogRow()` menghasilkan object siap append, misalnya:

```js
{
  date_time: "2026-04-28 09:30:00",
  cycle_id: "2026-04",
  action: "BUY_DIP",
  price_usd_oz: 3320,
  usdt_idr: 16250,
  gross_idr: 1400000,
  fee_pct: 0.003,
  qty_paxg: 0.02598842,
  qty_gram: 0.808345,
  fee_idr: 4200,
  net_idr: 1404200,
  avg_entry_usd_at_execution: 0,
  realized_cost_idr: 0,
  realized_pnl_idr: 0,
  note: ""
}
```

Untuk sell, function yang sama juga mengisi:

- `avg_entry_usd_at_execution`
- `realized_cost_idr`
- `realized_pnl_idr`

## Struktur Workflow n8n Yang Disarankan

### Flow Monitoring

1. `Schedule Trigger`
2. `HTTP PAXG`
3. `HTTP USDTIDR`
4. `Read SETTINGS`
5. `Read TRADE_LOG`
6. `Code: runMainLogic()`
7. `IF should_alert`
8. `Send WhatsApp`

### Flow Append Trade Log

1. `Webhook` atau `Manual Trigger`
2. Input:
   - `action`
   - `gross_idr`
   - optional executed price/fill
3. `Read SETTINGS`
4. `Read TRADE_LOG`
5. `Code: buildTradingContext()`
6. `Code: buildTradeLogRow()`
7. `Google Sheets Append Row`
8. `Send Confirmation`

## Kenapa Model Ini Lebih Aman

- posisi dihitung dari ledger real, bukan asumsi snapshot
- TP dinilai dari average cost posisi aktif
- PnL realized dan unrealized selalu bisa ditelusuri
- draft hanya keluar dari transaksi yang benar-benar sudah tercatat
- append log bisa dibuat otomatis tanpa merusak perhitungan utama

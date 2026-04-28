# Spreadsheet Template

Template ini dibuat untuk dipakai sebagai source of truth trading, lalu nanti dibaca oleh `main-logic.js` / n8n.

## File

- `SETTINGS.csv`
- `TRADE_LOG.csv`
- `CYCLE_SUMMARY.csv`
- `DASHBOARD.csv`

## Struktur yang disarankan di Google Sheets

1. Buat spreadsheet baru.
2. Import masing-masing CSV sebagai sheet terpisah.
3. Rename sheet persis seperti nama file tanpa `.csv`:
   - `SETTINGS`
   - `TRADE_LOG`
   - `CYCLE_SUMMARY`
   - `DASHBOARD`

## Cara pakai

### 1. SETTINGS

Isi nilai market/config yang ingin dijadikan referensi:

- `current_paxg_usd`
- `current_usdt_idr`
- `tp1_pct`
- `tp2_pct`
- `dip_threshold_pct`
- `deep_dip_threshold_pct`
- `troy_oz_to_gram`
- `monthly_budget_idr`
- `swing_ammo_idr`

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
- `note`

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
- target TP1 / TP2

Formula row `2` bisa didrag ke bawah.

### 4. DASHBOARD

Dashboard menarik angka agregat seluruh portfolio:

- total open PAXG
- total gram
- average entry
- realized PnL
- unrealized PnL
- TP1/TP2 target dari posisi terbuka

## Catatan Model

Template ini memakai model `weighted average cost`, bukan lot-by-lot.

Artinya:

- semua posisi beli aktif digabung jadi satu average entry
- TP dan PnL dinilai dari average cost posisi terbuka
- cocok untuk automation awal dan lebih sederhana dibaca n8n

## Next Step

Setelah kamu realisasikan online, kita bisa ubah `main-logic.js` agar membaca:

- posisi terbuka dari `DASHBOARD`
- TP target dari `DASHBOARD`
- ringkasan siklus dari `CYCLE_SUMMARY`
- event transaksi dari `TRADE_LOG`

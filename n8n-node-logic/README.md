# n8n Node Logic

Folder ini sekarang khusus untuk script `Code` node n8n.

Setiap file di sini adalah versi yang bisa langsung di-copy-paste ke node terkait:

- `parse-settings.js` -> node `Parse SETTINGS`
- `parse-trade-log.js` -> node `Parse TRADE_LOG`
- `main-logic-node.js` -> node `Main Logic — Alert & Draft Thread`
- `build-dashboard-rows.js` -> node `Build Dashboard Rows`

Catatan:

- file-file ini sengaja tidak memakai `require` atau `module.exports`
- tujuannya supaya formatnya sama dengan yang dibutuhkan n8n
- source engine utamanya tetap ada di `main-logic.js`, tapi file di folder ini adalah versi tempel-ulang untuk node n8n

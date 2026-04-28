const DEFAULT_CONFIG = {
  pctAnchor: 45,
  pctDip: 35,
  pctDeepDip: 25,
  dipThreshold: 3.0,
  deepDipThreshold: 5.0,
  tp1Pct: 2.0,
  tp2Pct: 4.0,
  cooldownMinutes: 60,
  troyOzToGram: 31.1034768,
  fallbackTotalBudgetIdr: 4000000,
  fallbackSwingAmmoIdr: 10000000,
};

function runMainLogic(input) {
  const {
    market,
    sheetRawText,
    staticData = {},
    now = new Date(),
    config: configOverride = {},
  } = input;

  const config = { ...DEFAULT_CONFIG, ...configOverride };
  const ctx = buildCycleContext({ market, sheetRawText, staticData, now, config });
  const alerts = evaluateAlerts(ctx);

  if (alerts.length === 0) {
    return [{ json: { should_alert: false } }];
  }

  return alerts.map((alert) => ({
    json: {
      should_alert: true,
      alert_type: alert.type,
      alert_message: alert.message,
    },
  }));
}

function buildCycleContext({ market, sheetRawText, staticData, now, config }) {
  const nowWita = shiftToWita(now);
  const anchorTarget = getAnchorDate(nowWita);
  const gviz = parseGvizText(sheetRawText);
  const sheet = parseSheetData(gviz, anchorTarget);

  const currentPaxgUsd = Number(market?.paxgUsd);
  const usdtIdr = Number(market?.usdtIdr);
  if (Number.isNaN(currentPaxgUsd)) throw new Error("Harga PAXG tidak valid");
  if (Number.isNaN(usdtIdr)) throw new Error("Kurs USDT/IDR tidak valid");

  const safeTotalBudgetIdr = sheet.totalBudgetIdr || config.fallbackTotalBudgetIdr;
  const safeSwingAmmoIdr = sheet.swingAmmoIdr || config.fallbackSwingAmmoIdr;
  const paxgIdrPerGram = (currentPaxgUsd / config.troyOzToGram) * usdtIdr;
  const dropPct = sheet.fallbackAnchorUsd
    ? ((sheet.fallbackAnchorUsd - currentPaxgUsd) / sheet.fallbackAnchorUsd) * 100
    : null;
  const gainPct = sheet.swingEntryAvgUsd
    ? ((currentPaxgUsd - sheet.swingEntryAvgUsd) / sheet.swingEntryAvgUsd) * 100
    : null;

  return {
    config,
    market: {
      currentPaxgUsd,
      usdtIdr,
      paxgIdrPerGram,
    },
    now,
    nowMs: now.getTime(),
    nowWita,
    todayDate: nowWita.getDate(),
    timeLabel: nowWita.toLocaleString("id-ID", { timeZone: "Asia/Makassar" }),
    tanggalPanjang: nowWita.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    anchorTarget,
    anchorDateLabel: anchorTarget.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    bulanSiklus: anchorTarget.toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    }),
    sheet,
    budget: {
      totalIdr: safeTotalBudgetIdr,
      swingAmmoIdr: safeSwingAmmoIdr,
      anchorIdr: safeTotalBudgetIdr * (config.pctAnchor / 100),
      dipIdr: safeTotalBudgetIdr * (config.pctDip / 100),
      deepDipIdr: safeTotalBudgetIdr * (config.pctDeepDip / 100),
    },
    metrics: {
      dropPct,
      gainPct,
    },
    staticData,
    cooldownMs: config.cooldownMinutes * 60 * 1000,
  };
}

function evaluateAlerts(ctx) {
  const alerts = [];
  pushAnchorReminder(alerts, ctx);
  pushDipAlert(alerts, ctx);
  pushDeepDipAlert(alerts, ctx);
  pushTp1Alert(alerts, ctx);
  pushTp2Alert(alerts, ctx);
  pushDipDraft(alerts, ctx);
  pushDeepDipDraft(alerts, ctx);
  pushTp1Draft(alerts, ctx);
  pushTp2Draft(alerts, ctx);
  return alerts;
}

function pushAnchorReminder(alerts, ctx) {
  const { todayDate, sheet, nowMs, staticData } = ctx;
  if (todayDate !== 25 || sheet.anchorFilled) return;
  if ((nowMs - (staticData.lastAnchorReminder || 0)) < 60 * 60 * 1000) return;

  staticData.lastAnchorReminder = nowMs;
  alerts.push({
    type: "ANCHOR_REMINDER",
    message:
      `📌 *REMINDER - ANCHOR BUY BELUM DILAKUKAN*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 Anchor date: *${ctx.anchorDateLabel}*\n` +
      `⚠️ ANCHOR PRICE di sheet masih kosong!\n\n` +
      `${buildBudgetBlock(ctx)}` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👉 Beli anchor sekarang & isi sheet!`,
  });
}

function pushDipAlert(alerts, ctx) {
  const { dropPct } = ctx.metrics;
  const { config, nowMs, staticData, cooldownMs, sheet } = ctx;
  if (dropPct === null) return;
  if (dropPct < config.dipThreshold || dropPct >= config.deepDipThreshold) return;
  if ((nowMs - (staticData.lastDipAlert || 0)) <= cooldownMs) return;

  staticData.lastDipAlert = nowMs;
  alerts.push({
    type: "DIP_BUY",
    message:
      `⚠️ *DIP BUY ALERT (>=${config.dipThreshold}%)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📅 Anchor : ${ctx.anchorDateLabel}\n` +
      `🎯 Anchor : $${fmt(sheet.fallbackAnchorUsd)}\n` +
      `📉 Turun  : *${fmt(dropPct)}%* dari anchor\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Alokasi Dip (${config.pctDip}%): *${formatIdr(ctx.budget.dipIdr)}*\n` +
      `${buildBudgetBlock(ctx)}` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Eksekusi -> isi sheet -> draft thread otomatis terkirim`,
  });
}

function pushDeepDipAlert(alerts, ctx) {
  const { dropPct } = ctx.metrics;
  const { config, nowMs, staticData, cooldownMs, sheet } = ctx;
  if (dropPct === null || dropPct < config.deepDipThreshold) return;
  if ((nowMs - (staticData.lastDeepAlert || 0)) <= cooldownMs) return;

  staticData.lastDeepAlert = nowMs;
  alerts.push({
    type: "DEEP_DIP",
    message:
      `🚨 *DEEP DIP ALERT (>=${config.deepDipThreshold}%) - BELI SEKARANG!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📅 Anchor : ${ctx.anchorDateLabel}\n` +
      `🎯 Anchor : $${fmt(sheet.fallbackAnchorUsd)}\n` +
      `📉 Turun  : *${fmt(dropPct)}%* dari anchor\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Alokasi Deep (${config.pctDeepDip}%): *${formatIdr(ctx.budget.deepDipIdr)}*\n` +
      `${buildBudgetBlock(ctx)}` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ Eksekusi -> isi sheet -> draft thread otomatis terkirim`,
  });
}

function pushTp1Alert(alerts, ctx) {
  const { gainPct } = ctx.metrics;
  const { config, nowMs, staticData, cooldownMs, sheet, market } = ctx;
  if (gainPct === null || gainPct < config.tp1Pct || gainPct >= config.tp2Pct) return;
  if ((nowMs - (staticData.lastTP1 || 0)) <= cooldownMs) return;

  staticData.lastTP1 = nowMs;
  alerts.push({
    type: "TP1",
    message:
      `✅ *TAKE PROFIT 1 - JUAL 50% POSISI*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📈 Entry avg : $${fmt(sheet.swingEntryAvgUsd)}\n` +
      `📈 Gain      : *+${fmt(gainPct)}%* dari entry\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Jual 50% posisi sekarang\n` +
      `🎯 TP2 target: $${fmt(sheet.swingEntryAvgUsd * (1 + config.tp2Pct / 100))} (+${config.tp2Pct}%)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Eksekusi -> isi sheet -> draft thread otomatis terkirim`,
  });
}

function pushTp2Alert(alerts, ctx) {
  const { gainPct } = ctx.metrics;
  const { config, nowMs, staticData, cooldownMs, sheet } = ctx;
  if (gainPct === null || gainPct < config.tp2Pct) return;
  if ((nowMs - (staticData.lastTP2 || 0)) <= cooldownMs) return;

  staticData.lastTP2 = nowMs;
  alerts.push({
    type: "TP2",
    message:
      `🎉 *TAKE PROFIT 2 - JUAL SEMUA POSISI!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📈 Entry avg : $${fmt(sheet.swingEntryAvgUsd)}\n` +
      `📈 Gain      : *+${fmt(gainPct)}%* dari entry\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Jual SEMUA sisa posisi\n` +
      `🔄 Kosongkan SWING ENTRY AVG di sheet setelah jual\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎉 Eksekusi -> isi sheet -> draft thread otomatis terkirim`,
  });
}

function pushDipDraft(alerts, ctx) {
  const key = draftKey("draftDip", ctx.anchorTarget);
  const { sheet, staticData, market, config, tanggalPanjang } = ctx;
  if (!sheet.dipFilled || staticData[key]) return;

  staticData[key] = true;
  const actualDrop = ((sheet.fallbackAnchorUsd - sheet.dipPriceUsd) / sheet.fallbackAnchorUsd) * 100;
  const gramDip = sheet.dipDepositIdr
    ? sheet.dipDepositIdr / ((sheet.dipPriceUsd / config.troyOzToGram) * market.usdtIdr)
    : null;
  const paxgIdrDip = (sheet.dipPriceUsd / config.troyOzToGram) * market.usdtIdr;

  alerts.push({
    type: "DRAFT_DIP",
    message:
      `📝 *DRAFT THREAD - SIAP PUBLISH*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Salin teks di bawah ini ke Thread / X / sosmed:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📅 Update Investasi Emas - ${tanggalPanjang}\n\n` +
      `Hari ini saya mengeksekusi *Dip Buy* pada instrumen PAXG (PAX Gold).\n\n` +
      `Harga emas terkoreksi ${fmt(actualDrop)}% dari harga referensi anchor bulan ini ` +
      `($${fmt(sheet.fallbackAnchorUsd)}/troy oz), sehingga saya memanfaatkan momentum ini ` +
      `untuk menambah posisi sesuai strategi DCA 3-tier yang saya jalankan.\n\n` +
      `📊 Detail Transaksi:\n` +
      `• Instrumen  : PAXG (1 PAXG = 1 troy oz emas)\n` +
      `• Harga beli : $${fmt(sheet.dipPriceUsd)}/troy oz (${formatIdr(paxgIdrDip)}/gram)\n` +
      `• Deposit    : ${formatIdr(sheet.dipDepositIdr)}\n` +
      `${gramDip ? `• Estimasi   : ~${fmt(gramDip, 4)} gram emas\n` : ""}` +
      `• Koreksi    : -${fmt(actualDrop)}% dari anchor\n\n` +
      `📐 Tentang Strategi:\n` +
      `Saya menggunakan strategi DCA 3-tier untuk akumulasi emas digital (PAXG):\n` +
      `• Anchor Buy (${config.pctAnchor}%) - rutin setiap tanggal 25\n` +
      `• Dip Buy (${config.pctDip}%)    - saat harga turun >=3% dari anchor\n` +
      `• Deep Dip (${config.pctDeepDip}%)  - saat harga turun >=5% dari anchor\n\n` +
      `PAXG dipilih karena didukung emas fisik, spread hanya ~0,3%, dan dapat dikonversi ke emas batangan fisik sewaktu-waktu.\n\n` +
      `#Emas #PAXG #DipBuy #InvestasiEmas #DCA`,
  });
}

function pushDeepDipDraft(alerts, ctx) {
  const key = draftKey("draftDeep", ctx.anchorTarget);
  const { sheet, staticData, market, config, tanggalPanjang } = ctx;
  if (!sheet.deepFilled || staticData[key]) return;

  staticData[key] = true;
  const actualDrop = ((sheet.fallbackAnchorUsd - sheet.deepPriceUsd) / sheet.fallbackAnchorUsd) * 100;
  const gramDeep = sheet.deepDepositIdr
    ? sheet.deepDepositIdr / ((sheet.deepPriceUsd / config.troyOzToGram) * market.usdtIdr)
    : null;
  const paxgIdrDeep = (sheet.deepPriceUsd / config.troyOzToGram) * market.usdtIdr;

  alerts.push({
    type: "DRAFT_DEEP",
    message:
      `📝 *DRAFT THREAD - SIAP PUBLISH*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Salin teks di bawah ini ke Thread / X / sosmed:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📅 Update Investasi Emas - ${tanggalPanjang}\n\n` +
      `Hari ini saya mengeksekusi *Deep Dip Buy* pada instrumen PAXG (PAX Gold).\n\n` +
      `Koreksi harga emas mencapai ${fmt(actualDrop)}% dari anchor bulan ini ` +
      `($${fmt(sheet.fallbackAnchorUsd)}/troy oz) - ini adalah level deep dip yang saya tunggu ` +
      `untuk mengalokasikan sisa amunisi beli sesuai strategi.\n\n` +
      `📊 Detail Transaksi:\n` +
      `• Instrumen  : PAXG (1 PAXG = 1 troy oz emas)\n` +
      `• Harga beli : $${fmt(sheet.deepPriceUsd)}/troy oz (${formatIdr(paxgIdrDeep)}/gram)\n` +
      `• Deposit    : ${formatIdr(sheet.deepDepositIdr)}\n` +
      `${gramDeep ? `• Estimasi   : ~${fmt(gramDeep, 4)} gram emas\n` : ""}` +
      `• Koreksi    : -${fmt(actualDrop)}% dari anchor\n\n` +
      `📐 Tentang Strategi:\n` +
      `Strategi DCA 3-tier yang saya jalankan:\n` +
      `• Anchor Buy (${config.pctAnchor}%) - rutin setiap tanggal 25\n` +
      `• Dip Buy (${config.pctDip}%)    - harga turun >=3% dari anchor\n` +
      `• Deep Dip (${config.pctDeepDip}%)  - harga turun >=5% dari anchor\n\n` +
      `Setelah 3 tier terpenuhi, tidak ada pembelian tambahan di siklus ini. ` +
      `Posisi di-hold hingga target take profit tercapai atau siklus berikutnya dimulai.\n\n` +
      `#Emas #PAXG #DeepDip #InvestasiEmas #DCA`,
  });
}

function pushTp1Draft(alerts, ctx) {
  const key = dayScopedDraftKey("draftTP1", ctx.anchorTarget, ctx.nowMs);
  const { staticData, metrics, config, sheet, market, tanggalPanjang } = ctx;
  if (metrics.gainPct === null || metrics.gainPct < config.tp1Pct || staticData[key]) return;

  staticData[key] = true;
  const profitPct = metrics.gainPct - 0.6;
  const tp2Target = sheet.swingEntryAvgUsd * (1 + config.tp2Pct / 100);

  alerts.push({
    type: "DRAFT_TP1",
    message:
      `📝 *DRAFT THREAD - SIAP PUBLISH*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Salin teks di bawah ini ke Thread / X / sosmed:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📅 Update Investasi Emas - ${tanggalPanjang}\n\n` +
      `Hari ini saya merealisasikan *Take Profit pertama (TP1)* pada posisi swing PAXG saya.\n\n` +
      `Harga telah naik +${fmt(metrics.gainPct)}% dari rata-rata harga beli saya ` +
      `($${fmt(sheet.swingEntryAvgUsd)}/troy oz), sehingga saya memutuskan untuk menjual 50% posisi ` +
      `di harga $${fmt(market.currentPaxgUsd)}/troy oz sesuai rencana awal.\n\n` +
      `📊 Detail:\n` +
      `• Entry avg  : $${fmt(sheet.swingEntryAvgUsd)}/troy oz\n` +
      `• Harga TP1  : $${fmt(market.currentPaxgUsd)}/troy oz\n` +
      `• Gain gross : +${fmt(metrics.gainPct)}%\n` +
      `• Net profit : ~+${fmt(profitPct)}% (setelah spread ~0,3% x 2)\n` +
      `• Aksi       : Jual 50% posisi ✅\n` +
      `• Sisa hold  : 50% menunggu TP2\n\n` +
      `🎯 Target TP2: $${fmt(tp2Target)}/troy oz (+${config.tp2Pct}% dari entry)\n\n` +
      `📐 Strategi ini adalah bagian dari *Swing PAXG dengan Floor Fisik* - ` +
      `trading di atas 40 gram emas fisik yang tidak saya sentuh, ` +
      `menggunakan amunisi terpisah yang berputar setiap siklus.\n\n` +
      `#Emas #PAXG #TakeProfit #SwingTrading #InvestasiEmas`,
  });
}

function pushTp2Draft(alerts, ctx) {
  const key = dayScopedDraftKey("draftTP2", ctx.anchorTarget, ctx.nowMs);
  const { staticData, metrics, config, sheet, market, tanggalPanjang } = ctx;
  if (metrics.gainPct === null || metrics.gainPct < config.tp2Pct || staticData[key]) return;

  staticData[key] = true;
  const profitPct = metrics.gainPct - 0.6;

  alerts.push({
    type: "DRAFT_TP2",
    message:
      `📝 *DRAFT THREAD - SIAP PUBLISH*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Salin teks di bawah ini ke Thread / X / sosmed:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📅 Update Investasi Emas - ${tanggalPanjang}\n\n` +
      `Hari ini satu siklus swing PAXG saya selesai dengan merealisasikan *Take Profit kedua (TP2)* - full exit dari posisi.\n\n` +
      `Harga mencapai +${fmt(metrics.gainPct)}% dari rata-rata entry saya ` +
      `($${fmt(sheet.swingEntryAvgUsd)}/troy oz), melebihi target TP2 yang sudah saya tetapkan sejak awal. ` +
      `Seluruh sisa posisi dijual di $${fmt(market.currentPaxgUsd)}/troy oz.\n\n` +
      `📊 Ringkasan Siklus:\n` +
      `• Entry avg  : $${fmt(sheet.swingEntryAvgUsd)}/troy oz\n` +
      `• Harga TP2  : $${fmt(market.currentPaxgUsd)}/troy oz\n` +
      `• Gain gross : +${fmt(metrics.gainPct)}%\n` +
      `• Net profit : ~+${fmt(profitPct)}% (setelah spread ~0,3% x 2)\n` +
      `• Status     : Full exit ✅ Siklus selesai\n\n` +
      `🔄 Amunisi swing direset untuk siklus berikutnya.\n` +
      `🪨 Floor 40 gram emas fisik tetap utuh - tidak disentuh sepanjang siklus.\n\n` +
      `📐 Prinsip strategi ini sederhana:\n` +
      `Beli saat koreksi, realisasi profit secara bertahap, dan selalu ada ` +
      `aset fisik sebagai "lantai" yang tidak dijual dalam kondisi apapun.\n\n` +
      `#Emas #PAXG #TakeProfit #SwingTrading #InvestasiEmas #FullExit`,
  });
}

function parseSheetData(gviz, anchorTarget) {
  const cols = gviz.table.cols.map((col) => String(col.label || "").trim());
  const rows = gviz.table.rows || [];

  const column = {
    anchorDate: cols.indexOf("ANCHOR DATE"),
    anchorPrice: cols.indexOf("ANCHOR PRICE"),
    anchorDeposit: cols.indexOf("ANCHOR DEPOSIT"),
    dipDate: cols.indexOf("DIP BUY DATE"),
    dipPrice: cols.indexOf("DIP BUY PRICE"),
    dipDeposit: cols.indexOf("DIP BUY DEPOSIT"),
    deepDate: cols.indexOf("DEEP DIP DATE"),
    deepPrice: cols.indexOf("DEEP DIP PRICE"),
    deepDeposit: cols.indexOf("DEEP DIP DEPOSIT"),
    totalDeposit: cols.indexOf("TOTAL DEPOSIT"),
    totalBudget: cols.indexOf("TOTAL BUDGET"),
    swingEntryAvg: cols.indexOf("SWING ENTRY AVG"),
    swingAmmo: cols.indexOf("SWING AMMO IDR"),
  };

  if (column.anchorDate < 0 || column.anchorPrice < 0) {
    throw new Error("Kolom ANCHOR DATE / ANCHOR PRICE tidak ditemukan.");
  }

  let anchorPriceUsd = null;
  let anchorDepositIdr = null;
  let dipPriceUsd = null;
  let dipDepositIdr = null;
  let deepPriceUsd = null;
  let deepDepositIdr = null;
  let totalBudgetIdr = null;
  let totalDepositIdr = null;
  let swingEntryAvgUsd = null;
  let swingAmmoIdr = null;
  let anchorFilled = false;
  let dipFilled = false;
  let deepFilled = false;

  for (const row of rows) {
    const rowDate = parseGSheetDate(getCellValue(row, column.anchorDate));
    if (!rowDate) continue;

    if (
      rowDate.getFullYear() === anchorTarget.getFullYear() &&
      rowDate.getMonth() === anchorTarget.getMonth() &&
      rowDate.getDate() === anchorTarget.getDate()
    ) {
      anchorPriceUsd = toNullableNumber(getCellValue(row, column.anchorPrice));
      anchorDepositIdr = toNullableNumber(getCellValue(row, column.anchorDeposit));
      dipPriceUsd = toNullableNumber(getCellValue(row, column.dipPrice));
      dipDepositIdr = toNullableNumber(getCellValue(row, column.dipDeposit));
      deepPriceUsd = toNullableNumber(getCellValue(row, column.deepPrice));
      deepDepositIdr = toNullableNumber(getCellValue(row, column.deepDeposit));
      totalBudgetIdr = toNullableNumber(getCellValue(row, column.totalBudget));
      totalDepositIdr = toNullableNumber(getCellValue(row, column.totalDeposit));
      swingEntryAvgUsd = toNullableNumber(getCellValue(row, column.swingEntryAvg));
      swingAmmoIdr = toNullableNumber(getCellValue(row, column.swingAmmo));
      anchorFilled = !!(anchorPriceUsd && anchorPriceUsd > 0);
      dipFilled = !!(dipPriceUsd && dipPriceUsd > 0);
      deepFilled = !!(deepPriceUsd && deepPriceUsd > 0);
      break;
    }
  }

  let fallbackAnchorUsd = anchorPriceUsd;
  if (!fallbackAnchorUsd) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const value = toNullableNumber(getCellValue(rows[i], column.anchorPrice));
      if (value && value > 0) {
        fallbackAnchorUsd = value;
        break;
      }
    }
  }

  return {
    rows,
    cols,
    anchorPriceUsd,
    anchorDepositIdr,
    dipPriceUsd,
    dipDepositIdr,
    deepPriceUsd,
    deepDepositIdr,
    totalBudgetIdr,
    totalDepositIdr,
    swingEntryAvgUsd,
    swingAmmoIdr,
    anchorFilled,
    dipFilled,
    deepFilled,
    fallbackAnchorUsd,
  };
}

function parseGvizText(rawText) {
  const jsonText = String(rawText)
    .replace(/^[^\(]+\(/, "")
    .replace(/\);?\s*$/, "");
  return JSON.parse(jsonText);
}

function getAnchorDate(nowWita) {
  const todayDate = nowWita.getDate();
  const todayMonth = nowWita.getMonth();
  const todayYear = nowWita.getFullYear();

  let anchorMonth;
  let anchorYear;

  if (todayDate <= 25) {
    if (todayMonth === 0) {
      anchorMonth = 11;
      anchorYear = todayYear - 1;
    } else {
      anchorMonth = todayMonth - 1;
      anchorYear = todayYear;
    }
  } else {
    anchorMonth = todayMonth;
    anchorYear = todayYear;
  }

  return new Date(anchorYear, anchorMonth, 25);
}

function buildHeaderPrice(ctx) {
  return (
    `🕐 ${ctx.timeLabel} WITA\n` +
    `💹 PAXG : $${fmt(ctx.market.currentPaxgUsd)} / troy oz\n` +
    `💱 Kurs : ${formatIdr(ctx.market.usdtIdr)} / USDT\n` +
    `💵 /gram: ${formatIdr(ctx.market.paxgIdrPerGram)}\n`
  );
}

function buildBudgetBlock(ctx) {
  return (
    `📊 Budget ${ctx.bulanSiklus}: ${formatIdr(ctx.budget.totalIdr)}\n` +
    `   Anchor  (${ctx.config.pctAnchor}%): ${formatIdr(ctx.budget.anchorIdr)}\n` +
    `   Dip     (${ctx.config.pctDip}%): ${formatIdr(ctx.budget.dipIdr)}\n` +
    `   Deep    (${ctx.config.pctDeepDip}%): ${formatIdr(ctx.budget.deepDipIdr)}\n`
  );
}

function getCellValue(row, colIdx) {
  if (colIdx < 0) return null;
  const cell = row?.c?.[colIdx];
  return cell && cell.v !== null && cell.v !== undefined ? cell.v : null;
}

function parseGSheetDate(raw) {
  if (!raw) return null;

  if (typeof raw === "string" && raw.startsWith("Date(")) {
    const parts = raw
      .replace("Date(", "")
      .replace(")", "")
      .split(",")
      .map(Number);
    return new Date(parts[0], parts[1], parts[2]);
  }

  if (typeof raw === "string" && raw.includes("/")) {
    const [day, month, year] = raw.split("/").map(Number);
    return new Date(year, month - 1, day);
  }

  if (typeof raw === "number") {
    return new Date((raw - 25569) * 86400 * 1000);
  }

  return null;
}

function shiftToWita(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000);
}

function draftKey(prefix, anchorTarget) {
  return `${prefix}_${anchorTarget.getFullYear()}_${anchorTarget.getMonth()}`;
}

function dayScopedDraftKey(prefix, anchorTarget, nowMs) {
  const dayIndex = Math.floor(nowMs / (24 * 60 * 60 * 1000));
  return `${prefix}_${anchorTarget.getFullYear()}_${anchorTarget.getMonth()}_${dayIndex}`;
}

function toNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num !== 0 ? num : null;
}

function formatIdr(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function fmt(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

module.exports = {
  DEFAULT_CONFIG,
  runMainLogic,
  buildCycleContext,
  evaluateAlerts,
};

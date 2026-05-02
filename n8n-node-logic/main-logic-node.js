const DEFAULT_CONFIG = {
  anchorDay: 25,
  pctAnchor: 45,
  pctDip: 35,
  pctDeepDip: 25,
  dipThresholdPct: 3.0,
  deepDipThresholdPct: 5.0,
  tpAnchorPct: 2.0,
  tpDipPct: 3.0,
  tpDeepDipPct: 5.0,
  tp1SellFraction: 0.5,
  feePct: 0.003,
  cooldownMinutes: 60,
  troyOzToGram: 31.1034768,
  monthlyBudgetIdr: 4000000,
  swingAmmoIdr: 10000000,
  timezone: "Asia/Makassar",
};

const BUY_ACTIONS = new Set(["BUY_ANCHOR", "BUY_DIP", "BUY_DEEP"]);
const SELL_ACTIONS = new Set(["SELL_TP1", "SELL_TP2", "SELL_MANUAL"]);

function runMainLogic(input) {
  const {
    market = {},
    settingsRawText,
    tradeLogRawText,
    settingsData,
    tradeLogRows,
    staticData = {},
    now = new Date(),
    config: configOverride = {},
  } = input || {};

  const ctx = buildTradingContext({
    market,
    settingsRawText,
    tradeLogRawText,
    settingsData,
    tradeLogRows,
    staticData,
    now,
    configOverride,
  });

  const signals = evaluateSignals(ctx);
  const drafts = buildDrafts(ctx);
  const events = [...signals, ...drafts];

  if (events.length === 0) {
    return [
      {
        json: {
          should_alert: false,
          cycle_id: ctx.cycle.id,
          market: buildMarketPayload(ctx),
          portfolio: buildPortfolioPayload(ctx),
          dashboard_metrics: buildDashboardMetrics(ctx),
        },
      },
    ];
  }

  return events.map((event) => ({
    json: {
      should_alert: true,
      alert_type: event.type,
      alert_message: event.message,
      severity: event.severity,
      cycle_id: ctx.cycle.id,
      event_key: event.key,
      action_code: event.actionCode || null,
      requires_execution: Boolean(event.executionPlan),
      execution_plan: event.executionPlan || null,
      draft_payload: event.draftPayload || null,
      market: buildMarketPayload(ctx),
      portfolio: buildPortfolioPayload(ctx),
      pnl: buildPnlPayload(ctx),
      dashboard_metrics: buildDashboardMetrics(ctx),
    },
  }));
}

function buildTradingContext({
  market,
  settingsRawText,
  tradeLogRawText,
  settingsData,
  tradeLogRows,
  staticData,
  now,
  configOverride,
}) {
  const settings = settingsData || parseSettingsSheet(settingsRawText);
  const config = mergeConfig(DEFAULT_CONFIG, settings, configOverride);
  const nowWita = toTimezoneDate(now, config.timezone);
  const cycleDate = getCycleDate(nowWita, config.anchorDay);
  const cycleId = formatCycleId(cycleDate);
  const trades = parseTradeLogSheet(tradeLogRows || tradeLogRawText, config);
  const portfolio = summarizePortfolio(trades, config);
  const cycle = summarizeCycle({
    trades,
    cycleId,
    config,
    nowWita,
    currentPaxgUsd: toNumberOrNull(market.paxgUsd),
    currentUsdtIdr: toNumberOrNull(market.usdtIdr),
  });

  const currentPaxgUsd = toRequiredNumber(
    market.paxgUsd,
    "Harga PAXG tidak valid"
  );
  const currentUsdtIdr = toRequiredNumber(
    market.usdtIdr,
    "Kurs USDT/IDR tidak valid"
  );
  const currentIdrPerPaxg = currentPaxgUsd * currentUsdtIdr;
  const currentIdrPerGram = currentIdrPerPaxg / config.troyOzToGram;
  const currentMarketValueIdr = portfolio.openQtyPaxg * currentIdrPerPaxg;
  const unrealizedPnlIdr = currentMarketValueIdr - portfolio.openCostIdr;
  const gainPct = portfolio.avgEntryUsd
    ? ((currentPaxgUsd - portfolio.avgEntryUsd) / portfolio.avgEntryUsd) * 100
    : null;
  const dropPct = cycle.anchorPriceUsd
    ? ((cycle.anchorPriceUsd - currentPaxgUsd) / cycle.anchorPriceUsd) * 100
    : null;

  return {
    config,
    settings,
    staticData,
    now,
    nowWita,
    nowMs: now.getTime(),
    cycle,
    market: {
      currentPaxgUsd,
      currentUsdtIdr,
      currentIdrPerPaxg,
      currentIdrPerGram,
    },
    portfolio: {
      ...portfolio,
      currentMarketValueIdr,
      unrealizedPnlIdr,
      gainPct,
    },
    metrics: {
      dropPct,
      gainPct,
    },
    labels: {
      time: nowWita.toLocaleString("id-ID", { timeZone: config.timezone }),
      dateLong: nowWita.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      cycleDate: cycleDate.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      cycleMonth: cycleDate.toLocaleDateString("id-ID", {
        month: "long",
        year: "numeric",
      }),
    },
  };
}

function evaluateSignals(ctx) {
  const signals = [];
  maybePushAnchorReminder(signals, ctx);
  maybePushDipSignal(signals, ctx);
  maybePushDeepDipSignal(signals, ctx);
  maybePushPositionTpSignals(signals, ctx);
  return signals;
}

function buildDrafts(ctx) {
  const drafts = [];
  maybePushBuyDraft(drafts, ctx, "BUY_DIP");
  maybePushBuyDraft(drafts, ctx, "BUY_DEEP");
  maybePushSellDraft(drafts, ctx, "SELL_TP1");
  maybePushSellDraft(drafts, ctx, "SELL_TP2");
  return drafts;
}

function maybePushAnchorReminder(signals, ctx) {
  const { cycle, nowWita, staticData, nowMs, config } = ctx;
  if (nowWita.getDate() !== config.anchorDay) return;
  if (cycle.hasAnchorBuy) return;
  if (!isCooldownPassed(staticData.lastAnchorReminderAt, nowMs, 60 * 60 * 1000)) return;

  staticData.lastAnchorReminderAt = nowMs;
  signals.push({
    key: `anchor_reminder_${cycle.id}`,
    type: "ANCHOR_REMINDER",
    severity: "info",
    actionCode: "BUY_ANCHOR",
    executionPlan: buildExecutionPlan(ctx, "BUY_ANCHOR"),
    message:
      `📌 *REMINDER ANCHOR BUY*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📅 Siklus : ${cycle.id}\n` +
      `📆 Anchor : ${ctx.labels.cycleDate}\n` +
      `⚠️ Belum ada transaksi BUY_ANCHOR di ledger.\n` +
      `💰 Budget anchor: ${formatIdr(cycle.budgetAnchorIdr)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Setelah beli, append 1 row ke TRADE_LOG dengan action BUY_ANCHOR.`,
  });
}

function maybePushDipSignal(signals, ctx) {
  const { cycle, metrics, staticData, nowMs, config } = ctx;
  if (!cycle.hasAnchorBuy) return;
  if (cycle.hasDipBuy || cycle.hasDeepBuy) return;
  if (metrics.dropPct === null) return;
  if (metrics.dropPct < config.dipThresholdPct || metrics.dropPct >= config.deepDipThresholdPct) return;

  const key = `signal_dip_${cycle.id}`;
  if (!isCooldownPassed(staticData[key], nowMs, config.cooldownMinutes * 60 * 1000)) return;

  staticData[key] = nowMs;
  signals.push({
    key,
    type: "DIP_BUY_ALERT",
    severity: "warning",
    actionCode: "BUY_DIP",
    executionPlan: buildExecutionPlan(ctx, "BUY_DIP"),
    message:
      `⚠️ *DIP BUY ALERT*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📅 Siklus : ${cycle.id}\n` +
      `🎯 Anchor : $${fmt(cycle.anchorPriceUsd)} / oz\n` +
      `📉 Koreksi: ${fmt(metrics.dropPct)}%\n` +
      `💰 Budget dip: ${formatIdr(cycle.budgetDipIdr)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Belum ada BUY_DIP di cycle ini. Jika dieksekusi, append row BUY_DIP ke TRADE_LOG.`,
  });
}

function maybePushDeepDipSignal(signals, ctx) {
  const { cycle, metrics, staticData, nowMs, config } = ctx;
  if (!cycle.hasAnchorBuy) return;
  if (cycle.hasDeepBuy) return;
  if (metrics.dropPct === null || metrics.dropPct < config.deepDipThresholdPct) return;

  const key = `signal_deep_${cycle.id}`;
  if (!isCooldownPassed(staticData[key], nowMs, config.cooldownMinutes * 60 * 1000)) return;

  staticData[key] = nowMs;
  signals.push({
    key,
    type: "DEEP_DIP_ALERT",
    severity: "critical",
    actionCode: "BUY_DEEP",
    executionPlan: buildExecutionPlan(ctx, "BUY_DEEP"),
    message:
      `🚨 *DEEP DIP ALERT*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${buildHeaderPrice(ctx)}` +
      `📅 Siklus : ${cycle.id}\n` +
      `🎯 Anchor : $${fmt(cycle.anchorPriceUsd)} / oz\n` +
      `📉 Koreksi: ${fmt(metrics.dropPct)}%\n` +
      `💰 Budget deep dip: ${formatIdr(cycle.budgetDeepDipIdr)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Belum ada BUY_DEEP di cycle ini. Jika dieksekusi, append row BUY_DEEP ke TRADE_LOG.`,
  });
}

function maybePushPositionTpSignals(signals, ctx) {
  const { openLots = [] } = ctx.portfolio;
  const { staticData, nowMs, market } = ctx;

  for (const lot of openLots) {
    if (!lot.remainingQtyPaxg || lot.remainingQtyPaxg <= 0) continue;

    const tpConfig = getTpConfigForLot(ctx.config, lot.action);
    if (!tpConfig) continue;

    const gainPct = ((market.currentPaxgUsd - lot.priceUsdOz) / lot.priceUsdOz) * 100;
    if (gainPct < tpConfig.targetPct) continue;

    const key = `signal_${tpConfig.signalKey}_${lot.id}`;
    if (!isCooldownPassed(staticData[key], nowMs, ctx.config.cooldownMinutes * 60 * 1000)) continue;

    staticData[key] = nowMs;
    signals.push({
      key,
      type: tpConfig.alertType,
      severity: "success",
      actionCode: "SELL_MANUAL",
      executionPlan: buildExecutionPlan(ctx, "SELL_MANUAL", { lot, tpConfig }),
      message:
        `${tpConfig.emoji} *${tpConfig.title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${buildHeaderPrice(ctx)}` +
        `📦 Posisi   : ${tpConfig.positionLabel}\n` +
        `📈 Entry    : $${fmt(lot.priceUsdOz)} / oz\n` +
        `📈 Target   : +${fmt(tpConfig.targetPct, 0)}%\n` +
        `📈 Gain now : +${fmt(gainPct)}%\n` +
        `🪙 Qty open : ${fmt(lot.remainingQtyPaxg, 6)} PAXG\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Jika dieksekusi, catat sell posisi ini ke TRADE_LOG.`,
    });
  }
}

function maybePushBuyDraft(drafts, ctx, actionCode) {
  const trade = findLatestTrade(ctx.cycle.trades, actionCode);
  if (!trade) return;
  if (isPostedDone(trade.postedStatus)) return;

  const key = `draft_${actionCode}_${trade.id}`;
  if (ctx.staticData[key]) return;
  ctx.staticData[key] = true;

  const title = actionCode === "BUY_DIP" ? "Dip Buy" : "Deep Dip Buy";
  const dropPct = ctx.cycle.anchorPriceUsd
    ? ((ctx.cycle.anchorPriceUsd - trade.priceUsdOz) / ctx.cycle.anchorPriceUsd) * 100
    : null;

  drafts.push({
    key,
    type: `DRAFT_${actionCode}`,
    severity: "info",
    draftPayload: {
      source_action: actionCode,
      trade_id: trade.id,
      cycle_id: trade.cycleId,
    },
    message:
      `📝 *DRAFT THREAD - ${title.toUpperCase()}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 ${ctx.labels.dateLong}\n\n` +
      `Hari ini saya mengeksekusi *${title}* pada PAXG.\n\n` +
      `• Harga beli: $${fmt(trade.priceUsdOz)} / oz\n` +
      `• Nilai beli: ${formatIdr(trade.grossIdr)}\n` +
      `• Qty      : ${fmt(trade.qtyPaxg, 6)} PAXG\n` +
      `${dropPct === null ? "" : `• Koreksi  : -${fmt(dropPct)}% dari anchor\n`}` +
      `• Gram     : ~${fmt(trade.qtyGram, 4)} gram\n\n` +
      `#PAXG #Emas #DCA`,
  });
}

function maybePushSellDraft(drafts, ctx, actionCode) {
  const trade = findLatestTrade(ctx.cycle.trades, actionCode);
  if (!trade) return;
  if (isPostedDone(trade.postedStatus)) return;

  const key = `draft_${actionCode}_${trade.id}`;
  if (ctx.staticData[key]) return;
  ctx.staticData[key] = true;

  const title = actionCode === "SELL_TP1" ? "Take Profit 1" : "Take Profit 2";
  const realizedPct = trade.avgEntryUsdAtExecution
    ? ((trade.priceUsdOz - trade.avgEntryUsdAtExecution) / trade.avgEntryUsdAtExecution) * 100
    : null;

  drafts.push({
    key,
    type: `DRAFT_${actionCode}`,
    severity: "info",
    draftPayload: {
      source_action: actionCode,
      trade_id: trade.id,
      cycle_id: trade.cycleId,
    },
    message:
      `📝 *DRAFT THREAD - ${title.toUpperCase()}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 ${ctx.labels.dateLong}\n\n` +
      `Hari ini saya mengeksekusi *${title}* pada posisi PAXG saya.\n\n` +
      `• Harga jual : $${fmt(trade.priceUsdOz)} / oz\n` +
      `• Nilai jual : ${formatIdr(trade.grossIdr)}\n` +
      `• Qty jual   : ${fmt(trade.qtyPaxg, 6)} PAXG\n` +
      `${realizedPct === null ? "" : `• Gain      : +${fmt(realizedPct)}%\n`}` +
      `• Realized PnL: ${formatIdr(trade.realizedPnlIdr || 0)}\n\n` +
      `#PAXG #Emas #TakeProfit`,
  });
}

function buildExecutionPlan(ctx, actionCode, options = {}) {
  const amountIdr = getSuggestedGrossIdr(ctx, actionCode, options);
  const qtyPaxg = getSuggestedQtyPaxg(ctx, actionCode, options);
  const qtyFraction = getSuggestedSellFraction(ctx, actionCode, options);
  const note = options.tpConfig && options.lot
    ? `${options.tpConfig.positionLabel} TP +${fmt(options.tpConfig.targetPct, 0)}%`
    : "";

  return {
    action: actionCode,
    cycle_id: ctx.cycle.id,
    suggested_gross_idr: amountIdr,
    suggested_qty_paxg: qtyPaxg,
    suggested_qty_gram: qtyPaxg === null ? null : qtyPaxg * ctx.config.troyOzToGram,
    suggested_sell_fraction: qtyFraction,
    log_row_preview: buildTradeLogRow({
      action: actionCode,
      cycleId: ctx.cycle.id,
      priceUsdOz: ctx.market.currentPaxgUsd,
      usdtIdr: ctx.market.currentUsdtIdr,
      grossIdr: amountIdr,
      feePct: ctx.config.feePct,
      now: ctx.nowWita,
      portfolio: ctx.portfolio,
      config: ctx.config,
      note,
    }),
  };
}

function buildTradeLogRow(input) {
  const {
    action,
    cycleId,
    priceUsdOz,
    usdtIdr,
    grossIdr,
    feePct = DEFAULT_CONFIG.feePct,
    now = new Date(),
    portfolio = {},
    config = DEFAULT_CONFIG,
    note = "",
  } = input;

  const qtyPaxg = estimateQtyPaxg(grossIdr, priceUsdOz, usdtIdr);
  const qtyGram = qtyPaxg === null ? null : qtyPaxg * config.troyOzToGram;
  const avgEntryUsdAtExecution = toNumberOrNull(portfolio.avgEntryUsd);
  const realizedCostIdr = SELL_ACTIONS.has(action) && qtyPaxg !== null && portfolio.avgEntryIdrPerPaxg
    ? qtyPaxg * portfolio.avgEntryIdrPerPaxg
    : 0;
  const feeIdr = grossIdr ? grossIdr * feePct : 0;
  // For BUY, gross_idr is the actual cash outflow. Fee is reflected by lower qty received.
  const netIdr = BUY_ACTIONS.has(action) ? grossIdr : grossIdr - feeIdr;
  const realizedPnlIdr = SELL_ACTIONS.has(action) ? grossIdr - feeIdr - realizedCostIdr : 0;

  return {
    date_time: formatDateTime(now),
    cycle_id: cycleId,
    action,
    price_usd_oz: roundNumber(priceUsdOz, 2),
    usdt_idr: roundNumber(usdtIdr, 2),
    gross_idr: roundNumber(grossIdr, 0),
    fee_pct: roundNumber(feePct, 6),
    qty_paxg: roundNumber(qtyPaxg, 8),
    qty_gram: roundNumber(qtyGram, 6),
    fee_idr: roundNumber(feeIdr, 0),
    net_idr: roundNumber(netIdr, 0),
    avg_entry_usd_at_execution: roundNumber(avgEntryUsdAtExecution, 2),
    realized_cost_idr: roundNumber(realizedCostIdr, 0),
    realized_pnl_idr: roundNumber(realizedPnlIdr, 0),
    posted_status: "",
    note,
  };
}

function parseSettingsSheet(rawText) {
  const rows = Array.isArray(rawText) ? rawText : parseSheetRows(rawText);
  const result = {};

  for (const row of rows) {
    const key = row.key;
    const value = row.value;
    if (!key) continue;
    result[String(key).trim()] = value;
  }

  return result;
}

function parseTradeLogSheet(rawText, config) {
  const rows = Array.isArray(rawText) ? rawText : parseSheetRows(rawText);
  if (!rows.length) return [];
  const trades = [];
  let runningQty = 0;
  let runningCost = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const action = getStringValue(row.action);
    if (!action) continue;

    const grossIdr = toRequiredNumber(row.gross_idr, `gross_idr kosong di row ${i + 2}`);
    const priceUsdOz = toRequiredNumber(row.price_usd_oz, `price_usd_oz kosong di row ${i + 2}`);
    const usdtIdr = toRequiredNumber(row.usdt_idr, `usdt_idr kosong di row ${i + 2}`);
    const feePct = toNumberOrDefault(row.fee_pct, config.feePct);
    const qtyPaxg = toNumberOrDefault(
      row.qty_paxg,
      estimateQtyPaxg(grossIdr, priceUsdOz, usdtIdr)
    );
    const qtyGram = qtyPaxg * config.troyOzToGram;
    const feeIdr = grossIdr * feePct;
    const rowNetIdr = toNumberOrNull(row.net_idr);
    const netIdr = BUY_ACTIONS.has(action)
      ? grossIdr
      : rowNetIdr !== null
        ? rowNetIdr
        : grossIdr - feeIdr;
    const avgEntryIdrPerPaxgBefore = runningQty > 0 ? runningCost / runningQty : 0;
    const avgEntryUsdAtExecution = avgEntryIdrPerPaxgBefore > 0
      ? avgEntryIdrPerPaxgBefore / usdtIdr
      : null;

    let realizedCostIdr = 0;
    let realizedPnlIdr = 0;
    if (SELL_ACTIONS.has(action)) {
      realizedCostIdr = qtyPaxg * avgEntryIdrPerPaxgBefore;
      realizedPnlIdr = grossIdr - feeIdr - realizedCostIdr;
      runningQty -= qtyPaxg;
      runningCost -= realizedCostIdr;
    } else if (BUY_ACTIONS.has(action)) {
      runningQty += qtyPaxg;
      runningCost += netIdr;
    }

    if (runningQty < 0.00000001) runningQty = 0;
    if (runningCost < 0.5) runningCost = 0;

    trades.push({
      id: i + 2,
      dateTime: parseTradeDateTime(row.date_time),
      cycleId: normalizeCycleIdValue(row.cycle_id),
      action,
      priceUsdOz,
      usdtIdr,
      grossIdr,
      feePct,
      qtyPaxg,
      qtyGram,
      feeIdr,
      netIdr,
      avgEntryUsdAtExecution,
      realizedCostIdr,
      realizedPnlIdr,
      postedStatus: getStringValue(row.posted_status),
      note: getStringValue(row.note),
      runningOpenQty: runningQty,
      runningOpenCostIdr: runningCost,
    });
  }

  return trades;
}

function parseSheetRows(rawText) {
  if (!rawText) return [];
  const table = parseGvizText(rawText).table || {};
  const cols = table.cols || [];
  const rows = table.rows || [];
  if (!rows.length) return [];

  const headerRow = rows[0];
  const colHeaders = cols.map((col) => toSnakeCase(col?.label));
  const hasColHeaders = colHeaders.some((header) => header);
  const rowHeaders = [];

  for (let i = 0; i < (headerRow?.c || []).length; i += 1) {
    rowHeaders.push(toSnakeCase(getCellValue(headerRow, i)));
  }

  const headers = hasColHeaders ? colHeaders : rowHeaders;
  const dataRows = hasColHeaders ? rows : rows.slice(1);

  const output = [];
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx += 1) {
    const row = dataRows[rowIdx];
    const item = {};

    for (let colIdx = 0; colIdx < headers.length; colIdx += 1) {
      const header = headers[colIdx];
      if (!header) continue;
      item[header] = getCellValue(row, colIdx);
    }

    if (Object.values(item).some((value) => value !== null && value !== "")) {
      output.push(item);
    }
  }

  return output;
}

function summarizePortfolio(trades, config) {
  const lastTrade = trades[trades.length - 1] || null;
  const openQtyPaxg = lastTrade ? lastTrade.runningOpenQty : 0;
  const openCostIdr = lastTrade ? lastTrade.runningOpenCostIdr : 0;
  const avgEntryIdrPerPaxg = openQtyPaxg > 0 ? openCostIdr / openQtyPaxg : null;
  const latestUsdtIdr = lastTrade ? lastTrade.usdtIdr : null;
  const avgEntryUsd = avgEntryIdrPerPaxg && latestUsdtIdr
    ? avgEntryIdrPerPaxg / latestUsdtIdr
    : null;
  const openLots = buildOpenLots(trades, config);

  return {
    totalTrades: trades.length,
    openQtyPaxg,
    openQtyGram: openQtyPaxg * config.troyOzToGram,
    openCostIdr,
    avgEntryIdrPerPaxg,
    avgEntryUsd,
    openLots,
    realizedPnlIdr: sumBy(trades, "realizedPnlIdr"),
    totalBuyIdr: sumWhere(trades, (trade) => BUY_ACTIONS.has(trade.action), "grossIdr"),
    totalSellIdr: sumWhere(trades, (trade) => SELL_ACTIONS.has(trade.action), "grossIdr"),
  };
}

function buildOpenLots(trades, config) {
  const lots = [];

  for (const trade of trades) {
    if (BUY_ACTIONS.has(trade.action)) {
      lots.push({
        id: `${trade.action}_${trade.id}`,
        tradeId: trade.id,
        action: trade.action,
        cycleId: trade.cycleId,
        priceUsdOz: trade.priceUsdOz,
        usdtIdr: trade.usdtIdr,
        qtyPaxg: trade.qtyPaxg,
        qtyGram: trade.qtyGram,
        remainingQtyPaxg: trade.qtyPaxg,
        remainingQtyGram: trade.qtyGram,
        netIdr: trade.netIdr,
        dateTime: trade.dateTime,
      });
      continue;
    }

    if (!SELL_ACTIONS.has(trade.action)) continue;

    let remainingSellQty = trade.qtyPaxg;
    for (const lot of lots) {
      if (remainingSellQty <= 0) break;
      if (lot.remainingQtyPaxg <= 0) continue;

      const reducedQty = Math.min(lot.remainingQtyPaxg, remainingSellQty);
      lot.remainingQtyPaxg -= reducedQty;
      lot.remainingQtyGram = lot.remainingQtyPaxg * config.troyOzToGram;
      remainingSellQty -= reducedQty;
    }
  }

  return lots.filter((lot) => lot.remainingQtyPaxg > 0.00000001);
}

function summarizeCycle({ trades, cycleId, config, nowWita, currentPaxgUsd, currentUsdtIdr }) {
  const cycleTrades = trades.filter((trade) => trade.cycleId === cycleId);
  const anchorTrade = cycleTrades.find((trade) => trade.action === "BUY_ANCHOR") || null;
  const dipTrade = cycleTrades.find((trade) => trade.action === "BUY_DIP") || null;
  const deepTrade = cycleTrades.find((trade) => trade.action === "BUY_DEEP") || null;
  const tp1Trade = cycleTrades.find((trade) => trade.action === "SELL_TP1") || null;
  const tp2Trade = cycleTrades.find((trade) => trade.action === "SELL_TP2") || null;
  const anchorPriceUsd = anchorTrade
    ? anchorTrade.priceUsdOz
    : findLatestTradeBeforeCycle(trades, cycleId, "BUY_ANCHOR")?.priceUsdOz || null;

  return {
    id: cycleId,
    trades: cycleTrades,
    anchorDate: getCycleDate(nowWita, config.anchorDay),
    hasAnchorBuy: Boolean(anchorTrade),
    hasDipBuy: Boolean(dipTrade),
    hasDeepBuy: Boolean(deepTrade),
    hasTp1Sell: Boolean(tp1Trade),
    hasTp2Sell: Boolean(tp2Trade),
    anchorPriceUsd,
    currentPaxgUsd,
    currentUsdtIdr,
    budgetTotalIdr: config.monthlyBudgetIdr,
    budgetAnchorIdr: config.monthlyBudgetIdr * (config.pctAnchor / 100),
    budgetDipIdr: config.monthlyBudgetIdr * (config.pctDip / 100),
    budgetDeepDipIdr: config.monthlyBudgetIdr * (config.pctDeepDip / 100),
    swingAmmoIdr: config.swingAmmoIdr,
  };
}

function buildPortfolioPayload(ctx) {
  return {
    open_qty_paxg: roundNumber(ctx.portfolio.openQtyPaxg, 8),
    open_qty_gram: roundNumber(ctx.portfolio.openQtyGram, 4),
    open_cost_idr: roundNumber(ctx.portfolio.openCostIdr, 0),
    avg_entry_usd: roundNumber(ctx.portfolio.avgEntryUsd, 2),
    avg_entry_idr_per_paxg: roundNumber(ctx.portfolio.avgEntryIdrPerPaxg, 0),
    market_value_idr: roundNumber(ctx.portfolio.currentMarketValueIdr, 0),
  };
}

function buildMarketPayload(ctx) {
  return {
    current_paxg_usd: roundNumber(ctx.market.currentPaxgUsd, 2),
    current_usdt_idr: roundNumber(ctx.market.currentUsdtIdr, 2),
    current_idr_per_gram: roundNumber(ctx.market.currentIdrPerGram, 0),
  };
}

function buildPnlPayload(ctx) {
  const positionTargets = buildPositionTargetPayload(ctx);
  const buyTargets = buildBuyTargetPayload(ctx);

  return {
    gain_pct: roundNumber(ctx.metrics.gainPct, 2),
    drop_pct: roundNumber(ctx.metrics.dropPct, 2),
    realized_pnl_idr: roundNumber(ctx.portfolio.realizedPnlIdr, 0),
    unrealized_pnl_idr: roundNumber(ctx.portfolio.unrealizedPnlIdr, 0),
    dip_buy_target_usd: buyTargets.dip_buy_target_usd,
    deep_dip_buy_target_usd: buyTargets.deep_dip_buy_target_usd,
    anchor_tp_target_usd: positionTargets.anchor_tp_target_usd,
    dip_tp_target_usd: positionTargets.dip_tp_target_usd,
    deep_dip_tp_target_usd: positionTargets.deep_dip_tp_target_usd,
  };
}

function buildDashboardMetrics(ctx) {
  const pnl = buildPnlPayload(ctx);
  const market = buildMarketPayload(ctx);
  const portfolio = buildPortfolioPayload(ctx);

  return [
    { metric: "current_paxg_usd", value: market.current_paxg_usd, note: "Updated otomatis oleh n8n" },
    { metric: "current_usdt_idr", value: market.current_usdt_idr, note: "Updated otomatis oleh n8n" },
    { metric: "total_open_qty_paxg", value: portfolio.open_qty_paxg, note: "Updated otomatis oleh n8n" },
    { metric: "total_open_gram", value: portfolio.open_qty_gram, note: "Updated otomatis oleh n8n" },
    { metric: "open_cost_idr", value: portfolio.open_cost_idr, note: "Updated otomatis oleh n8n" },
    { metric: "avg_entry_idr_per_paxg", value: portfolio.avg_entry_idr_per_paxg, note: "Updated otomatis oleh n8n" },
    { metric: "avg_entry_usd_per_oz", value: portfolio.avg_entry_usd, note: "Updated otomatis oleh n8n" },
    { metric: "market_value_idr", value: portfolio.market_value_idr, note: "Updated otomatis oleh n8n" },
    { metric: "unrealized_pnl_idr", value: pnl.unrealized_pnl_idr, note: "Updated otomatis oleh n8n" },
    { metric: "realized_pnl_idr", value: pnl.realized_pnl_idr, note: "Updated otomatis oleh n8n" },
    { metric: "dip_buy_target_usd", value: pnl.dip_buy_target_usd, note: "Target harga dip buy dari anchor" },
    { metric: "deep_dip_buy_target_usd", value: pnl.deep_dip_buy_target_usd, note: "Target harga deep dip buy dari anchor" },
    { metric: "anchor_tp_target_usd", value: pnl.anchor_tp_target_usd, note: "TP posisi anchor +2%" },
    { metric: "dip_tp_target_usd", value: pnl.dip_tp_target_usd, note: "TP posisi dip +3%" },
    { metric: "deep_dip_tp_target_usd", value: pnl.deep_dip_tp_target_usd, note: "TP posisi deep dip +5%" },
    { metric: "monthly_budget_idr", value: ctx.config.monthlyBudgetIdr, note: "Config dari SETTINGS" },
    { metric: "swing_ammo_idr", value: ctx.config.swingAmmoIdr, note: "Config dari SETTINGS" },
  ];
}

function mergeConfig(defaults, settings, override) {
  const troyOzToGram = toNumberOrDefault(
    override.troyOzToGram ?? settings.troy_oz_to_gram,
    defaults.troyOzToGram
  );

  return {
    ...defaults,
    anchorDay: toNumberOrDefault(override.anchorDay ?? settings.anchor_day, defaults.anchorDay),
    pctAnchor: toNumberOrDefault(override.pctAnchor ?? settings.pct_anchor, defaults.pctAnchor),
    pctDip: toNumberOrDefault(override.pctDip ?? settings.pct_dip, defaults.pctDip),
    pctDeepDip: toNumberOrDefault(override.pctDeepDip ?? settings.pct_deep_dip, defaults.pctDeepDip),
    dipThresholdPct: toNumberOrDefault(
      override.dipThresholdPct ?? settings.dip_threshold_pct,
      defaults.dipThresholdPct
    ),
    deepDipThresholdPct: toNumberOrDefault(
      override.deepDipThresholdPct ?? settings.deep_dip_threshold_pct,
      defaults.deepDipThresholdPct
    ),
    tpAnchorPct: toNumberOrDefault(
      override.tpAnchorPct ?? settings.tp_anchor_pct ?? settings.tp1_pct,
      defaults.tpAnchorPct
    ),
    tpDipPct: toNumberOrDefault(
      override.tpDipPct ?? settings.tp_dip_pct,
      defaults.tpDipPct
    ),
    tpDeepDipPct: toNumberOrDefault(
      override.tpDeepDipPct ?? settings.tp_deep_dip_pct ?? settings.tp2_pct,
      defaults.tpDeepDipPct
    ),
    feePct: toNumberOrDefault(override.feePct ?? settings.fee_pct, defaults.feePct),
    cooldownMinutes: toNumberOrDefault(
      override.cooldownMinutes ?? settings.cooldown_minutes,
      defaults.cooldownMinutes
    ),
    // Protect against locale issues like 31.1034768 being read as 311034768.
    troyOzToGram:
      troyOzToGram >= 30 && troyOzToGram <= 32
        ? troyOzToGram
        : defaults.troyOzToGram,
    monthlyBudgetIdr: toNumberOrDefault(
      override.monthlyBudgetIdr ?? settings.monthly_budget_idr,
      defaults.monthlyBudgetIdr
    ),
    swingAmmoIdr: toNumberOrDefault(
      override.swingAmmoIdr ?? settings.swing_ammo_idr,
      defaults.swingAmmoIdr
    ),
    timezone: override.timezone || settings.timezone || defaults.timezone,
    tp1SellFraction: toNumberOrDefault(
      override.tp1SellFraction ?? settings.tp1_sell_fraction,
      defaults.tp1SellFraction
    ),
  };
}

function getSuggestedGrossIdr(ctx, actionCode, options = {}) {
  switch (actionCode) {
    case "BUY_ANCHOR":
      return ctx.cycle.budgetAnchorIdr;
    case "BUY_DIP":
      return ctx.cycle.budgetDipIdr;
    case "BUY_DEEP":
      return ctx.cycle.budgetDeepDipIdr;
    case "SELL_TP1":
      return ctx.portfolio.openQtyPaxg * ctx.config.tp1SellFraction * ctx.market.currentIdrPerPaxg;
    case "SELL_TP2":
      return ctx.portfolio.openQtyPaxg * ctx.market.currentIdrPerPaxg;
    case "SELL_MANUAL":
      return options.lot
        ? options.lot.remainingQtyPaxg * ctx.market.currentIdrPerPaxg
        : null;
    default:
      return null;
  }
}

function getSuggestedQtyPaxg(ctx, actionCode, options = {}) {
  if (actionCode === "SELL_MANUAL" && options.lot) return options.lot.remainingQtyPaxg;
  const amountIdr = getSuggestedGrossIdr(ctx, actionCode, options);
  return estimateQtyPaxg(amountIdr, ctx.market.currentPaxgUsd, ctx.market.currentUsdtIdr);
}

function getSuggestedSellFraction(ctx, actionCode, options = {}) {
  if (actionCode === "SELL_TP1") return ctx.config.tp1SellFraction;
  if (actionCode === "SELL_TP2") return 1;
  if (actionCode === "SELL_MANUAL" && options.lot && ctx.portfolio.openQtyPaxg > 0) {
    return options.lot.remainingQtyPaxg / ctx.portfolio.openQtyPaxg;
  }
  return null;
}

function getTpConfigForLot(config, action) {
  if (action === "BUY_ANCHOR") {
    return {
      signalKey: "anchor_tp",
      alertType: "ANCHOR_TP_ALERT",
      title: "TP ANCHOR",
      positionLabel: "Anchor",
      targetPct: config.tpAnchorPct,
      emoji: "✅",
    };
  }

  if (action === "BUY_DIP") {
    return {
      signalKey: "dip_tp",
      alertType: "DIP_TP_ALERT",
      title: "TP DIP",
      positionLabel: "Dip",
      targetPct: config.tpDipPct,
      emoji: "🎯",
    };
  }

  if (action === "BUY_DEEP") {
    return {
      signalKey: "deep_tp",
      alertType: "DEEP_DIP_TP_ALERT",
      title: "TP DEEP DIP",
      positionLabel: "Deep Dip",
      targetPct: config.tpDeepDipPct,
      emoji: "🚀",
    };
  }

  return null;
}

function buildPositionTargetPayload(ctx) {
  const targets = {
    anchor_tp_target_usd: null,
    dip_tp_target_usd: null,
    deep_dip_tp_target_usd: null,
  };

  for (const lot of ctx.portfolio.openLots || []) {
    const tpConfig = getTpConfigForLot(ctx.config, lot.action);
    if (!tpConfig) continue;

    const targetPrice = roundNumber(lot.priceUsdOz * (1 + tpConfig.targetPct / 100), 2);
    if (lot.action === "BUY_ANCHOR") targets.anchor_tp_target_usd = targetPrice;
    if (lot.action === "BUY_DIP") targets.dip_tp_target_usd = targetPrice;
    if (lot.action === "BUY_DEEP") targets.deep_dip_tp_target_usd = targetPrice;
  }

  return targets;
}

function buildBuyTargetPayload(ctx) {
  const anchorPriceUsd = ctx.cycle.anchorPriceUsd;
  if (!anchorPriceUsd) {
    return {
      dip_buy_target_usd: null,
      deep_dip_buy_target_usd: null,
    };
  }

  return {
    dip_buy_target_usd: roundNumber(
      anchorPriceUsd * (1 - ctx.config.dipThresholdPct / 100),
      2
    ),
    deep_dip_buy_target_usd: roundNumber(
      anchorPriceUsd * (1 - ctx.config.deepDipThresholdPct / 100),
      2
    ),
  };
}

function buildHeaderPrice(ctx) {
  return (
    `🕐 ${ctx.labels.time} WITA\n` +
    `💹 PAXG : $${fmt(ctx.market.currentPaxgUsd)} / troy oz\n` +
    `💱 Kurs : ${formatIdr(ctx.market.currentUsdtIdr)} / USDT\n` +
    `💵 /gram: ${formatIdr(ctx.market.currentIdrPerGram)}\n`
  );
}

function getCycleDate(nowWita, anchorDay) {
  const year = nowWita.getFullYear();
  const month = nowWita.getMonth();
  const date = nowWita.getDate();

  if (date <= anchorDay) {
    if (month === 0) return new Date(year - 1, 11, anchorDay);
    return new Date(year, month - 1, anchorDay);
  }

  return new Date(year, month, anchorDay);
}

function formatCycleId(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseGvizText(rawText) {
  const jsonText = String(rawText || "")
    .replace(/^[^\(]+\(/, "")
    .replace(/\);?\s*$/, "");
  return JSON.parse(jsonText);
}

function mapColumns(cols) {
  const map = {};
  for (let i = 0; i < cols.length; i += 1) {
    map[toSnakeCase(cols[i])] = i;
  }
  return map;
}

function getCellValue(row, colIdx) {
  if (colIdx === undefined || colIdx < 0) return null;
  const cell = row?.c?.[colIdx];
  return cell && cell.v !== null && cell.v !== undefined ? cell.v : null;
}

function getStringCell(row, colIdx) {
  const value = getCellValue(row, colIdx);
  return value === null ? "" : String(value).trim();
}

function getStringValue(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseTradeDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.startsWith("Date(")) {
    const parts = value
      .replace("Date(", "")
      .replace(")", "")
      .split(",")
      .map(Number);
    return new Date(parts[0], parts[1], parts[2], parts[3] || 0, parts[4] || 0, parts[5] || 0);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCycleIdValue(value) {
  const raw = getStringValue(value);
  if (!raw) return "";

  if (/^\d{4}-\d{2}$/.test(raw)) return raw;

  const asDate = parseTradeDateTime(raw);
  if (asDate) {
    const year = asDate.getFullYear();
    const month = String(asDate.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  return raw;
}

function isPostedDone(value) {
  return getStringValue(value).toUpperCase() === "DONE";
}

function findLatestTrade(trades, actionCode) {
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    if (trades[i].action === actionCode) return trades[i];
  }
  return null;
}

function findLatestTradeBeforeCycle(trades, cycleId, actionCode) {
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    if (trades[i].cycleId < cycleId && trades[i].action === actionCode) return trades[i];
  }
  return null;
}

function estimateQtyPaxg(grossIdr, priceUsdOz, usdtIdr) {
  if (!grossIdr || !priceUsdOz || !usdtIdr) return null;
  return grossIdr / (priceUsdOz * usdtIdr);
}

function isCooldownPassed(lastTs, nowMs, cooldownMs) {
  return nowMs - (lastTs || 0) > cooldownMs;
}

function toSnakeCase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toRequiredNumber(value, message) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(message);
  return num;
}

function toNumberOrDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toTimezoneDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const lookup = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }

  return new Date(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second)
  );
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function sumBy(items, field) {
  return items.reduce((sum, item) => sum + (Number(item[field]) || 0), 0);
}

function sumWhere(items, predicate, field) {
  return items.reduce((sum, item) => sum + (predicate(item) ? Number(item[field]) || 0 : 0), 0);
}

function roundNumber(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function formatIdr(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

function fmt(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(decimals);
}

// n8n entrypoint
const market = {
  paxgUsd: $('Ambil Harga PAXG').first()?.json?.price,
  usdtIdr: $('Ambil Kurs USDT/IDR').first()?.json?.price,
};

const settingsData = $('Parse SETTINGS').first()?.json?.settings || {};
const tradeLogRows = $('Parse TRADE_LOG').first()?.json?.trade_log_rows || [];
const output = runMainLogic({
  market,
  settingsData,
  tradeLogRows,
  staticData: $getWorkflowStaticData('global'),
  now: new Date(),
});

return output;

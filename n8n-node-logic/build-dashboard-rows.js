const metrics = $input.first()?.json?.dashboard_metrics || [];

function toSheetValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    // Google Sheets dengan locale Indonesia bisa membaca string decimal
    // bertitik sebagai ribuan. Ubah ke koma agar nilai pecahan tetap benar.
    if (!Number.isInteger(value)) return String(value).replace(".", ",");
    return value;
  }
  return value;
}

return metrics.map((row) => ({
  json: {
    ...row,
    value: toSheetValue(row.value),
  },
}));

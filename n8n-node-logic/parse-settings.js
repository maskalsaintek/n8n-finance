const rawText = $input.first()?.json?.data || '';

function parseGvizText(raw) {
  const jsonText = String(raw || '')
    .replace(/^[^\(]+\(/, '')
    .replace(/\);?\s*$/, '');
  return JSON.parse(jsonText);
}

function getCellValue(row, colIdx) {
  if (colIdx === undefined || colIdx < 0) return null;
  const cell = row?.c?.[colIdx];
  return cell && cell.v !== null && cell.v !== undefined ? cell.v : null;
}

function toSnakeCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseSheetRows(raw) {
  if (!raw) return [];
  const table = parseGvizText(raw).table || {};
  const cols = table.cols || [];
  const rows = table.rows || [];
  if (!rows.length) return [];

  const colHeaders = cols.map((col) => toSnakeCase(col?.label));
  const hasColHeaders = colHeaders.some((header) => header);
  const headerRow = rows[0];
  const rowHeaders = (headerRow?.c || []).map((_, index) => toSnakeCase(getCellValue(headerRow, index)));
  const headers = hasColHeaders ? colHeaders : rowHeaders;
  const dataRows = hasColHeaders ? rows : rows.slice(1);

  return dataRows.map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (!header) return;
      item[header] = getCellValue(row, index);
    });
    return item;
  }).filter((item) => Object.values(item).some((value) => value !== null && value !== ''));
}

const rows = parseSheetRows(rawText);
const settings = {};
for (const row of rows) {
  if (!row.key) continue;
  settings[String(row.key).trim()] = row.value;
}

return [{ json: { settings, settings_rows: rows } }];

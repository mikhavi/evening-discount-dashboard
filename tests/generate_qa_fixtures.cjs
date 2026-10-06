// Generates small disposable XLSX files for manual browser import checks.
// Run: node tests/generate_qa_fixtures.cjs <output-directory>
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('../exceljs.min.js');

const output = process.argv[2];
if (!output) throw new Error('Pass an output directory');
fs.mkdirSync(output, { recursive: true });
const headers = [
  'Код_1С', 'Штрихкод', 'Наименование_товара', 'Товарная_категория',
  'Остаток_на_19_30', 'Ед_изм', 'Цена_розничная_тг', 'Себестоимость_тг',
  'Время_изготовления', 'Срок_годности_часов'
];
const target = 'Кулинария: Горячие блюда';
const item = (id, name, stock = 2, unit = 'шт', price = 1000, cost = 200, made = '08:00', shelf = 24, barcode = `487000100${String(id).padStart(4, '0')}`) =>
  [id, barcode, name, target, stock, unit, price, cost, made, shelf];

async function save(name, build) {
  const book = new ExcelJS.Workbook();
  build(book);
  fs.writeFileSync(path.join(output, name), Buffer.from(await book.xlsx.writeBuffer()));
}

(async () => {
  fs.writeFileSync(path.join(output, 'wrong_type.txt'), 'not a spreadsheet');
  fs.writeFileSync(path.join(output, 'zero_bytes.xlsx'), '');
  fs.writeFileSync(path.join(output, 'corrupted.xlsx'), 'not an Excel archive');
  await save('empty_sheet.xlsx', book => { book.addWorksheet('Пусто'); });
  await save('header_only.xlsx', book => { book.addWorksheet('Данные').addRow(headers); });
  await save('missing_column.xlsx', book => {
    book.addWorksheet('Данные').addRow(headers.filter(header => header !== 'Себестоимость_тг'));
  });
  await save('no_target.xlsx', book => {
    const sheet = book.addWorksheet('Данные');
    sheet.addRow(headers);
    const outside = item(1, 'Нецелевой товар');
    outside[3] = 'Полуфабрикаты замороженные';
    sheet.addRow(outside);
  });
  await save('cover_sheet_then_data.xlsx', book => {
    book.addWorksheet('Инструкция').addRow(['Выгрузка для уценки']);
    const sheet = book.addWorksheet('Данные');
    sheet.addRow(['Остатки магазина']);
    sheet.addRow([]);
    sheet.addRow(headers);
    sheet.addRow(item(1, 'Товар на втором листе'));
  });
  await save('invalid_time_boundaries.xlsx', book => {
    const sheet = book.addWorksheet('Данные');
    sheet.addRow(headers);
    sheet.addRow(item(1, 'Время 12:99', 2, 'шт', 1000, 200, '12:99'));
    sheet.addRow(item(2, 'Время 24:00', 2, 'шт', 1000, 200, '24:00'));
    sheet.addRow(item(3, 'Текст вместо времени', 2, 'шт', 1000, 200, 'abc 08:00'));
    sheet.addRow(item(4, 'Нормальное время'));
  });
  await save('rule_boundaries.xlsx', book => {
    const sheet = book.addWorksheet('Данные');
    sheet.addRow(headers);
    sheet.addRow(item(1, 'Срок ровно 20:00', 2, 'шт', 1000, 200, '08:00', 12));
    sheet.addRow(item(2, 'Срок 20:01', 2, 'шт', 1000, 200, '08:01', 12));
    sheet.addRow(item(3, 'Срок ровно 23:00', 2, 'шт', 1000, 200, '11:00', 12));
    sheet.addRow(item(4, 'Срок 23:01', 2, 'шт', 1000, 200, '11:01', 12));
    sheet.addRow(item(5, 'Остаток 0,49 кг', 0.49, 'кг'));
    sheet.addRow(item(6, 'Остаток 0,5 кг', 0.5, 'кг'));
    sheet.addRow(item(7, 'Остаток 0,99 шт', 0.99, 'шт'));
    sheet.addRow(item(8, 'Остаток 1 шт', 1, 'шт'));
    sheet.addRow(item(9, 'Цена ограничена маржей', 2, 'шт', 100, 70));
    sheet.addRow(item(10, 'Маржа исключает уценку', 2, 'шт', 100, 95));
    sheet.addRow(item(11, 'Округление вниз', 2, 'шт', 101, 10));
  });
  await save('duplicate_scope.xlsx', book => {
    const sheet = book.addWorksheet('Данные');
    sheet.addRow(headers);
    sheet.addRow(item(1, 'Целевой товар', 2, 'шт', 1000, 200, '08:00', 24, '999'));
    const outside = item(2, 'Нецелевой товар', 2, 'шт', 1000, 200, '08:00', 24, '999');
    outside[3] = 'Полуфабрикаты замороженные';
    sheet.addRow(outside);
  });
  console.log(`Fixtures written to ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });

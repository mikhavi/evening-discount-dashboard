(() => {
  const ALLOWED = [
    'Кулинария: Салаты заправленные',
    'Кулинария: Салаты незаправленные',
    'Кулинария: Горячие блюда',
    'Кулинария: Выпечка и сдоба'
  ];
  const FIELD_ALIASES = {
    code: ['Код_1С', 'Код 1С', 'Код'],
    barcode: ['Штрихкод', 'Штрих-код', 'Barcode'],
    name: ['Наименование_товара', 'Наименование товара', 'Товар'],
    category: ['Товарная_категория', 'Товарная категория', 'Категория'],
    stock: ['Остаток_на_19_30', 'Остаток на 19:30', 'Остаток', 'Количество'],
    unit: ['Ед_изм', 'Ед. изм.', 'Единица измерения', 'Ед изм'],
    retail: ['Цена_розничная_тг', 'Цена розничная, тг', 'Розничная цена', 'Старая цена'],
    cost: ['Себестоимость_тг', 'Себестоимость, тг', 'Себестоимость'],
    made: ['Время_изготовления', 'Время изготовления', 'Дата изготовления'],
    shelf: ['Срок_годности_часов', 'Срок годности, часов', 'Срок годности']
  };
  const MAX_SHELF = {
    'Кулинария: Салаты заправленные': 12,
    'Кулинария: Салаты незаправленные': 18,
    'Кулинария: Горячие блюда': 24
  };
  const TIME_OF_SALE = 20;
  const money = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 });
  const amount = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
  const quantity = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
  const thresholdNumber = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 12 });
  const pluralRu = (count, one, few, many) => {
    const last = Math.abs(count) % 10, lastTwo = Math.abs(count) % 100;
    return last === 1 && lastTwo !== 11 ? one : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let currentFileName = '';
  let sourceRows = [];
  let result = { promo: [], risks: [], all: [] };
  let currentView = 'upload';
  let promoFilter = 'all';
  let riskFilter = 'all';
  let expiryFilter = 'all';
  let activeCategoryIndex = 0;
  let categoryFilter = 'all';
  let toastTimer;
  let approvalStorageKey = '';
  let approvals = {};
  let pendingMarginImport = null;
  const stockRules = { kg: 0.5, pieces: 1, kgInclusive: true, piecesInclusive: true };

  const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const normalizeCategory = value => clean(value).replace(/\s*:\s*/g, ': ');
  const number = value => {
    if (value === null || value === undefined || clean(value) === '') return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (value && typeof value === 'object' && 'result' in value) return number(value.result);
    const parsed = Number(String(value ?? '').replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const timeHours = value => {
    if (value instanceof Date) return value.getHours() + value.getMinutes() / 60 + value.getSeconds() / 3600;
    if (typeof value === 'number' && Number.isFinite(value)) return (value % 1) * 24;
    const text = clean(value);
    const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return NaN;
    if (Number(match[1]) >= 24 || Number(match[2]) >= 60 || Number(match[3] || 0) >= 60) return NaN;
    return Number(match[1]) + Number(match[2]) / 60 + Number(match[3] || 0) / 3600;
  };
  const timeLabel = hours => `${String(Math.floor(hours) % 24).padStart(2, '0')}:${String(Math.round((hours % 1) * 60)).padStart(2, '0')}${hours >= 24 ? ' следующего дня' : ''}`;
  const closingHours = () => { const [hours, minutes] = $('#closing-time').value.split(':').map(Number); const value = hours + minutes / 60; return hours < 6 ? value + 24 : value; };
  const fmtMoney = value => `${amount.format(value || 0)} ₸`;
  const fmtQty = (value, unit) => `${quantity.format(value || 0)} ${unit || ''}`.trim();
  const stockRuleText = () => `кг ${stockRules.kgInclusive ? '≤' : '<'} ${thresholdNumber.format(stockRules.kg)}; шт./порц. ${stockRules.piecesInclusive ? '≤' : '<'} ${thresholdNumber.format(stockRules.pieces)}`;
  const atStockLimit = (value, limit, inclusive) => inclusive ? value <= limit : value < limit;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const initials = name => clean(name).split(' ').slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  const categoryShort = category => clean(category).replace(/^Кулинария:\s*/, '');
  const roundDown5 = value => Math.floor((value + 1e-8) / 5) * 5;
  const roundUp5 = value => Math.ceil((value - 1e-8) / 5) * 5;
  const approvalKey = item => `${item.sourceRow}:${clean(item.code)}`;
  const requiresDirectorApproval = () => $('#require-director-approval').checked;
  const isMarginApproved = item => item.riskTypes.includes('margin') && Boolean(item.approval);
  const isMarginPriceSet = item => item.riskTypes.includes('margin') && (!requiresDirectorApproval() || isMarginApproved(item));
  const isStickerReady = item => item.promo && !item.riskTypes.includes('barcode') && (!item.riskTypes.includes('margin') || isMarginPriceSet(item));
  const isPOSExportable = item => item.promo && item.riskTypes.includes('margin') && !item.riskTypes.includes('barcode') && (!requiresDirectorApproval() || isMarginApproved(item));
  function saveApprovals() {
    if (!approvalStorageKey) return;
    try { localStorage.setItem(approvalStorageKey, JSON.stringify(approvals)); }
    catch { showToast('Не удалось сохранить решения в этом браузере. Скачайте Excel.'); }
  }
  function restoreApprovals() {
    approvals = {};
    if (!approvalStorageKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(approvalStorageKey) || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) approvals = stored;
      const storedMode = localStorage.getItem(`${approvalStorageKey}:director-required`);
      $('#require-director-approval').checked = storedMode === '1';
    } catch { approvals = {}; }
  }
  function barcodeIssue(value) {
    const barcode = clean(value);
    if (!barcode) return 'Штрихкод не заполнен';
    if (/\d\s*[eеEЕ]\s*[+-]?\s*\d/.test(barcode)) return 'В файле сохранена сокращённая текстовая запись. Полный исходный код нужно сверить в 1С';
    if (/[;,/\n]/.test(barcode)) return 'В ячейке указано несколько значений';
    if (!/^\d+$/.test(barcode)) return 'Штрихкод должен состоять только из цифр';
    return '';
  }

  function pushRisk(row, type, code, reason, action = 'Проверить вручную') {
    if (!row.riskTypes.includes(type)) row.riskTypes.push(type);
    row.reasons.push(reason);
    row.riskCodes.push(code);
    if (action && !row.action.split('; ').includes(action)) row.action = row.action ? `${row.action}; ${action}` : action;
  }
  const hasDataIssue = item => (item.categoryAllowed && item.riskTypes.some(type => type === 'data' || type === 'barcode')) || (!item.category && item.riskTypes.includes('data'));

  function analyze(rows) {
    const closing = closingHours();
    const strictWholeUnits = $('#whole-units-only').checked;
    const barcodes = new Map();
    rows.forEach(row => {
      const barcode = clean(row.barcode);
      if (barcode) barcodes.set(barcode, (barcodes.get(barcode) || 0) + 1);
    });
    const analyzed = rows.map((source, index) => {
      const item = { ...source, index, category: normalizeCategory(source.category), riskTypes: [], riskCodes: [], reasons: [], action: '', promo: false };
      item.barcode = clean(item.barcode);
      item.stockNum = number(item.stock);
      item.retailNum = number(item.retail);
      item.costNum = number(item.cost);
      item.shelfNum = number(item.shelf);
      item.madeHours = timeHours(item.made);
      item.unit = clean(item.unit).toLowerCase();
      item.categoryAllowed = ALLOWED.includes(item.category);
      item.expiryStage = '';

      const missing = [];
      if (!clean(item.name)) missing.push('наименование');
      if (!item.category) missing.push('категория');
      if (!Number.isFinite(item.stockNum)) missing.push('остаток');
      if (!item.unit) missing.push('единица измерения');
      if (!Number.isFinite(item.retailNum) || item.retailNum <= 0) missing.push('розничная цена');
      if (!Number.isFinite(item.costNum) || item.costNum < 0) missing.push('себестоимость');
      if (missing.length) pushRisk(item, 'data', 'DATA_REVIEW', `В строке не заполнено или некорректно: ${missing.join(', ')}.`, 'Исправить выгрузку');
      const barcodeProblem = barcodeIssue(item.barcode);
      if (barcodeProblem) pushRisk(item, 'barcode', item.barcode ? 'BARCODE_REVIEW' : 'MISSING_BARCODE', barcodeProblem.endsWith('.') ? barcodeProblem : `${barcodeProblem}.`, '');
      if (!barcodeProblem && item.barcode && (barcodes.get(item.barcode) || 0) > 1) pushRisk(item, 'barcode', 'DUPLICATE_BARCODE', 'Штрихкод повторяется в выгрузке.', '');
      if (Number.isFinite(item.stockNum) && item.stockNum < 0) pushRisk(item, 'data', 'DATA_REVIEW', 'Остаток отрицательный — строка требует проверки.', 'Исправить выгрузку');
      if (item.categoryAllowed && item.unit && !['кг', 'шт', 'порц', 'порция', 'порции'].includes(item.unit)) pushRisk(item, 'data', 'UNKNOWN_UNIT', `Единица «${item.unit}» не позволяет корректно проверить минимальный остаток.`, 'Сверить единицу измерения');
      const invalidPieceCount = strictWholeUnits && item.categoryAllowed && item.unit === 'шт' && Number.isFinite(item.stockNum) && !Number.isInteger(item.stockNum);
      if (invalidPieceCount) pushRisk(item, 'data', 'FRACTIONAL_PIECES', `Остаток ${fmtQty(item.stockNum, item.unit)} нецелый: для единицы «шт» разрешены только целые числа.`, 'Проверить и исправить остаток в 1С');
      if (item.categoryAllowed && Number.isFinite(item.stockNum) && item.stockNum >= 0) {
        if (item.unit === 'кг' && atStockLimit(item.stockNum, stockRules.kg, stockRules.kgInclusive)) pushRisk(item, 'stock', 'LOW_STOCK', `Остаток ${fmtQty(item.stockNum, item.unit)} подпадает под порог бракеража (${stockRules.kgInclusive ? '≤' : '<'} ${thresholdNumber.format(stockRules.kg)} кг) — оформить акт и списание.`, 'Акт бракеража');
        if (!invalidPieceCount && ['шт', 'порц', 'порция', 'порции'].includes(item.unit) && atStockLimit(item.stockNum, stockRules.pieces, stockRules.piecesInclusive)) pushRisk(item, 'stock', 'LOW_STOCK', `Остаток ${fmtQty(item.stockNum, item.unit)} подпадает под порог бракеража (${stockRules.piecesInclusive ? '≤' : '<'} ${thresholdNumber.format(stockRules.pieces)} шт/порц) — акция не применяется.`, 'Акт бракеража');
      }

      const validShelf = Number.isFinite(item.shelfNum) && item.shelfNum > 0 && Number.isFinite(item.madeHours) && item.madeHours >= 0 && item.madeHours < 24;
      if (item.categoryAllowed && !validShelf) pushRisk(item, 'data', 'DATA_REVIEW', 'Нет корректного времени изготовления или срока годности — нельзя подтвердить безопасность акции.', 'Проверить маркировку');
      if (item.categoryAllowed && validShelf) {
        const maxShelf = MAX_SHELF[item.category];
        if (maxShelf && item.shelfNum > maxShelf) pushRisk(item, 'expiry', 'SHELF_LIFE_REVIEW', `Срок ${quantity.format(item.shelfNum)} ч превышает ограничение категории (${maxShelf} ч).`, 'Проверить технологическую карту');
        if (item.category === ALLOWED[0] && item.madeHours >= 12) pushRisk(item, 'expiry', 'SHIFT_REVIEW', `Время ${timeLabel(item.madeHours)} не подтверждает изготовление в утреннюю смену.`, 'Подтвердить смену');
        item.expiryHours = item.madeHours + item.shelfNum;
        if (item.expiryHours <= TIME_OF_SALE + 1e-8) {
          item.expiryStage = 'before';
          const when = Math.abs(item.expiryHours - TIME_OF_SALE) < 1e-8 ? 'ровно к 20:00' : `в ${timeLabel(item.expiryHours)}`;
          pushRisk(item, 'expiry', 'EXPIRES_BEFORE_PROMO', `Срок годности заканчивается ${when} — к началу скидки продавать товар уже нельзя.`, 'Не выставлять на акцию');
        } else if (item.expiryHours <= closing + 1e-8) {
          item.expiryStage = 'during';
          pushRisk(item, 'expiry', 'EXPIRES_DURING_PROMO', `Срок годности заканчивается во время скидки, в ${timeLabel(item.expiryHours)}. Чтобы исключить продажу после срока, позиция заблокирована на весь вечер.`, 'Не клеить стикер; снять товар до истечения срока');
        }
      }
      if (item.riskTypes.some(type => type !== 'barcode')) return item;

      item.marginFloor = item.costNum * 1.05;
      item.price30 = item.retailNum * 0.7;
      const customerPrice = roundDown5(item.price30);
      if (customerPrice + 1e-8 >= item.marginFloor) {
        item.newPrice = customerPrice;
      } else {
        item.newPrice = roundUp5(item.marginFloor);
        if (item.newPrice >= item.retailNum) {
          pushRisk(item, 'margin', 'MARGIN_ALERT', `Минимальная цена ${fmtMoney(item.marginFloor)} с учётом себестоимости не ниже старой цены.`, 'Решение директора');
          return item;
        }
        pushRisk(item, 'margin', 'MARGIN_ALERT', `Скидка −30% нарушает минимальную маржу. Цена ${fmtMoney(item.newPrice)} ограничена порогом себестоимости +5%; итоговую цену нужно передать на кассу без повторных −30%.`, 'Подготовить итоговую цену для кассы');
        const saved = approvals[approvalKey(item)];
        if (saved && Number.isFinite(saved.price) && saved.price >= item.newPrice && saved.price < item.retailNum && saved.price % 5 === 0 && clean(saved.by) && typeof saved.at === 'string') {
          item.newPrice = saved.price;
          item.approval = { price: saved.price, by: clean(saved.by), at: saved.at, comment: clean(saved.comment) };
        }
        item.action = requiresDirectorApproval() && !item.approval ? 'Согласовать цену; затем передать её на кассу' : 'Передать итоговую цену на кассу к 20:00';
      }
      item.promo = true;
      item.stockRetailValue = item.stockNum * item.retailNum;
      item.promoValue = item.stockNum * item.newPrice;
      item.marginPerUnit = item.newPrice - item.costNum;
      return item;
    });
    analyzed.forEach(item => {
      if (item.promo && item.riskTypes.includes('barcode')) {
        item.reasons.push('До печати стикера и настройки скидки сверьте код в 1С.');
        item.action = item.action ? `${item.action}; Сверить штрихкод в 1С` : 'Сверить штрихкод в 1С';
      }
    });
    return {
      all: analyzed,
      promo: analyzed.filter(item => item.promo),
      risks: analyzed.filter(item => item.riskTypes.length)
    };
  }

  function render() {
    result = analyze(sourceRows);
    const promo = result.promo;
    const risks = result.risks;
    const stockValue = promo.reduce((sum, item) => sum + item.stockRetailValue, 0);
    const promoValue = promo.reduce((sum, item) => sum + item.promoValue, 0);
    const promoBarcodeCount = promo.filter(item => item.riskTypes.includes('barcode')).length;
    const marginPromoCount = promo.filter(item => item.riskTypes.includes('margin')).length;
    const marginApproved = promo.filter(isMarginApproved).length;
    const stickerReady = promo.filter(isStickerReady).length;
    const marginAwaitingApproval = requiresDirectorApproval() ? promo.filter(item => item.riskTypes.includes('margin') && !isMarginApproved(item)).length : 0;
    const posExportable = promo.filter(isPOSExportable).length;
    const posBlockedBarcode = promo.filter(item => item.riskTypes.includes('margin') && item.riskTypes.includes('barcode')).length;
    const marginCount = risks.filter(item => item.riskTypes.includes('margin')).length;
    const lowCount = risks.filter(item => item.riskTypes.includes('stock')).length;
    const expiryCount = risks.filter(item => item.riskTypes.includes('expiry')).length;
    const expiryBefore = risks.filter(item => item.expiryStage === 'before').length;
    const expiryDuring = risks.filter(item => item.expiryStage === 'during').length;
    const expiryLoss = stage => {
      const items = risks.filter(item => item.expiryStage === stage);
      const calculable = items.filter(item => Number.isFinite(item.stockNum) && item.stockNum >= 0 && Number.isFinite(item.costNum) && item.costNum >= 0);
      return { amount: calculable.reduce((sum, item) => sum + item.stockNum * item.costNum, 0), missing: items.length - calculable.length };
    };
    const beforeLoss = expiryLoss('before');
    const duringLoss = expiryLoss('during');
    const expiredAtSnapshot = risks.filter(item => item.expiryStage === 'before' && item.expiryHours <= 19.5 + 1e-8).length;
    const expiryReview = risks.filter(item => item.riskTypes.includes('expiry') && !item.expiryStage).length;
    const dataCount = risks.filter(hasDataIssue).length;
    $('#kpi-items').textContent = money.format(promo.length);
    $('#kpi-items-context').textContent = `${money.format(stickerReady)} готовы к наклейке · ${money.format(promoBarcodeCount)} сверить код`;
    $('#kpi-writeoff').textContent = money.format(lowCount);
    $('#kpi-writeoff-rule').textContent = `Остаток: ${stockRuleText()}`;
    $('#kpi-margin').textContent = money.format(marginPromoCount);
    $('#kpi-margin-caption').textContent = requiresDirectorApproval() ? `${money.format(marginApproved)} из ${money.format(marginPromoCount)} цен согласовано` : 'Цены ограничены автоматически';
    $('#nav-approval-count').textContent = money.format(marginPromoCount);
    $('#approval-progress').textContent = requiresDirectorApproval() ? `${money.format(marginApproved)} из ${money.format(marginPromoCount)} цен согласовано` : `${money.format(marginPromoCount)} цен рассчитано автоматически`;
    $('#approval-mode-description').textContent = requiresDirectorApproval() ? 'Цены с MARGIN_ALERT ждут решения директора.' : 'Цены с MARGIN_ALERT рассчитаны. Директор может их изменить.';
    $('#decision-clarity').textContent = requiresDirectorApproval() ? 'Товары с MARGIN_ALERT входят в план после согласования цены. Затем итоговые цены передают в кассовую систему на 20:00. Бракераж может пересекаться со сроками годности, поэтому числа карточек не складываются.' : 'Для MARGIN_ALERT цена ограничена автоматически и входит в файл для касс. Кассовые цены применяют с 20:00; сайт сам их не отправляет. Бракераж может пересекаться со сроками годности, поэтому числа карточек не складываются.';
    $('#kpi-stock-value').textContent = fmtMoney(stockValue);
    $('#kpi-promo-value').textContent = fmtMoney(promoValue);
    $('#kpi-expired-before').textContent = money.format(expiryBefore);
    $('#kpi-expired-during').textContent = money.format(expiryDuring);
    $('#kpi-loss-before').textContent = fmtMoney(beforeLoss.amount);
    $('#kpi-loss-during').textContent = fmtMoney(duringLoss.amount);
    $('#kpi-loss-before-note').textContent = beforeLoss.missing ? `Расчёт неполный: ${money.format(beforeLoss.missing)} без остатка или себестоимости` : 'Остаток × себестоимость, если не продать';
    $('#kpi-loss-during-note').textContent = duringLoss.missing ? `Расчёт неполный: ${money.format(duringLoss.missing)} без остатка или себестоимости` : 'Остаток × себестоимость, если не продать';
    $('#kpi-already-expired').textContent = `${money.format(expiredAtSnapshot)} уже истекли на 19:30`;
    $('#calc-potential').textContent = fmtMoney(promoValue);
    $('#calc-discount-difference').textContent = fmtMoney(stockValue - promoValue);
    $('#calc-promo-count').textContent = money.format(promo.length);
    $('#calc-barcode-count').textContent = money.format(promoBarcodeCount);
    $('#nav-promo-count').textContent = money.format(promo.length);
    $('#nav-risk-count').textContent = money.format(risks.length);
    $('#tab-all-count').textContent = money.format(promo.length);
    $('#tab-ready-count').textContent = money.format(stickerReady);
    $('#tab-barcode-count').textContent = money.format(promoBarcodeCount);
    $('#tab-margin-count').textContent = money.format(marginPromoCount);
    $('#plan-ready-count').textContent = `${money.format(stickerReady)} из ${money.format(promo.length)}`;
    $('#plan-ready-label').textContent = money.format(stickerReady);
    $('#plan-code-pending').textContent = money.format(promoBarcodeCount);
    $('#plan-approval-pending').textContent = money.format(marginAwaitingApproval);
    $('#plan-ready-progress').style.width = `${promo.length ? (stickerReady / promo.length) * 100 : 0}%`;
    $('#plan-readiness').classList.toggle('complete', stickerReady === promo.length && promo.length > 0);
    $('#plan-readiness-title').textContent = stickerReady === promo.length && promo.length > 0 ? 'Весь план готов к наклейке' : 'Не весь план можно сразу отдавать на наклейку';
    $('#plan-readiness-note').textContent = stickerReady === promo.length && promo.length > 0 ? 'Цены рассчитаны, а штрихкоды проверены. Перед началом акции передайте кассовый файл и убедитесь, что цены применились.' : 'Для части позиций нужны сверка штрихкода или согласование цены. После фиксации цен передайте кассовый файл на применение с 20:00.';
    $('#download-ready').disabled = stickerReady === 0;
    $('#download-margin-count').textContent = money.format(marginPromoCount);
    $('#download-margin').disabled = marginPromoCount === 0;
    $('#download-pos-count').textContent = money.format(posExportable);
    $('#download-pos').disabled = posExportable === 0;
    $('#pos-export-note').textContent = `${requiresDirectorApproval() ? 'В файл включены только цены, утверждённые директором.' : 'В файл включены автоматически ограниченные цены; ждать директора не нужно.'} ${money.format(posExportable)} из ${money.format(marginPromoCount)} позиций готовы для передачи через API.${posBlockedBarcode ? ` ${money.format(posBlockedBarcode)} с ошибкой штрихкода не включены.` : ''} Скачивание не меняет цены на кассе.`;
    $('#risk-all-count').textContent = money.format(risks.length);
    $('#risk-data-count').textContent = money.format(dataCount);
    $('#risk-margin-count').textContent = money.format(marginCount);
    $('#risk-stock-count').textContent = money.format(lowCount);
    $('#risk-expiry-count').textContent = money.format(expiryCount);
    $('#expiry-all-count').textContent = money.format(expiryCount);
    $('#expiry-before-count').textContent = money.format(expiryBefore);
    $('#expiry-during-count').textContent = money.format(expiryDuring);
    $('#expiry-review-count').textContent = money.format(expiryReview);
    $('#expiry-alert').hidden = currentView !== 'upload' || expiryCount === 0;
    $('#expiry-alert-text').textContent = `${money.format(expiryBefore)} ${pluralRu(expiryBefore, 'позиция истечёт', 'позиции истекут', 'позиций истекут')} до 20:00, ${money.format(expiryDuring)} — во время скидки до закрытия в ${$('#closing-time').value}. Откройте исключения и проверьте товары.`;
    $('#upload-summary').textContent = `${money.format(promo.length)} к уценке · ${money.format(risks.length)} ${pluralRu(risks.length, 'позиция', 'позиции', 'позиций')} с отметками для проверки`;
    $('#dashboard-cta').hidden = sourceRows.length === 0;
    renderUnitErrors();
    renderCategories();
    renderCategoryDetail();
    renderPromo();
    renderApprovals();
    renderRiskSummary(dataCount, lowCount, expiryCount, expiryBefore, expiryDuring);
    renderRisks();
    renderBarcodePanel();
  }

  function renderUnitErrors() {
    const items = result.all.filter(item => item.riskCodes.includes('FRACTIONAL_PIECES'));
    $('#unit-error-notice').hidden = items.length === 0 || currentView !== 'upload';
    $('#unit-error-count').textContent = money.format(items.length);
    $('#unit-error-list').innerHTML = items.map(item => `<li><strong>${safe(item.name || 'Без названия')}</strong><span>${safe(fmtQty(item.stockNum, item.unit))} · строка ${safe(item.sourceRow || item.index + 2)}</span></li>`).join('');
  }

  function renderBarcodePanel() {
    const target = result.all.filter(item => item.categoryAllowed && item.riskTypes.includes('barcode'));
    const inPlan = target.filter(item => item.promo);
    const outsidePlan = target.filter(item => !item.promo);
    const renderRow = item => {
      const reason = barcodeIssue(item.barcode) || 'Штрихкод повторяется у нескольких товаров';
      const status = item.promo ? 'В плане · сверить код' : item.expiryStage === 'before' ? 'Не в плане · срок до 20:00' : item.expiryStage === 'during' ? 'Не в плане · срок во время скидки' : item.riskTypes.includes('stock') ? 'Не в плане · бракераж' : 'Не в плане · другая ошибка данных';
      return `<div class="barcode-row"><div class="barcode-row-product"><strong>${safe(item.name || 'Без названия')}</strong><small>Строка ${safe(item.sourceRow || item.index + 2)} · Код 1С ${safe(item.code || '—')}</small></div><div class="barcode-row-value">${item.barcode ? `<code>${safe(item.barcode)}</code>` : '<span class="barcode-missing">Пусто</span>'}</div><div class="barcode-row-reason">${safe(reason)}<small class="barcode-row-status ${item.promo ? 'in-plan' : ''}">${safe(status)}</small></div></div>`;
    };
    $('#barcode-count').textContent = money.format(inPlan.length);
    $('#barcode-title').firstChild.textContent = inPlan.length ? 'Требуется сверка кодов ' : 'В плане кодов для сверки нет ';
    $('#barcode-alert-icon').textContent = inPlan.length ? '!' : '✓';
    $('#barcode-kicker-text').textContent = inPlan.length ? 'ВНИМАНИЕ · ШТРИХКОДЫ В ПЛАНЕ' : 'ПРОВЕРКА ШТРИХКОДОВ';
    $('#barcode-caption').textContent = inPlan.length
      ? `До печати стикеров и настройки скидки сверьте в 1С коды ${money.format(inPlan.length)} позиций из плана уценки.`
      : 'Для подготовки вечерней уценки сверять коды не требуется.';
    $('#barcode-panel').classList.toggle('has-issues', inPlan.length > 0);
    $('#barcode-panel-note').hidden = inPlan.length === 0;
    $('#barcode-show-all').hidden = inPlan.length === 0;
    $('#barcode-list').innerHTML = inPlan.length ? inPlan.map(renderRow).join('') : '<div class="barcode-ok">✓ У товаров в плане нет замечаний по штрихкодам</div>';
    $('#barcode-blocked').hidden = outsidePlan.length === 0;
    $('#barcode-blocked-count').textContent = money.format(outsidePlan.length);
    $('#barcode-blocked-list').innerHTML = outsidePlan.map(renderRow).join('');
    $('#barcode-panel').hidden = currentView !== 'upload' || !result.all.some(item => item.categoryAllowed);
  }

  function renderCategories() {
    const groups = ALLOWED.map((category, index) => {
      const items = result.all.filter(item => item.category === category);
      const markedDown = items.filter(item => item.promo).length;
      const before = items.filter(item => item.expiryStage === 'before').length;
      const during = items.filter(item => item.expiryStage === 'during').length;
      const writeOff = items.filter(item => !item.promo && !item.expiryStage && item.riskTypes.includes('stock')).length;
      const writeOffOverlap = items.filter(item => item.expiryStage && item.riskTypes.includes('stock')).length;
      const adjusted = items.filter(item => item.promo && item.riskTypes.includes('margin')).length;
      return { category, index, total: items.length, markedDown, before, during, writeOff, writeOffOverlap, other: items.length - markedDown - before - during - writeOff, adjusted };
    });
    $('#category-list').innerHTML = groups.map(group => {
      const portion = count => group.total ? count / group.total * 100 : 0;
      const stats = `${money.format(group.markedDown)} к уценке, ${money.format(group.before)} срок до скидки, ${money.format(group.during)} срок во время скидки, ${money.format(group.writeOff)} только бракераж, ${money.format(group.other)} другие исключения${group.writeOffOverlap ? `, ${money.format(group.writeOffOverlap)} также на бракераж` : ''}, ${money.format(group.adjusted)} с корректировкой цены`;
      return `<button class="category-row category-link" data-category-index="${group.index}" aria-label="${safe(categoryShort(group.category))}: ${safe(stats)}. Всего ${money.format(group.total)} товаров. Открыть категорию"><span class="category-row-top"><span class="category-name">${safe(categoryShort(group.category))}</span><span class="category-total">Всего ${money.format(group.total)} <span aria-hidden="true">→</span></span></span><span class="category-bar" aria-hidden="true"><span class="category-bar-promo" style="width:${portion(group.markedDown)}%"></span><span class="category-bar-before" style="width:${portion(group.before)}%"></span><span class="category-bar-during" style="width:${portion(group.during)}%"></span><span class="category-bar-writeoff" style="width:${portion(group.writeOff)}%"></span><span class="category-bar-other" style="width:${portion(group.other)}%"></span></span><span class="category-row-stats"><span class="category-stat-promo">${money.format(group.markedDown)} к уценке</span>${group.before ? `<span class="category-stat-before">${money.format(group.before)} срок до 20:00</span>` : ''}${group.during ? `<span class="category-stat-during">${money.format(group.during)} во время скидки</span>` : ''}${group.writeOff ? `<span class="category-stat-writeoff">${money.format(group.writeOff)} только бракераж</span>` : ''}${group.other ? `<span class="category-stat-other">${money.format(group.other)} другие исключения</span>` : ''}</span><span class="category-extra">${group.writeOffOverlap ? `<span class="category-extra-overlap">${money.format(group.writeOffOverlap)} также на бракераж</span>` : ''}${group.adjusted ? `<span class="category-extra-margin">${money.format(group.adjusted)} с корректировкой цены</span>` : ''}</span></button>`;
    }).join('');
  }

  function categoryDecision(item) {
    if (item.expiryStage === 'before') return { label: 'Истечёт до скидки', style: 'block' };
    if (item.expiryStage === 'during') return { label: 'Истечёт во время акции', style: 'block' };
    if (item.riskTypes.includes('data')) return { label: 'Исправить данные', style: 'block' };
    if (item.riskTypes.includes('stock')) return { label: 'Бракераж', style: 'block' };
    if (item.riskTypes.includes('expiry')) return { label: 'Проверить срок', style: 'warn' };
    if (item.promo && item.riskTypes.includes('barcode')) return { label: 'К уценке после сверки штрихкода' + (item.riskTypes.includes('margin') && !isMarginPriceSet(item) ? ' и согласования цены' : ''), style: 'warn' };
    if (item.promo && item.riskTypes.includes('margin')) return isMarginPriceSet(item) ? { label: 'Итоговая цена определена', style: 'good' } : { label: 'Ожидает согласования цены', style: 'warn' };
    return { label: 'К уценке', style: 'good' };
  }

  function renderCategoryDetail() {
    const category = ALLOWED[activeCategoryIndex];
    const items = result.all.filter(item => item.category === category);
    const count = key => items.filter(item => key === 'all' || (key === 'promo' ? item.promo : key === 'before' || key === 'during' ? item.expiryStage === key : key === 'data' ? hasDataIssue(item) : item.riskTypes.includes(key))).length;
    $('#category-tabs').innerHTML = ALLOWED.map((name, index) => `<button class="category-tab ${index === activeCategoryIndex ? 'active' : ''}" data-category-index="${index}"><span>${safe(categoryShort(name))}</span><strong>${money.format(result.all.filter(item => item.category === name).length)}</strong></button>`).join('');
    $('#category-detail-title').textContent = categoryShort(category);
    $('#category-detail-subtitle').textContent = `${money.format(count('promo'))} к уценке · ${money.format(count('before'))} истекут до 20:00 · ${money.format(count('during'))} во время скидки`;
    $('#category-total').textContent = `${money.format(items.length)} ${pluralRu(items.length, 'позиция', 'позиции', 'позиций')} в файле`;
    $('#category-metrics').innerHTML = `<div class="category-metric"><span>Всего в выгрузке</span><strong>${money.format(items.length)}</strong></div><div class="category-metric good"><span>К уценке</span><strong>${money.format(count('promo'))}</strong></div><div class="category-metric bad"><span>До 20:00</span><strong>${money.format(count('before'))}</strong></div><div class="category-metric bad"><span>Во время скидки</span><strong>${money.format(count('during'))}</strong></div><div class="category-metric warn"><span>Ошибки данных</span><strong>${money.format(count('data'))}</strong></div><div class="category-metric warn"><span>Бракераж</span><strong>${money.format(count('stock'))}</strong></div>`;
    for (const key of ['all', 'promo', 'before', 'during', 'data', 'stock']) $(`#category-filter-${key}`).textContent = money.format(count(key));
    $$('.category-filter').forEach(button => button.classList.toggle('active', button.dataset.categoryFilter === categoryFilter));
    const query = clean($('#category-search').value).toLowerCase();
    const rows = items.filter(item => (categoryFilter === 'all' || (categoryFilter === 'promo' ? item.promo : categoryFilter === 'before' || categoryFilter === 'during' ? item.expiryStage === categoryFilter : categoryFilter === 'data' ? hasDataIssue(item) : item.riskTypes.includes(categoryFilter))) && (!query || `${item.name} ${item.barcode} ${item.code} ${item.reasons.join(' ')}`.toLowerCase().includes(query)));
    $('#category-body').innerHTML = rows.map(item => { const decision = categoryDecision(item); return `<tr><td>${productCell(item)}</td><td><span class="barcode">${safe(item.barcode || '—')}</span></td><td><span class="stock-value">${Number.isFinite(item.stockNum) ? safe(fmtQty(item.stockNum, item.unit)) : '—'}</span></td><td class="numeric">${Number.isFinite(item.retailNum) ? fmtMoney(item.retailNum) : '—'}</td><td class="numeric new-price">${item.promo ? fmtMoney(item.newPrice) : '—'}</td><td>${Number.isFinite(item.expiryHours) ? safe(timeLabel(item.expiryHours)) : 'Нет данных'}</td><td><div class="category-decision"><span class="status-tag ${decision.style}">${safe(decision.label)}</span>${item.reasons.length ? `<small>${safe(item.reasons.join(' '))}</small>` : ''}</div></td></tr>`; }).join('');
    $('#category-empty').hidden = rows.length > 0;
    $('#category-footer-count').textContent = `Показано ${money.format(rows.length)} из ${money.format(items.length)} товаров`;
  }

  function productCell(item) {
    return `<div class="product-cell"><span class="product-dot">${safe(initials(item.name))}</span><div><div class="product-name" title="${safe(item.name)}">${safe(item.name)}</div><div class="product-sub">Код 1С ${safe(item.code || '—')}</div></div></div>`;
  }
  function renderPromo() {
    const query = clean($('#promo-search').value).toLowerCase();
    const rows = result.promo.filter(item => (promoFilter === 'all' || (promoFilter === 'ready' ? isStickerReady(item) : item.riskTypes.includes(promoFilter))) && (!query || `${item.name} ${item.barcode} ${item.category}`.toLowerCase().includes(query)));
    $('#promo-body').innerHTML = rows.map(item => { const marks = []; if (isStickerReady(item)) marks.push('<span class="status-tag">Готово к наклейке</span>'); if (item.riskTypes.includes('barcode')) marks.push('<span class="status-tag warn">Проверить штрихкод до стикера</span>'); if (item.riskTypes.includes('margin')) marks.push(`<span class="status-tag ${isMarginPriceSet(item) ? '' : 'warn'}">${isMarginPriceSet(item) ? 'MARGIN_ALERT · итоговая цена определена' : 'MARGIN_ALERT · согласовать цену'}</span>`); return `<tr><td>${productCell(item)}</td><td><span class="barcode">${safe(item.barcode || '—')}</span></td><td><span class="category-tag" title="${safe(item.category)}">${safe(categoryShort(item.category))}</span></td><td class="numeric">${fmtMoney(item.retailNum)}</td><td class="numeric new-price">${fmtMoney(item.newPrice)}</td><td><span class="stock-value">${safe(fmtQty(item.stockNum, item.unit))}</span></td><td><div class="promo-flags">${marks.join('')}</div></td></tr>`; }).join('');
    $('#promo-empty').hidden = rows.length > 0;
    $('#promo-empty').textContent = query ? 'По запросу ничего не найдено.' : promoFilter === 'ready' ? 'Пока нет позиций, готовых к наклейке.' : 'В этом фильтре нет товаров.';
    $('#promo-footer-count').textContent = `Показано ${money.format(rows.length)} из ${money.format(result.promo.length)} позиций`;
    $$('.table-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tableTab === promoFilter));
  }
  function renderApprovals() {
    const items = result.promo.filter(item => item.riskTypes.includes('margin'));
    const directorRequired = requiresDirectorApproval();
    $('#approval-list').innerHTML = items.length ? items.map(item => {
      const floor = roundUp5(item.marginFloor);
      const approved = isMarginApproved(item);
      const key = safe(approvalKey(item));
      const status = directorRequired && !approved ? 'Ожидает решения директора' : approved ? 'Цена утверждена · для кассового файла' : 'Цена рассчитана · для кассового файла';
      const stamp = approved ? `<small>Утвердил(а): ${safe(item.approval.by)} · ${safe(new Date(item.approval.at).toLocaleString('ru-KZ'))}</small>` : '';
      return `<article class="approval-card" data-approval-key="${key}"><div class="approval-card-top"><div><span class="approval-category">${safe(categoryShort(item.category))} · Код 1С ${safe(item.code || '—')}</span><h3>${safe(item.name)}</h3><span class="approval-stock">${safe(fmtQty(item.stockNum, item.unit))} · ${safe(item.barcode || 'Штрихкод отсутствует')}</span></div><span class="approval-state ${isMarginPriceSet(item) ? 'ready' : ''}">${status}</span></div><div class="approval-metrics"><div><span>Старая цена</span><strong>${fmtMoney(item.retailNum)}</strong></div><div><span>По правилу −30%</span><strong>${fmtMoney(roundDown5(item.price30))}</strong></div><div><span>Минимум с маржой</span><strong>${fmtMoney(floor)}</strong></div><div><span>Цена к продаже</span><strong>${fmtMoney(item.newPrice)}</strong></div></div><div class="approval-edit"><label>${directorRequired ? 'Утверждаемая цена, ₸' : 'Изменить цену директором (необязательно), ₸'}<input class="approval-price" type="number" min="${floor}" max="${roundDown5(item.retailNum - 1e-8)}" step="5" value="${item.newPrice}" aria-label="Цена для ${safe(item.name)}"></label><label>Комментарий директора<input class="approval-comment" type="text" maxlength="180" value="${approved ? safe(item.approval.comment) : ''}" placeholder="Необязательно"></label><button class="button button-dark approval-save" type="button">${approved ? 'Обновить решение' : directorRequired ? 'Утвердить цену' : 'Сохранить решение директора'}</button></div><div class="approval-draft" hidden>Новая цена пока не сохранена. В плане действует ${fmtMoney(item.newPrice)}.</div>${stamp ? `<div class="approval-card-bottom">${stamp}</div>` : ''}<div class="approval-error" role="alert" hidden></div></article>`;
    }).join('') : '<div class="approval-empty">Позиций с MARGIN_ALERT в этой выгрузке нет.</div>';
  }
  function riskClass(item) {
    return item.riskCodes.join(' · ') || 'REVIEW';
  }
  function riskStatus(item) {
    const labels = { data: 'Ошибки данных', barcode: item.promo ? 'Проверить штрихкод' : 'Ошибка штрихкода', expiry: 'Срок годности', stock: 'Бракераж', margin: 'Маржа' };
    return item.riskTypes.map(type => labels[type] || type).join(' · ');
  }
  function renderRisks() {
    const query = clean($('#risk-search').value).toLowerCase();
    const rows = result.risks.filter(item => (riskFilter === 'all' || (riskFilter === 'data' ? hasDataIssue(item) : item.riskTypes.includes(riskFilter))) && (riskFilter !== 'expiry' || expiryFilter === 'all' || (expiryFilter === 'review' ? !item.expiryStage : item.expiryStage === expiryFilter)) && (!query || `${item.name} ${item.barcode} ${item.category} ${item.reasons.join(' ')}`.toLowerCase().includes(query)));
    $('#risk-body').innerHTML = rows.map(item => `<tr><td>${productCell(item)}</td><td><span class="barcode">${safe(item.barcode || '—')}</span></td><td><span class="category-tag" title="${safe(item.category)}">${safe(categoryShort(item.category) || 'Нет категории')}</span></td><td><span class="stock-value">${Number.isFinite(item.stockNum) ? safe(fmtQty(item.stockNum, item.unit)) : '—'}</span></td><td><div class="risk-cell"><span class="status-tag ${item.promo || item.riskTypes.includes('margin') ? 'warn' : 'block'}">${safe(riskStatus(item))}</span><span class="risk-code">${safe(riskClass(item))}</span></div></td><td><div class="risk-reason">${safe(item.reasons.join(' '))}${item.action ? `<br><strong>${safe(item.action)}</strong>` : ''}</div></td></tr>`).join('');
    $('#risk-empty').hidden = rows.length > 0;
    $('#risk-empty').textContent = query ? 'По запросу ничего не найдено.' : 'В этой группе нет товаров.';
    $('#risk-footer-count').textContent = `Показано ${money.format(rows.length)} из ${money.format(result.risks.length)} записей`;
    $('#expiry-filters').hidden = riskFilter !== 'expiry';
    $$('.risk-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.riskFilter === riskFilter));
    $$('.expiry-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.expiryFilter === expiryFilter));
    $$('[data-risk-card]').forEach(card => card.classList.toggle('active', card.dataset.riskCard === riskFilter));
  }
  function renderRiskSummary(data, stock, expiry, before, during) {
    $('#risk-summary').innerHTML = `<button class="risk-summary-card amber" data-risk-card="data"><span>Проверка выгрузки</span><strong>${money.format(data)}</strong><small>Ошибки данных и штрихкодов</small></button><button class="risk-summary-card green" data-risk-card="stock"><span>Бракераж</span><strong>${money.format(stock)}</strong><small>${stockRuleText()}</small></button><button class="risk-summary-card red" data-risk-card="expiry"><span>Срок годности</span><strong>${money.format(expiry)}</strong><small>${money.format(before)} до 20:00 · ${money.format(during)} во время скидки</small></button>`;
  }

  function mapHeader(headerRow) {
    const names = headerRow.map(value => clean(value));
    const positions = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      positions[field] = names.findIndex(name => aliases.some(alias => name.toLowerCase() === alias.toLowerCase()));
    }
    const required = ['barcode', 'name', 'category', 'stock', 'unit', 'retail', 'cost'];
    const missing = required.filter(field => positions[field] < 0);
    if (missing.length) throw new Error(`Не найдены обязательные колонки: ${missing.map(field => FIELD_ALIASES[field][0]).join(', ')}`);
    return positions;
  }
  function excelValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && value.text) return value.text;
    if (typeof value === 'object' && value.richText) return value.richText.map(part => part.text).join('');
    if (typeof value === 'object' && value.hyperlink) return value.text || value.hyperlink;
    if (typeof value === 'object' && 'result' in value) return value.result;
    return value;
  }
  async function readExcel(file) {
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(await file.arrayBuffer()); }
    catch { throw new Error('Не удалось прочитать книгу .xlsx. Проверьте, что файл не повреждён, и сохраните его повторно в Excel или 1С.'); }
    let sheet = null, headerRow = 0, positions = null, bestHeader = null, bestScore = 0;
    for (const candidate of workbook.worksheets) {
      candidate.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (sheet || rowNumber > 30) return;
        const values = row.values.slice(1).map(excelValue);
        const names = values.map(value => clean(value).toLowerCase());
        const score = ['barcode', 'name', 'category', 'stock', 'unit', 'retail', 'cost']
          .filter(field => FIELD_ALIASES[field].some(alias => names.includes(alias.toLowerCase()))).length;
        if (score > bestScore) { bestScore = score; bestHeader = values; }
        try { positions = mapHeader(values); sheet = candidate; headerRow = rowNumber; }
        catch { positions = null; }
      });
      if (sheet) break;
    }
    if (!sheet) {
      if (bestHeader && bestScore >= 2) mapHeader(bestHeader);
      if (!workbook.worksheets.some(ws => ws.rowCount > 0)) throw new Error('В книге нет листа с данными.');
      throw new Error('Не найдена таблица с обязательными заголовками в первых 30 строках листов.');
    }
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const values = row.values.slice(1).map(excelValue);
      if (values.every(value => clean(value) === '')) return;
      const item = {};
      for (const [field, index] of Object.entries(positions)) item[field] = index >= 0 ? excelValue(values[index]) : '';
      item.barcode = item.barcode === '' ? '' : String(item.barcode).replace(/\.0$/, '');
      item.sourceRow = rowNumber;
      rows.push(item);
    });
    if (!rows.length) throw new Error('В файле есть заголовки, но нет строк с товарами.');
    return rows;
  }
  function selectPipelineRows(rows) {
    const included = [];
    const excludedCategories = new Map();
    rows.forEach(row => {
      const category = normalizeCategory(row.category);
      if (category && !ALLOWED.includes(category)) {
        excludedCategories.set(category, (excludedCategories.get(category) || 0) + 1);
      } else {
        included.push(row);
      }
    });
    return { included, excludedCategories };
  }
  async function loadFile(file) {
    resetLoadedState();
    if (!file || !/\.xlsx$/i.test(file.name)) { showUploadError('Выберите файл .xlsx с выгрузкой остатков из 1С.'); return; }
    if (file.size === 0) { showUploadError('Файл пустой. Загрузите выгрузку с заголовками и товарами.'); return; }
    $('#upload-progress').classList.add('active');
    try {
      const rows = await readExcel(file);
      const { included, excludedCategories } = selectPipelineRows(rows);
      sourceRows = included;
      const excludedCount = rows.length - included.length;
      currentFileName = file.name;
      const bytes = await file.arrayBuffer();
      let hash;
      if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      } else {
        let checksum = 0xcbf29ce484222325n;
        for (const byte of new Uint8Array(bytes)) checksum = BigInt.asUintN(64, (checksum ^ BigInt(byte)) * 0x100000001b3n);
        hash = `${bytes.byteLength}-${checksum.toString(16)}`;
      }
      const now = new Date();
      const cycleDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      approvalStorageKey = `ayan-evening-approvals:${cycleDate}:${hash}`;
      restoreApprovals();
      $('#upload-title').textContent = file.name;
      $('#upload-caption').textContent = `${money.format(rows.length)} ${pluralRu(rows.length, 'строка', 'строки', 'строк')} в файле · ${money.format(included.length)} ${pluralRu(included.length, 'участвует', 'участвуют', 'участвуют')} в обработке`;
      $('#scope-excluded-count').textContent = money.format(excludedCount);
      $('#scope-categories').innerHTML = [...excludedCategories.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => `<span>${safe(categoryShort(category))} · ${money.format(count)}</span>`).join('');
      $('#scope-notice').hidden = excludedCount === 0;
      $('#scope-empty').hidden = included.length > 0;
      $('#file-state').innerHTML = '<i></i> Файл обработан';
      $('#file-state').classList.add('loaded');
      $('#choose-file').innerHTML = 'Загрузить другой файл <span>↗</span>';
      $('#empty-state').hidden = true;
      render();
      nav('upload');
      showToast(included.length ? `Готово: ${money.format(included.length)} ${pluralRu(included.length, 'строка', 'строки', 'строк')} в обработке` : 'В файле нет целевых товаров');
    } catch (error) {
      showUploadError(error.message || 'Не удалось прочитать файл. Проверьте структуру выгрузки.');
    } finally {
      $('#upload-progress').classList.remove('active');
    }
  }

  function showUploadError(message) {
    $('#upload-error-text').textContent = message;
    $('#upload-error').hidden = false;
    showToast('Проверьте файл выгрузки');
  }

  function resetLoadedState() {
    pendingMarginImport = null;
    if ($('#margin-import-dialog').open) $('#margin-import-dialog').close();
    sourceRows = [];
    result = { promo: [], risks: [], all: [] };
    currentFileName = '';
    approvalStorageKey = '';
    approvals = {};
    currentView = 'upload';
    riskFilter = 'all';
    expiryFilter = 'all';
    activeCategoryIndex = 0;
    categoryFilter = 'all';
    $('#upload-error').hidden = true;
    $('#scope-notice').hidden = true;
    $('#scope-empty').hidden = true;
    $('#barcode-panel').hidden = true;
    $('#unit-error-notice').hidden = true;
    $('#barcode-blocked').open = false;
    $('#expiry-alert').hidden = true;
    $('#dashboard-cta').hidden = true;
    $('#empty-state').hidden = false;
    $$('[data-view]').forEach(section => section.hidden = true);
    $('[data-view="upload"]').hidden = false;
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.nav === 'upload'));
    ['nav-promo-count', 'nav-risk-count', 'nav-approval-count'].forEach(id => $(`#${id}`).textContent = '—');
    $('#upload-title').textContent = 'Загрузите выгрузку из 1С';
    $('#upload-caption').textContent = 'Перетащите файл сюда или выберите его на компьютере · .xlsx';
    $('#file-state').innerHTML = '<i></i> Файл не загружен';
    $('#file-state').classList.remove('loaded');
    $('#choose-file').innerHTML = 'Загрузить Excel <span>↗</span>';
  }

  function nav(view) {
    if (view !== 'upload' && !sourceRows.length) { showToast('Сначала загрузите выгрузку.'); return; }
    currentView = view;
    $('#barcode-panel').hidden = view !== 'upload' || !result.all.some(item => item.categoryAllowed);
    $('#unit-error-notice').hidden = view !== 'upload' || !result.all.some(item => item.riskCodes.includes('FRACTIONAL_PIECES'));
    $('#expiry-alert').hidden = view !== 'upload' || !result.risks.some(item => item.riskTypes.includes('expiry'));
    $$('[data-view]').forEach(section => section.hidden = section.dataset.view !== view);
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.nav === view));
    if (view === 'stickers') renderPromo();
    if (view === 'approvals') renderApprovals();
    if (view === 'categories') renderCategoryDetail();
    if (view === 'exceptions') renderRisks();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function excelCell(value, numFmt) {
    return { value: value ?? '', numFmt: numFmt || undefined };
  }
  function styleHeader(row) {
    row.height = 26;
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF193B2B' } };
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF193B2B' } } };
    });
  }
  function styleBody(sheet, startRow = 2) {
    for (let r = startRow; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      row.height = 23;
      row.eachCell(cell => {
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF34443A' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE8EDE8' } } };
      });
      if (r % 2 === 1) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBF9' } }; });
    }
  }
  function setTableLayout(sheet, widths, autofilter = true) {
    sheet.columns = widths.map(width => ({ width }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (autofilter && sheet.rowCount > 1) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  function fillPromoSheet(sheet, items = result.promo) {
    const headers = ['Наименование', 'Штрихкод', 'Категория', 'Старая цена, тг', 'Новая цена, тг', 'Остаток', 'Ед. изм.', 'Отметка'];
    sheet.addRow(headers);
    styleHeader(sheet.getRow(1));
    const orderedItems = [...items].sort((a, b) => ALLOWED.indexOf(a.category) - ALLOWED.indexOf(b.category) || a.index - b.index);
    const adjustedRows = new Map(items.filter(item => item.riskTypes.includes('margin')).map((item, index) => [approvalKey(item), index + 2]));
    orderedItems.forEach((item, index) => {
      const marks = [];
      if (isStickerReady(item)) marks.push('Готово к наклейке');
      if (item.riskTypes.includes('barcode')) marks.push('BARCODE_REVIEW · сверить код в 1С до наклейки');
      if (item.riskTypes.includes('margin')) marks.push(isMarginPriceSet(item) ? `MARGIN_ALERT · итоговая цена ${fmtMoney(item.newPrice)}; передать на кассу` : 'MARGIN_ALERT · не клеить до согласования цены');
      const mark = marks.join('; ');
      const rowNumber = index + 2;
      const priceFormula = item.riskTypes.includes('margin')
        ? `'Цена скорректирована'!K${adjustedRows.get(approvalKey(item))}`
        : `ROUNDDOWN((D${rowNumber}*0.7+1E-8)/5,0)*5`;
      sheet.addRow([item.name, String(item.barcode), item.category, item.retailNum, { formula: priceFormula, result: item.newPrice }, item.stockNum, item.unit, mark]);
    });
    setTableLayout(sheet, [43, 18, 32, 17, 17, 12, 12, 48]);
    styleBody(sheet);
    for (let r = 2; r <= sheet.rowCount; r++) {
      sheet.getCell(r, 2).numFmt = '@';
      [4, 5].forEach(col => sheet.getCell(r, col).numFmt = '#,##0.00');
      sheet.getCell(r, 6).numFmt = '#,##0.00';
      const note = String(sheet.getCell(r, 8).value ?? '');
      if (note.includes('ALERT') || note.includes('BARCODE_REVIEW')) {
        sheet.getCell(r, 8).font = { name: 'Aptos', size: 9, bold: true, color: { argb: isStickerReady(orderedItems[r - 2]) ? 'FF176B43' : 'FF966516' } };
        sheet.getRow(r).height = 38;
      }
    }
  }
  function fillRiskSheet(sheet, items = result.risks) {
    sheet.addRow(['Наименование', 'Штрихкод', 'Категория', 'Остаток', 'Ед. изм.', 'Статус', 'Код риска', 'Причина', 'Рекомендуемое действие']);
    styleHeader(sheet.getRow(1));
    items.forEach(item => sheet.addRow([item.name, String(item.barcode), item.category, Number.isFinite(item.stockNum) ? item.stockNum : '', item.unit, riskStatus(item), item.riskCodes.join(', '), item.reasons.join(' '), item.action]));
    setTableLayout(sheet, [43, 18, 32, 12, 12, 17, 28, 65, 29]);
    styleBody(sheet);
    for (let r = 2; r <= sheet.rowCount; r++) {
      sheet.getCell(r, 2).numFmt = '@';
      sheet.getCell(r, 4).numFmt = '#,##0.00';
      sheet.getRow(r).height = 34;
    }
  }
  function fillAdjustedPriceSheet(sheet, items) {
    sheet.addRow(['Наименование', 'Код 1С', 'Штрихкод', 'Категория', 'Остаток', 'Ед. изм.', 'Старая цена, тг', 'Цена −30%, тг', 'Себестоимость, тг', 'Порог +5%, тг', 'Новая цена, тг', 'Фактическая скидка', 'Проверка штрихкода', 'Причина корректировки', 'Решение', 'Утвердил', 'Дата и время']);
    styleHeader(sheet.getRow(1));
    sheet.getRow(1).height = 42;
    items.forEach((item, index) => {
      const rowNumber = index + 2;
      sheet.addRow([
      item.name, String(item.code || ''), String(item.barcode || ''), item.category, item.stockNum, item.unit,
      item.retailNum, { formula: `ROUNDDOWN((G${rowNumber}*0.7+1E-8)/5,0)*5`, result: roundDown5(item.price30) },
      item.costNum, { formula: `I${rowNumber}*1.05`, result: item.marginFloor }, item.newPrice,
      { formula: `1-K${rowNumber}/G${rowNumber}`, result: 1 - item.newPrice / item.retailNum },
      item.riskTypes.includes('barcode') ? 'Сверить в 1С' : 'Без замечаний',
      item.reasons.find(reason => reason.includes('Скидка −30%')) || 'Цена со скидкой 30% ниже себестоимости +5%.',
      isMarginApproved(item) ? 'Утверждено' : requiresDirectorApproval() ? 'Ожидает' : 'Не требуется', item.approval?.by || '', item.approval?.at ? new Date(item.approval.at).toLocaleString('ru-KZ') : ''
      ]);
    });
    setTableLayout(sheet, [43, 13, 19, 32, 12, 12, 18, 18, 19, 18, 18, 19, 18, 60, 17, 23, 25]);
    sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
    styleBody(sheet);
    for (let r = 2; r <= sheet.rowCount; r++) {
      [2, 3].forEach(col => sheet.getCell(r, col).numFmt = '@');
      [5, 7, 8, 9, 10, 11].forEach(col => sheet.getCell(r, col).numFmt = '#,##0.00');
      sheet.getCell(r, 12).numFmt = '0.0%';
      sheet.getRow(r).height = 36;
    }
  }
  function createWorkbook() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Вечерняя уценка · локальный инструмент';
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    const promo = result.promo;
    const risks = result.risks;
    const overview = workbook.addWorksheet('Сводка');
    overview.columns = [{ width: 38 }, { width: 22 }, { width: 4 }, { width: 38 }, { width: 48 }];
    overview.mergeCells('A1:E1');
    overview.getCell('A1').value = 'ИТОГИ ВЕЧЕРНЕЙ УЦЕНКИ';
    overview.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FF193B2B' } };
    overview.getRow(1).height = 34;
    overview.mergeCells('A2:E2');
    overview.getCell('A2').value = `Источник: ${currentFileName} · Срез 19:30 · Акция 20:00–${$('#closing-time').value}`;
    overview.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF718077' } };
    const values = [
      ['Показатель', 'Значение', '', 'Метод расчёта', ''],
      ['Позиций в плане уценки', promo.length, '', 'Скидка', '30% от розничной цены'],
      ['Позиций в целевых категориях', result.all.filter(item => item.categoryAllowed).length, '', 'Нижняя цена', 'Себестоимость × 1,05'],
      ['Стоимость акционного остатка по старой цене, тг', promo.reduce((sum, item) => sum + item.stockRetailValue, 0), '', 'Округление', 'Вниз до 5 тг; ниже порога — вверх до 5 тг'],
      ['Потенциал выручки по новой цене, тг', promo.reduce((sum, item) => sum + item.promoValue, 0), '', 'Порог бракеража', `${stockRuleText()} — бракераж`],
      ['Исключений и рисков', risks.length, '', 'Проверка срока годности', `Срок должен быть действителен до закрытия в ${$('#closing-time').value}`],
      ['Позиций для сверки штрихкода в плане', promo.filter(item => item.riskTypes.includes('barcode')).length, '', 'Важное допущение', 'Потенциал рассчитан при продаже всего остатка'],
      ['Цен MARGIN_ALERT утверждено', promo.filter(isMarginApproved).length, '', 'Режим MARGIN_ALERT', requiresDirectorApproval() ? 'Согласование директора обязательно' : 'Цена ограничивается автоматически'],
      ['Цен готово для кассового файла', promo.filter(isPOSExportable).length, '', 'Применение в кассе', 'Передать итоговые цены на 20:00 без повторных −30%'],
      ['Проверка остатка в шт', $('#whole-units-only').checked ? 'Только целые' : 'Дробь допустима', '', 'Источник данных', currentFileName]
    ];
    values.forEach(row => overview.addRow(row));
    const overviewHead = overview.getRow(3);
    styleHeader(overviewHead);
    for (let r = 4; r <= 12; r++) {
      const row = overview.getRow(r);
      row.height = 25;
      [1, 4].forEach(c => row.getCell(c).font = { name: 'Aptos', size: 10, bold: c === 1, color: { argb: c === 1 ? 'FF34443A' : 'FF718077' } });
      row.getCell(2).font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF176B43' } };
      [1, 2, 4, 5].forEach(c => row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE8EDE8' } } });
    }
    for (const rowNum of [6, 7]) overview.getCell(rowNum, 2).numFmt = '#,##0.00';
    overview.views = [{ state: 'frozen', ySplit: 3 }];
    const plan = workbook.addWorksheet('План 19-40');
    fillPromoSheet(plan, promo);
    const adjustedSheet = workbook.addWorksheet('Цена скорректирована');
    fillAdjustedPriceSheet(adjustedSheet, promo.filter(item => item.riskTypes.includes('margin')));
    const writeoffSheet = workbook.addWorksheet('Бракераж');
    fillRiskSheet(writeoffSheet, risks.filter(item => item.riskTypes.includes('stock')));
    const exceptions = workbook.addWorksheet('Исключения');
    fillRiskSheet(exceptions, risks);
    const dataSheet = workbook.addWorksheet('Проверка целевых');
    fillRiskSheet(dataSheet, risks.filter(hasDataIssue));
    const expirySheet = workbook.addWorksheet('Срок годности');
    fillRiskSheet(expirySheet, risks.filter(item => item.riskTypes.includes('expiry')));
    if (promo.length) {
      const lastPromoRow = promo.length + 1;
      overview.getCell('B4').value = { formula: `COUNTA('План 19-40'!A2:A${lastPromoRow})`, result: promo.length };
      overview.getCell('B6').value = { formula: `SUMPRODUCT('План 19-40'!D2:D${lastPromoRow},'План 19-40'!F2:F${lastPromoRow})`, result: promo.reduce((sum, item) => sum + item.stockRetailValue, 0) };
      overview.getCell('B7').value = { formula: `SUMPRODUCT('План 19-40'!E2:E${lastPromoRow},'План 19-40'!F2:F${lastPromoRow})`, result: promo.reduce((sum, item) => sum + item.promoValue, 0) };
      overview.getCell('B9').value = { formula: `COUNTIFS('План 19-40'!H2:H${lastPromoRow},"*BARCODE_REVIEW*")`, result: promo.filter(item => item.riskTypes.includes('barcode')).length };
    }
    if (risks.length) overview.getCell('B8').value = { formula: `COUNTA('Исключения'!A2:A${risks.length + 1})`, result: risks.length };
    const adjustedCount = promo.filter(item => item.riskTypes.includes('margin')).length;
    if (adjustedCount) overview.getCell('B10').value = { formula: `COUNTIFS('Цена скорректирована'!O2:O${adjustedCount + 1},"Утверждено")`, result: promo.filter(isMarginApproved).length };
    return workbook;
  }
  function createReadyWorkbook(items) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Вечерняя уценка · локальный инструмент';
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    fillPromoSheet(workbook.addWorksheet('Готовы к наклейке'), items);
    const adjustedItems = items.filter(item => item.riskTypes.includes('margin'));
    if (adjustedItems.length) fillAdjustedPriceSheet(workbook.addWorksheet('Цена скорректирована'), adjustedItems);
    return workbook;
  }
  function createMarginApprovalWorkbook(items) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Вечерняя уценка · локальный инструмент';
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    const sheet = workbook.addWorksheet('Согласование цен');
    sheet.columns = [43, 13, 19, 32, 12, 11, 16, 20, 18, 20, 22, 16, 20, 60, 18, 22, 30, 24, 24].map(width => ({ width }));
    sheet.mergeCells('A1:S1');
    sheet.getCell('A1').value = requiresDirectorApproval() ? 'СОГЛАСОВАНИЕ ЦЕН · MARGIN_ALERT' : 'РЕЕСТР ОГРАНИЧЕННЫХ ЦЕН · MARGIN_ALERT';
    sheet.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FF193B2B' } };
    sheet.getRow(1).height = 34;
    sheet.mergeCells('A2:S2');
    sheet.getCell('A2').value = `Источник: ${currentFileName} · Срез 19:30 · ${items.length} позиций с ограниченной скидкой. Итоговую цену передать на кассу для применения с 20:00 без повторных −30%.`;
    sheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF718077' } };
    sheet.getRow(2).height = 24;
    sheet.addRow(['Наименование', 'Код 1С', 'Штрихкод', 'Категория', 'Остаток', 'Ед. изм.', 'Старая цена, тг', 'Цена −30% после округления, тг', 'Себестоимость, тг', 'Мин. цена +5%, тг', 'Цена к продаже, тг', 'Фактическая скидка', 'Срок до', 'Причина ограничения', 'Проверить штрихкод', 'Решение директора', 'Комментарий директора', 'Утвердил', 'Дата и время']);
    styleHeader(sheet.getRow(3));
    sheet.getRow(3).height = 42;
    items.forEach((item, index) => {
      const rowNumber = index + 4;
      sheet.addRow([
      item.name, String(item.code || ''), String(item.barcode || ''), item.category, item.stockNum, item.unit,
      item.retailNum, { formula: `ROUNDDOWN((G${rowNumber}*0.7+1E-8)/5,0)*5`, result: roundDown5(item.price30) },
      item.costNum, { formula: `I${rowNumber}*1.05`, result: item.marginFloor }, item.newPrice,
      { formula: `1-K${rowNumber}/G${rowNumber}`, result: 1 - item.newPrice / item.retailNum }, Number.isFinite(item.expiryHours) ? timeLabel(item.expiryHours) : '',
      item.reasons.find(reason => reason.includes('Скидка −30%')) || 'Цена со скидкой 30% ниже допустимой себестоимости +5%.',
      item.riskTypes.includes('barcode') ? 'Да · сверить в 1С' : 'Нет', isMarginApproved(item) ? 'Утверждено' : requiresDirectorApproval() ? 'Ожидает' : 'Не требуется', item.approval?.comment || '', item.approval?.by || '', item.approval?.at ? new Date(item.approval.at).toLocaleString('ru-KZ') : ''
      ]);
    });
    styleBody(sheet, 4);
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, sheet.rowCount), column: 19 } };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    for (let r = 4; r <= sheet.rowCount; r++) {
      sheet.getRow(r).height = 42;
      [2, 3].forEach(col => sheet.getCell(r, col).numFmt = '@');
      [5, 7, 8, 9, 10, 11].forEach(col => sheet.getCell(r, col).numFmt = '#,##0.00');
      sheet.getCell(r, 12).numFmt = '0.0%';
      [16, 17, 18, 19].forEach(col => { sheet.getCell(r, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7E8' } }; });
    }
    return workbook;
  }
  async function downloadWorkbook(mode) {
    if (!result.all.length) { showToast('Сначала загрузите выгрузку.'); return; }
    const readyItems = mode === 'ready' ? result.promo.filter(isStickerReady) : [];
    if (mode === 'ready' && !readyItems.length) { showToast('Пока нет товаров, готовых к наклейке.'); return; }
    const approvalItems = mode === 'margin' ? result.promo.filter(item => item.riskTypes.includes('margin')) : [];
    if (mode === 'margin' && !approvalItems.length) { showToast('Позиций с MARGIN_ALERT нет.'); return; }
    const workbook = mode === 'ready' ? createReadyWorkbook(readyItems) : mode === 'margin' ? createMarginApprovalWorkbook(approvalItems) : createWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = mode === 'ready' ? 'Готовы_к_наклейке_19_40.xlsx' : mode === 'margin' ? requiresDirectorApproval() ? 'На_согласование_MARGIN_ALERT_20_00.xlsx' : 'Реестр_MARGIN_ALERT_20_00.xlsx' : 'Итоги_Вечерней_Уценки_20_00.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(mode === 'ready' ? `Готовы к наклейке: ${readyItems.length} позиций` : mode === 'margin' ? `Реестр MARGIN_ALERT: ${approvalItems.length} позиций` : 'Итоговый Excel скачан');
  }

  function marginImportError(message) {
    const notice = $('#margin-import-error');
    notice.textContent = message;
    notice.hidden = false;
    notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Исправленный реестр не применён');
  }

  async function readMarginImport(file) {
    if (!result.promo.length) throw new Error('Сначала загрузите выгрузку остатков из 1С.');
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Загрузите исправленный файл .xlsx, скачанный из этого приложения.');
    if (!file.size) throw new Error('Файл пустой. Скачайте реестр заново и внесите изменения.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Файл больше 10 МБ. Проверьте, что загружаете только реестр цен.');
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(await file.arrayBuffer()); }
    catch { throw new Error('Не удалось прочитать Excel. Проверьте файл и сохраните его повторно как .xlsx.'); }
    const register = workbook.getWorksheet('Согласование цен');
    const adjusted = workbook.getWorksheet('Цена скорректирована');
    const sheet = register || adjusted;
    if (!sheet) throw new Error('В файле нет листа «Согласование цен» или «Цена скорректирована». Скачайте свежий реестр.');
    const spec = register ? { header: 3, comment: 17, approver: 18, floor: 'Мин. цена +5%, тг', price: ['Цена к продаже, тг', 'Предложенная цена, тг'] } : { header: 1, comment: 0, approver: 16, floor: 'Порог +5%, тг', price: ['Новая цена, тг'] };
    const expected = new Map([[1, 'Наименование'], [2, 'Код 1С'], [3, 'Штрихкод'], [4, 'Категория'], [5, 'Остаток'], [6, 'Ед. изм.'], [7, 'Старая цена, тг'], [9, 'Себестоимость, тг'], [10, spec.floor], [11, spec.price]]);
    for (const [column, label] of expected) {
      const accepted = Array.isArray(label) ? label : [label];
      if (!accepted.includes(clean(excelValue(sheet.getRow(spec.header).getCell(column).value)))) throw new Error(`Не найдена колонка «${accepted[0]}» в исходном месте. Скачайте свежий реестр и меняйте только цены, комментарий и имя директора.`);
    }
    const current = result.promo.filter(item => item.riskTypes.includes('margin'));
    if (!current.length) throw new Error('В текущем плане нет цен MARGIN_ALERT для импорта.');
    const matched = new Set();
    const proposals = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= spec.header) return;
      const get = column => excelValue(row.getCell(column).value);
      const name = clean(get(1));
      const code = clean(get(2));
      const barcode = clean(get(3));
      if (!name && !code && !barcode && clean(get(11)) === '') return;
      const candidates = code ? current.filter(item => clean(item.code) === code) : current.filter(item => clean(item.name) === name && clean(item.barcode) === barcode);
      if (candidates.length !== 1) throw new Error(`Строка ${rowNumber}: товар не найден однозначно в текущем плане. Не меняйте код 1С и состав строк реестра.`);
      const item = candidates[0];
      const key = approvalKey(item);
      if (matched.has(key)) throw new Error(`Строка ${rowNumber}: товар «${item.name}» повторяется. Уберите дубль.`);
      matched.add(key);
      const sameNumber = (left, right) => Number.isFinite(left) && Math.abs(left - right) < 1e-6;
      if (name !== clean(item.name) || barcode !== clean(item.barcode) || normalizeCategory(get(4)) !== item.category || !sameNumber(number(get(5)), item.stockNum) || clean(get(6)).toLowerCase() !== item.unit || !sameNumber(number(get(7)), item.retailNum) || !sameNumber(number(get(9)), item.costNum) || !sameNumber(number(get(10)), item.marginFloor)) {
        throw new Error(`Строка ${rowNumber}: исходные данные товара «${item.name}» отличаются от текущей выгрузки. Загрузите реестр для этого файла или исправьте изменённые поля.`);
      }
      const priceCell = row.getCell(11).value;
      if (priceCell && typeof priceCell === 'object' && ('formula' in priceCell || 'sharedFormula' in priceCell)) throw new Error(`Строка ${rowNumber}: в цене формула. Введите готовое число, чтобы не использовать устаревший результат Excel.`);
      const price = number(get(11));
      if (!Number.isFinite(price) || price < roundUp5(item.marginFloor) || price >= item.retailNum || Math.abs(price / 5 - Math.round(price / 5)) > 1e-8) {
        throw new Error(`Строка ${rowNumber}: цена «${item.name}» должна быть кратна 5 ₸, не ниже ${fmtMoney(roundUp5(item.marginFloor))} и ниже ${fmtMoney(item.retailNum)}.`);
      }
      const by = clean(get(spec.approver));
      const comment = spec.comment ? clean(get(spec.comment)) : clean(item.approval?.comment);
      if (by.length > 80 || comment.length > 180) throw new Error(`Строка ${rowNumber}: имя или комментарий слишком длинные.`);
      proposals.push({ item, key, price, by, comment });
    });
    if (proposals.length !== current.length) throw new Error(`В реестре ${proposals.length} из ${current.length} позиций MARGIN_ALERT. Верните отсутствующие строки и загрузите файл заново.`);
    const typedApprover = clean($('#approver-name').value);
    return { fileName: file.name, proposals, changes: proposals.filter(proposal => proposal.price !== proposal.item.newPrice), typedApprover, required: requiresDirectorApproval() };
  }

  function previewMarginImport(imported) {
    pendingMarginImport = imported;
    const unchanged = imported.changes.length === 0;
    $('#margin-import-title').textContent = unchanged ? 'Цены не изменились' : `Изменено цен: ${imported.changes.length}`;
    $('#margin-import-description').textContent = unchanged
      ? `В файле «${imported.fileName}» все ${imported.proposals.length} цен совпадают с текущим планом. Ничего не поменялось — точно подтвердить эти цены?`
      : `В файле «${imported.fileName}» изменено ${imported.changes.length} из ${imported.proposals.length} цен. Проверьте суммы перед применением.`;
    $('#margin-import-changes').innerHTML = imported.changes.map(({ item, price }) => `<div class="margin-import-change"><span>${safe(item.name)}</span><strong>${fmtMoney(item.newPrice)} → ${fmtMoney(price)}</strong></div>`).join('');
    const needsName = imported.required || imported.changes.length > 0;
    $('#margin-import-name-wrap').hidden = !needsName;
    $('#margin-import-name').value = imported.typedApprover;
    $('#margin-import-dialog-error').hidden = true;
    $('#margin-import-confirm').textContent = unchanged ? imported.required ? 'Да, утвердить цены' : 'Да, всё верно' : 'Применить исправленные цены';
    $('#margin-import-dialog').showModal();
  }

  function applyMarginImport() {
    if (!pendingMarginImport) return;
    const imported = pendingMarginImport;
    const typedApprover = clean($('#margin-import-name').value);
    const missingName = imported.proposals.find(proposal => (imported.required || proposal.price !== proposal.item.newPrice) && !typedApprover && !proposal.by);
    if (missingName) {
      $('#margin-import-dialog-error').textContent = `Укажите имя директора для «${missingName.item.name}» или заполните колонку «Утвердил» в Excel.`;
      $('#margin-import-dialog-error').hidden = false;
      $('#margin-import-name').focus();
      return;
    }
    const now = new Date().toISOString();
    let saved = 0;
    for (const proposal of imported.proposals) {
      if (!imported.required && proposal.price === proposal.item.newPrice) continue;
      const by = typedApprover || proposal.by;
      approvals[proposal.key] = { price: proposal.price, by, at: now, comment: proposal.comment };
      saved++;
    }
    if (saved) saveApprovals();
    if (typedApprover) $('#approver-name').value = typedApprover;
    $('#margin-import-dialog').close();
    pendingMarginImport = null;
    render();
    showToast(saved ? `Цены из Excel применены: ${saved} ${pluralRu(saved, 'позиция', 'позиции', 'позиций')}. Обновите файл для касс.` : 'Цены совпадают с текущим планом. Новых решений нет.');
  }

  function downloadPOSPayload() {
    const items = result.promo.filter(isPOSExportable);
    if (!items.length) { showToast('Пока нет цен для файла касс. Проверьте режим согласования и штрихкоды.'); return; }
    const now = new Date();
    const dateLabel = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const businessDate = dateLabel(now);
    const closingDate = new Date(now);
    if (closingHours() >= 24) closingDate.setDate(closingDate.getDate() + 1);
    const payload = {
      schema_version: '1.0',
      document_type: 'evening_markdown_final_price_overrides',
      status: 'prepared_not_sent',
      source_file: currentFileName,
      business_date: businessDate,
      effective_from_local: `${businessDate}T20:00:00`,
      effective_until_local: `${dateLabel(closingDate)}T${$('#closing-time').value}:00`,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      currency: 'KZT',
      price_mode: 'final_price_override',
      apply_standard_30_percent_discount: false,
      director_approval_required: requiresDirectorApproval(),
      items: items.map(item => ({
        code_1c: clean(item.code) || null,
        barcode: item.barcode,
        name: item.name,
        unit: item.unit,
        old_price_kzt: item.retailNum,
        final_price_kzt: item.newPrice,
        minimum_allowed_price_kzt: roundUp5(item.marginFloor),
        approval: item.approval ? { by: item.approval.by, at: item.approval.at } : null
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Касса_Скорректированные_Цены_${businessDate}_20_00.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`JSON для касс подготовлен: ${money.format(items.length)} позиций. Передача через API не выполнена.`);
  }

  $('#choose-file').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) loadFile(file); });
  $('#closing-time').addEventListener('change', event => {
    const [hours, minutes] = event.target.value.split(':').map(Number);
    const closing = hours < 6 ? hours + 24 + minutes / 60 : hours + minutes / 60;
    if (!event.target.value || !Number.isFinite(closing) || closing <= 20) {
      event.target.value = '23:00';
      showToast('Укажите закрытие после 20:00 или после полуночи.');
    }
    if (sourceRows.length) render();
  });
  $('#whole-units-only').addEventListener('change', () => { if (sourceRows.length) render(); });
  $('#require-director-approval').addEventListener('change', event => {
    if (approvalStorageKey) {
      try { localStorage.setItem(`${approvalStorageKey}:director-required`, event.target.checked ? '1' : '0'); }
      catch { showToast('Не удалось сохранить выбор режима в этом браузере.'); }
    }
    if (sourceRows.length) render();
  });
  [['stock-kg-limit', 'kg'], ['stock-pieces-limit', 'pieces']].forEach(([id, key]) => {
    const input = $(`#${id}`);
    const updateLimit = (event, final) => {
      const value = number(event.target.value);
      if (!Number.isFinite(value) || value <= 0) {
        if (final) {
          event.target.value = thresholdNumber.format(stockRules[key]);
          showToast('Порог должен быть положительным числом. Предыдущее значение сохранено.');
        }
        return;
      }
      stockRules[key] = value;
      if (final) event.target.value = thresholdNumber.format(value);
      if (sourceRows.length) render();
    };
    input.addEventListener('input', event => updateLimit(event, false));
    input.addEventListener('change', event => updateLimit(event, true));
  });
  [['stock-kg-operator', 'kgInclusive'], ['stock-pieces-operator', 'piecesInclusive']].forEach(([id, key]) => {
    $(`#${id}`).addEventListener('change', event => {
      stockRules[key] = event.target.value === 'lte';
      if (sourceRows.length) render();
    });
  });
  $('#unit-error-open').addEventListener('click', () => { riskFilter = 'data'; nav('exceptions'); });
  const dropZone = $('#drop-zone');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('dragover'); loadFile(event.dataTransfer.files[0]); });
  document.addEventListener('click', event => {
    const categoryButton = event.target.closest('[data-category-index]');
    if (categoryButton) { activeCategoryIndex = Number(categoryButton.dataset.categoryIndex); categoryFilter = 'all'; $('#category-search').value = ''; nav('categories'); return; }
    const riskStageButton = event.target.closest('[data-risk-stage]');
    if (riskStageButton) { riskFilter = 'expiry'; expiryFilter = riskStageButton.dataset.riskStage; nav('exceptions'); return; }
    const riskCard = event.target.closest('[data-risk-card]');
    if (riskCard) { riskFilter = riskCard.dataset.riskCard; nav('exceptions'); return; }
    const promoCard = event.target.closest('[data-promo-filter]');
    if (promoCard) { promoFilter = promoCard.dataset.promoFilter; $('#promo-search').value = ''; nav('stickers'); return; }
    const navButton = event.target.closest('[data-nav]');
    if (navButton) nav(navButton.dataset.nav);
  });
  $$('.table-tab').forEach(button => button.addEventListener('click', () => {
    promoFilter = button.dataset.tableTab;
    $$('.table-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    renderPromo();
  }));
  $$('.risk-tab').forEach(button => button.addEventListener('click', () => {
    riskFilter = button.dataset.riskFilter;
    renderRisks();
  }));
  $$('.expiry-tab').forEach(button => button.addEventListener('click', () => { expiryFilter = button.dataset.expiryFilter; renderRisks(); }));
  $('#expiry-alert-link').addEventListener('click', () => { riskFilter = 'expiry'; expiryFilter = 'all'; nav('exceptions'); });
  $('#barcode-show-all').addEventListener('click', () => { riskFilter = 'data'; nav('exceptions'); });
  $('#promo-search').addEventListener('input', renderPromo);
  $$('.category-filter').forEach(button => button.addEventListener('click', () => { categoryFilter = button.dataset.categoryFilter; renderCategoryDetail(); }));
  $('#category-search').addEventListener('input', renderCategoryDetail);
  $('#risk-search').addEventListener('input', renderRisks);
  function showPotentialCalculation() {
    const panel = $('#potential-details');
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    panel.classList.add('focus');
    setTimeout(() => panel.classList.remove('focus'), 1800);
  }
  $('#potential-info').addEventListener('click', showPotentialCalculation);
  $('#potential-details-button').addEventListener('click', showPotentialCalculation);
  $('#download-plan').addEventListener('click', () => downloadWorkbook('all'));
  $('#download-ready').addEventListener('click', () => downloadWorkbook('ready'));
  $('#download-pos').addEventListener('click', downloadPOSPayload);
  $('#download-margin').addEventListener('click', () => downloadWorkbook('margin'));
  $('#approval-download').addEventListener('click', () => downloadWorkbook('margin'));
  $('#approval-upload').addEventListener('click', () => $('#approval-file-input').click());
  $('#approval-file-input').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    $('#margin-import-error').hidden = true;
    const button = $('#approval-upload');
    button.disabled = true;
    try { previewMarginImport(await readMarginImport(file)); }
    catch (error) { marginImportError(error.message || 'Не удалось обработать исправленный реестр.'); }
    finally { button.disabled = false; }
  });
  $('#margin-import-cancel').addEventListener('click', () => $('#margin-import-dialog').close());
  $('#margin-import-confirm').addEventListener('click', applyMarginImport);
  $('#margin-import-dialog').addEventListener('close', () => { pendingMarginImport = null; });
  $('#download-exceptions').addEventListener('click', () => downloadWorkbook('exceptions'));
  $('#approval-list').addEventListener('click', event => {
    const button = event.target.closest('.approval-save');
    if (!button) return;
    const card = button.closest('[data-approval-key]');
    const item = result.promo.find(row => approvalKey(row) === card.dataset.approvalKey);
    if (!item) return;
    const error = $('.approval-error', card);
    const price = Number($('.approval-price', card).value);
    const by = clean($('#approver-name').value);
    if (!by) { error.textContent = 'Укажите имя согласующего выше.'; error.hidden = false; $('#approver-name').focus(); return; }
    if (!Number.isFinite(price) || price < roundUp5(item.marginFloor) || price >= item.retailNum || price % 5 !== 0) {
      error.textContent = `Введите цену кратную 5 ₸: от ${fmtMoney(roundUp5(item.marginFloor))} до значения ниже ${fmtMoney(item.retailNum)}.`;
      error.hidden = false;
      $('.approval-price', card).focus();
      return;
    }
    approvals[approvalKey(item)] = { price, by, at: new Date().toISOString(), comment: clean($('.approval-comment', card).value) };
    saveApprovals();
    render();
    showToast(`Цена ${fmtMoney(price)} сохранена и войдёт в следующий файл для касс.`);
  });
  $('#approval-list').addEventListener('input', event => {
    if (!event.target.matches('.approval-price')) return;
    const card = event.target.closest('[data-approval-key]');
    const item = result.promo.find(row => approvalKey(row) === card.dataset.approvalKey);
    if (!item) return;
    const activePrice = item.approval?.price ?? roundUp5(item.marginFloor);
    $('.approval-draft', card).hidden = event.target.value !== '' && Number(event.target.value) === activePrice;
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      const search = currentView === 'exceptions' ? $('#risk-search') : currentView === 'categories' ? $('#category-search') : currentView === 'stickers' ? $('#promo-search') : null;
      if (search) { event.preventDefault(); search.focus(); }
    }
  });

})();

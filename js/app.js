import {
  MACROS, calories, sumEntries, targetGrams, remaining, multiples, weightOn, foodPortion,
  fromInputWeight, toDisplayWeight, dateKey, parseDateKey, shiftDate,
} from './calc.js';
import { load, save, parseBackup } from './store.js';
import { weightChartSvg } from './chart.js';

const NAMES = { p: '蛋白质', c: '碳水', f: '脂肪' };
const KCAL_PER_G = { p: 4, c: 4, f: 9 };
const WEEKDAYS = '日一二三四五六';

const $view = document.getElementById('view');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

const state = load(localStorage);
let view = 'today';
let today = dateKey(new Date());
let date = today;
let trendRange = 30;
let sheetState = null;

// ---------- 小工具 ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const num = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const otherUnit = (unit) => (unit === 'lb' ? 'kg' : 'lb');

// 空 → null；不是非负数字 → NaN
function parseNum(text) {
  const t = String(text).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function dayLabel(key) {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
const weekday = (key) => `周${WEEKDAYS[parseDateKey(key).getDay()]}`;

function persist() {
  try {
    save(localStorage, state);
  } catch {
    showToast('保存失败：浏览器存储空间不可用');
  }
}

let toastTimer;
function showToast(message, action) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  $toast.hidden = false;
  if (action) {
    $toast.querySelector('button').addEventListener('click', () => {
      $toast.hidden = true;
      action.run();
    });
  }
  toastTimer = setTimeout(() => { $toast.hidden = true; }, action ? 5000 : 2500);
}

const macroLine = (m) => MACROS.map((k) => `<span class="dot dot--${k}">${NAMES[k]} ${num(m[k])}</span>`).join('');

// ---------- 记录页 ----------

function todayHtml() {
  const { unit } = state.settings;
  const own = state.weights[date];
  const carried = weightOn(state.weights, date);
  const isToday = date === today;
  return `
    <header class="datebar">
      <button type="button" class="iconbtn" data-act="prev-day" aria-label="前一天">‹</button>
      <div class="datebar__label">
        <h1>${dayLabel(date)}</h1>
        <p>${weekday(date)}${isToday ? '，今天' : ''}</p>
      </div>
      <button type="button" class="iconbtn" data-act="next-day" aria-label="后一天" ${isToday ? 'disabled' : ''}>›</button>
    </header>
    ${isToday ? '' : '<button type="button" class="linkbtn backtoday" data-act="go-today">回到今天</button>'}

    <section class="weight" aria-label="体重">
      <label for="weight">体重</label>
      <input id="weight" type="text" inputmode="decimal" autocomplete="off"
        value="${own ? toDisplayWeight(own, unit) : ''}"
        placeholder="${carried ? toDisplayWeight(carried, unit) : '0.0'}">
      <div class="seg" role="group" aria-label="体重单位">
        ${['lb', 'kg'].map((u) => `<button type="button" data-act="set-unit" data-unit="${u}" aria-pressed="${u === unit}">${u}</button>`).join('')}
      </div>
      <p class="weight__hint" id="weight-hint">${weightHint()}</p>
    </section>

    <div id="summary">${summaryHtml()}</div>
    <button type="button" class="btn btn--primary fab" data-act="add-entry">添加食物</button>`;
}

function weightHint() {
  const { unit } = state.settings;
  const own = state.weights[date];
  if (own) return `等于 ${toDisplayWeight(own, otherUnit(unit))} ${otherUnit(unit)}`;
  const carried = weightOn(state.weights, date);
  if (carried) return `这天没称，沿用上次的 ${toDisplayWeight(carried, unit)} ${unit}`;
  return '输入体重后才能算出目标';
}

function gap(left) {
  return left >= 0 ? { label: '还差', value: left, over: false } : { label: '超出', value: -left, over: true };
}

function rulerHtml(eatenMult, targetMult) {
  const max = Math.max(targetMult, eatenMult, 0.4) * 1.12;
  const step = max > 3.4 ? 1 : max > 1.2 ? 0.5 : 0.25;
  const pct = (v) => `${Math.min((v / max) * 100, 100).toFixed(2)}%`;
  let ticks = '';
  for (let t = step; t < max; t += step) {
    ticks += `<i class="ruler__tick" style="left:${pct(t)}"><span>${t}×</span></i>`;
  }
  return `
    <div class="ruler" aria-hidden="true">
      <div class="ruler__track"><div class="ruler__fill" style="width:${pct(eatenMult)}"></div></div>
      ${ticks}
      <i class="ruler__target" style="left:${pct(targetMult)}"></i>
    </div>`;
}

function macroRowHtml(k, eaten, target, left, mult) {
  const g = gap(left[k]);
  return `
    <article class="macro macro--${k}">
      <div class="macro__head">
        <h2>${NAMES[k]}</h2>
        <p class="macro__gap ${g.over ? 'is-over' : ''}">${g.label} <b>${num(g.value)}</b> g</p>
      </div>
      ${rulerHtml(mult[k], state.settings.targets[k])}
      <div class="macro__foot">
        <span>已吃 ${num(eaten[k])} g，体重的 ${mult[k]} 倍</span>
        <span>目标 ${num(target[k])} g</span>
      </div>
    </article>`;
}

function entriesHtml(entries) {
  if (entries.length === 0) {
    return '<p class="empty">这天还没有记录。吃了什么，点下面的「添加食物」记下来。</p>';
  }
  return `<ul class="entries">${entries.map((e) => `
    <li>
      <button type="button" class="entry" data-act="edit-entry" data-id="${esc(e.id)}">
        <span class="entry__name">${esc(e.name)}${e.qty ? `<small>${esc(e.qty)}</small>` : ''}</span>
        <span class="entry__kcal">${num(calories(e))} kcal</span>
        <span class="entry__macros">${macroLine(e)}</span>
      </button>
      <button type="button" class="iconbtn iconbtn--quiet" data-act="delete-entry" data-id="${esc(e.id)}" aria-label="删除 ${esc(e.name)}">×</button>
    </li>`).join('')}</ul>`;
}

function summaryHtml() {
  const entries = state.entries[date] ?? [];
  const eaten = sumEntries(entries);
  const eatenKcal = calories(eaten);
  const kg = weightOn(state.weights, date);

  if (kg === null) {
    return `
      <section class="kcal">
        <p class="kcal__gap">已吃 <b>${num(eatenKcal)}</b> kcal</p>
        <p class="kcal__detail">${macroLine(eaten)}</p>
      </section>
      <p class="notice">先在上面输入体重，这里就会按「体重的几倍」算出每种营养素还差多少。</p>
      <section class="log"><h2>吃了什么</h2>${entriesHtml(entries)}</section>`;
  }

  const target = targetGrams(state.settings.targets, kg);
  const left = remaining(target, eaten);
  const mult = multiples(eaten, kg);
  const targetKcal = calories(target);
  const g = gap(targetKcal - eatenKcal);
  return `
    <section class="kcal">
      <p class="kcal__gap ${g.over ? 'is-over' : ''}">${g.label} <b>${num(g.value)}</b> kcal</p>
      <p class="kcal__detail">已吃 ${num(eatenKcal)}，目标 ${num(targetKcal)} kcal</p>
    </section>
    <section class="macros">${MACROS.map((k) => macroRowHtml(k, eaten, target, left, mult)).join('')}</section>
    <section class="log"><h2>吃了什么</h2>${entriesHtml(entries)}</section>`;
}

const refreshSummary = () => { document.getElementById('summary').innerHTML = summaryHtml(); };

// ---------- 趋势页 ----------

function trendsHtml() {
  const { unit } = state.settings;
  const from = trendRange ? shiftDate(today, -trendRange) : '';
  const weightDays = Object.keys(state.weights).filter((k) => k >= from).sort();
  const data = weightDays.map((k) => ({ date: k, value: toDisplayWeight(state.weights[k], unit) }));

  let change = '';
  if (data.length >= 2) {
    const diff = Math.round((data[data.length - 1].value - data[0].value) * 10) / 10;
    change = `<p class="trend__change">${dayLabel(data[0].date)}至今 <b>${diff > 0 ? '+' : ''}${diff}</b> ${unit}</p>`;
  }

  const days = [...new Set([...Object.keys(state.weights), ...Object.keys(state.entries).filter((k) => state.entries[k].length)])]
    .filter((k) => k >= from).sort().reverse();

  const rows = days.map((k) => {
    const eaten = sumEntries(state.entries[k]);
    const kcal = calories(eaten);
    const kg = weightOn(state.weights, k);
    const own = state.weights[k];
    let versus = '';
    if (kg !== null && kcal > 0) {
      const g = gap(calories(targetGrams(state.settings.targets, kg)) - kcal);
      versus = `<small class="${g.over ? 'is-over' : ''}">${g.over ? '超' : '差'} ${num(g.value)}</small>`;
    }
    return `
      <li><button type="button" class="day" data-act="open-day" data-date="${k}">
        <span class="day__date">${dayLabel(k)}<small>${weekday(k)}</small></span>
        <span class="day__weight">${own ? `${toDisplayWeight(own, unit)} ${unit}` : '没称'}</span>
        <span class="day__kcal">${kcal ? `${num(kcal)} kcal` : '没记'}${versus}</span>
        <span class="day__macros">${kcal ? macroLine(eaten) : ''}</span>
      </button></li>`;
  }).join('');

  return `
    <header class="page__head">
      <h1>趋势</h1>
      <div class="seg" role="group" aria-label="时间范围">
        ${[[30, '30 天'], [90, '90 天'], [0, '全部']].map(([v, label]) => `<button type="button" data-act="set-range" data-range="${v}" aria-pressed="${v === trendRange}">${label}</button>`).join('')}
      </div>
    </header>
    <section class="panel trend">
      <h2>体重（${unit}）</h2>
      ${data.length ? weightChartSvg(data, unit) + change : '<p class="empty">这段时间还没有体重记录。在「记录」页输入体重，这里会画出变化曲线。</p>'}
    </section>
    <section class="log">
      <h2>每天</h2>
      ${rows ? `<ul class="days">${rows}</ul>` : '<p class="empty">这段时间还没有记录。</p>'}
    </section>`;
}

// ---------- 食物库页 ----------

const basisLabel = (basis) => (basis === '100g' ? '每 100 g' : '每份');

function foodsHtml() {
  const list = state.foods.map((f) => `
    <li><button type="button" class="entry" data-act="edit-food" data-id="${esc(f.id)}">
      <span class="entry__name">${esc(f.name)}<small>${basisLabel(f.basis)}</small></span>
      <span class="entry__kcal">${num(calories(f))} kcal</span>
      <span class="entry__macros">${macroLine(f)}</span>
    </button></li>`).join('');
  return `
    <header class="page__head"><h1>食物库</h1></header>
    <p class="lede">把常吃的食物存在这里，记录时选中它、填重量，营养素会自动算好。</p>
    ${list ? `<ul class="entries">${list}</ul>` : '<p class="empty">食物库还是空的。点下面的「新增食物」，照着包装上的营养成分表填一次就行。</p>'}
    <button type="button" class="btn btn--primary fab" data-act="new-food">新增食物</button>`;
}

// ---------- 目标页 ----------

function targetDerived(k, kg) {
  if (kg === null) return '输入体重后显示克数';
  const grams = targetGrams(state.settings.targets, kg)[k];
  return `每天 ${num(grams)} g，${num(Math.round(grams * KCAL_PER_G[k]))} kcal`;
}

function targetTotal(kg) {
  if (kg === null) return '';
  return `合计 <b>${num(calories(targetGrams(state.settings.targets, kg)))}</b> kcal`;
}

function settingsHtml() {
  const { unit, targets } = state.settings;
  const kg = weightOn(state.weights, today);
  return `
    <header class="page__head"><h1>每日目标</h1></header>
    <p class="lede">每公斤体重每天吃多少克。${kg === null ? '' : `按最近的体重 ${toDisplayWeight(kg, unit)} ${unit}${unit === 'lb' ? `（${toDisplayWeight(kg, 'kg')} kg）` : ''}计算。`}</p>
    <section class="panel targets">
      ${MACROS.map((k) => `
        <div class="target macro--${k}">
          <label for="target-${k}">${NAMES[k]}</label>
          <div class="stepper">
            <button type="button" class="iconbtn" data-act="step" data-macro="${k}" data-delta="-0.1" aria-label="${NAMES[k]}减少 0.1">−</button>
            <input id="target-${k}" data-macro="${k}" type="text" inputmode="decimal" autocomplete="off" value="${targets[k]}">
            <button type="button" class="iconbtn" data-act="step" data-macro="${k}" data-delta="0.1" aria-label="${NAMES[k]}增加 0.1">+</button>
            <span>g/kg</span>
          </div>
          <p data-derived="${k}">${targetDerived(k, kg)}</p>
        </div>`).join('')}
      <p class="targets__total" id="target-total">${targetTotal(kg)}</p>
    </section>

    <section class="backup">
      <h2>备份</h2>
      <p class="lede">记录只存在这台手机的浏览器里，不会上传。清除浏览器数据或换手机之前，先导出一份。</p>
      <div class="backup__actions">
        <button type="button" class="btn" data-act="export">导出备份</button>
        <button type="button" class="btn" data-act="import">导入备份</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>`;
}

function refreshTargetDerived() {
  const kg = weightOn(state.weights, today);
  for (const k of MACROS) {
    document.querySelector(`[data-derived="${k}"]`).textContent = targetDerived(k, kg);
  }
  document.getElementById('target-total').innerHTML = targetTotal(kg);
}

// ---------- 渲染 ----------

const VIEWS = { today: todayHtml, trends: trendsHtml, foods: foodsHtml, settings: settingsHtml };

function render() {
  $view.innerHTML = VIEWS[view]();
  $view.dataset.view = view;
  for (const tab of document.querySelectorAll('.tabs button')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

// ---------- 弹出面板 ----------

const field = (id, label, value = '', attrs = 'inputmode="decimal"') => `
  <label class="field" for="${id}"><span>${label}</span>
    <input id="${id}" type="text" autocomplete="off" ${attrs} value="${esc(value)}">
  </label>`;

const macroFields = (m = {}) => `
  <div class="field-row">
    ${MACROS.map((k) => field(`f-${k}`, `${NAMES[k]} (g)`, m[k] ?? '')).join('')}
  </div>`;

function entrySheetHtml() {
  const { tab, foodId, editId } = sheetState;
  const editing = editId ? (state.entries[date] ?? []).find((e) => e.id === editId) : null;
  const food = state.foods.find((f) => f.id === foodId);

  const tabs = editing ? '' : `
    <div class="seg seg--wide" role="group" aria-label="录入方式">
      <button type="button" data-act="sheet-tab" data-tab="foods" aria-pressed="${tab === 'foods'}">从食物库选</button>
      <button type="button" data-act="sheet-tab" data-tab="manual" aria-pressed="${tab === 'manual'}">手动输入</button>
    </div>`;

  let body;
  if (tab === 'foods') {
    body = state.foods.length === 0
      ? '<p class="empty">食物库还是空的。切到「手动输入」并勾选「存入食物库」，下次就能在这里直接选。</p>'
      : `
        <div class="foodpick">
          ${state.foods.map((f) => `<button type="button" data-act="pick-food" data-id="${esc(f.id)}" aria-pressed="${f.id === foodId}">${esc(f.name)}</button>`).join('')}
        </div>
        ${food ? `
          ${field('f-amount', food.basis === '100g' ? '吃了多少克' : '吃了几份', food.basis === '100g' ? '100' : '1')}
          <p class="preview" id="preview"></p>` : '<p class="hint">选一个食物，再填吃了多少。</p>'}`;
  } else {
    body = `
      ${field('f-name', '名称', editing?.name ?? '', 'placeholder="比如：鸡胸肉"')}
      ${macroFields(editing ?? {})}
      <p class="preview" id="preview"></p>
      ${editing ? '' : '<label class="check"><input type="checkbox" id="f-save"> 存入食物库，下次直接选</label>'}`;
  }

  const canSubmit = tab === 'manual' || food;
  return `
    <form id="sheet-form" novalidate>
      <header class="sheet__head">
        <h2>${editing ? '修改记录' : '添加食物'}</h2>
        <button type="button" class="iconbtn iconbtn--quiet" data-act="close-sheet" aria-label="关闭">×</button>
      </header>
      ${tabs}
      ${body}
      <p class="form-error" id="form-error" role="alert" hidden></p>
      ${canSubmit ? `<button type="submit" class="btn btn--primary">${editing ? '保存修改' : `添加到${dayLabel(date)}`}</button>` : ''}
    </form>`;
}

function foodSheetHtml() {
  const editing = state.foods.find((f) => f.id === sheetState.editId);
  const basis = editing?.basis ?? '100g';
  return `
    <form id="sheet-form" novalidate>
      <header class="sheet__head">
        <h2>${editing ? '修改食物' : '新增食物'}</h2>
        <button type="button" class="iconbtn iconbtn--quiet" data-act="close-sheet" aria-label="关闭">×</button>
      </header>
      ${field('f-name', '名称', editing?.name ?? '', 'placeholder="比如：燕麦"')}
      <fieldset class="radios">
        <legend>下面的营养素是按什么量填的</legend>
        <label><input type="radio" name="basis" value="100g" ${basis === '100g' ? 'checked' : ''}> 每 100 g</label>
        <label><input type="radio" name="basis" value="serving" ${basis === 'serving' ? 'checked' : ''}> 每份</label>
      </fieldset>
      ${macroFields(editing ?? {})}
      <p class="preview" id="preview"></p>
      <p class="form-error" id="form-error" role="alert" hidden></p>
      <button type="submit" class="btn btn--primary">${editing ? '保存修改' : '存入食物库'}</button>
      ${editing ? '<button type="button" class="btn btn--danger" data-act="delete-food">从食物库删除</button>' : ''}
    </form>`;
}

function renderSheet() {
  $sheet.innerHTML = sheetState.kind === 'entry' ? entrySheetHtml() : foodSheetHtml();
  refreshPreview();
}

function openSheet(next) {
  sheetState = next;
  renderSheet();
  if (!$sheet.open) $sheet.showModal();
}

function readMacros() {
  const m = {};
  for (const k of MACROS) m[k] = parseNum(document.getElementById(`f-${k}`).value) ?? 0;
  return m;
}

// 当前面板里将要记下的营养素；填得不完整时返回 null
function draftMacros() {
  if (sheetState.kind === 'entry' && sheetState.tab === 'foods') {
    const food = state.foods.find((f) => f.id === sheetState.foodId);
    const amount = food ? parseNum(document.getElementById('f-amount').value) : null;
    return food && amount ? foodPortion(food, amount) : null;
  }
  const m = readMacros();
  return MACROS.some((k) => Number.isNaN(m[k])) ? null : m;
}

function refreshPreview() {
  const $preview = document.getElementById('preview');
  if (!$preview) return;
  const m = draftMacros();
  $preview.innerHTML = m ? `<b>${num(calories(m))} kcal</b>${macroLine(m)}` : '';
}

function formError(message) {
  const $error = document.getElementById('form-error');
  $error.textContent = message;
  $error.hidden = false;
}

function submitEntry() {
  const list = (state.entries[date] ??= []);
  if (sheetState.tab === 'foods') {
    const food = state.foods.find((f) => f.id === sheetState.foodId);
    const amount = parseNum(document.getElementById('f-amount').value);
    if (!amount) return formError('填一个大于 0 的数字。');
    list.push({
      id: uid(),
      name: food.name,
      qty: food.basis === '100g' ? `${num(amount)} g` : `${num(amount)} 份`,
      ...foodPortion(food, amount),
    });
  } else {
    const m = readMacros();
    if (MACROS.some((k) => Number.isNaN(m[k]))) return formError('营养素只能填数字，比如 23.5。');
    if (MACROS.every((k) => m[k] === 0)) return formError('至少填一种营养素的克数。');
    const name = document.getElementById('f-name').value.trim() || '未命名食物';
    const editing = list.find((e) => e.id === sheetState.editId);
    if (editing) {
      // 手动改过数值后，原来的「200 g」已不可信
      delete editing.qty;
      Object.assign(editing, { name, ...m });
    } else {
      list.push({ id: uid(), name, ...m });
      if (document.getElementById('f-save').checked) {
        state.foods.push({ id: uid(), name, basis: 'serving', ...m });
      }
    }
  }
  persist();
  $sheet.close();
  render();
}

function submitFood() {
  const name = document.getElementById('f-name').value.trim();
  const m = readMacros();
  if (!name) return formError('给这个食物起个名字。');
  if (MACROS.some((k) => Number.isNaN(m[k]))) return formError('营养素只能填数字，比如 23.5。');
  if (MACROS.every((k) => m[k] === 0)) return formError('至少填一种营养素的克数。');
  const basis = document.querySelector('input[name="basis"]:checked').value;
  const editing = state.foods.find((f) => f.id === sheetState.editId);
  if (editing) Object.assign(editing, { name, basis, ...m });
  else state.foods.push({ id: uid(), name, basis, ...m });
  persist();
  $sheet.close();
  render();
}

// ---------- 备份 ----------

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `营养素备份-${today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch {
    showToast('导入失败：这不是有效的备份文件，现有记录没有改动');
    return;
  }
  if (!confirm('导入会用备份替换现在的全部记录，继续吗？')) return;
  Object.assign(state, parsed);
  persist();
  render();
  showToast('已导入备份');
}

// ---------- 事件 ----------

const actions = {
  'prev-day': () => { date = shiftDate(date, -1); render(); },
  'next-day': () => { if (date < today) { date = shiftDate(date, 1); render(); } },
  'go-today': () => { date = today; render(); },
  'set-unit': (el) => { state.settings.unit = el.dataset.unit; persist(); render(); },
  'set-range': (el) => { trendRange = Number(el.dataset.range); render(); },
  'open-day': (el) => { date = el.dataset.date; view = 'today'; render(); window.scrollTo(0, 0); },

  'add-entry': () => openSheet({ kind: 'entry', tab: state.foods.length ? 'foods' : 'manual', foodId: null, editId: null }),
  'edit-entry': (el) => openSheet({ kind: 'entry', tab: 'manual', foodId: null, editId: el.dataset.id }),
  'delete-entry': (el) => {
    const list = state.entries[date];
    const index = list.findIndex((e) => e.id === el.dataset.id);
    const [removed] = list.splice(index, 1);
    const from = date;
    persist();
    refreshSummary();
    showToast(`已删除「${removed.name}」`, {
      label: '撤销',
      run: () => {
        (state.entries[from] ??= []).splice(index, 0, removed);
        persist();
        render();
      },
    });
  },

  'sheet-tab': (el) => { sheetState.tab = el.dataset.tab; renderSheet(); },
  'pick-food': (el) => {
    sheetState.foodId = el.dataset.id;
    renderSheet();
    const $amount = document.getElementById('f-amount');
    $amount.focus();
    $amount.select();
  },
  'close-sheet': () => $sheet.close(),

  'new-food': () => openSheet({ kind: 'food', editId: null }),
  'edit-food': (el) => openSheet({ kind: 'food', editId: el.dataset.id }),
  'delete-food': () => {
    const index = state.foods.findIndex((f) => f.id === sheetState.editId);
    const [removed] = state.foods.splice(index, 1);
    persist();
    $sheet.close();
    render();
    showToast(`已从食物库删除「${removed.name}」`, {
      label: '撤销',
      run: () => { state.foods.splice(index, 0, removed); persist(); render(); },
    });
  },

  step: (el) => {
    const k = el.dataset.macro;
    const next = Math.max(0, Math.round((state.settings.targets[k] + Number(el.dataset.delta)) * 10) / 10);
    state.settings.targets[k] = next;
    document.getElementById(`target-${k}`).value = next;
    persist();
    refreshTargetDerived();
  },

  export: exportBackup,
  import: () => document.getElementById('import-file').click(),
};

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.tabs button');
  if (tab) {
    view = tab.dataset.view;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = event.target.closest('[data-act]');
  if (el && !el.disabled) actions[el.dataset.act]?.(el);
});

$view.addEventListener('input', (event) => {
  const el = event.target;
  if (el.id === 'weight') {
    const n = parseNum(el.value);
    el.classList.toggle('is-invalid', Number.isNaN(n) || n === 0);
    if (n === null) delete state.weights[date];
    else if (n > 0) state.weights[date] = fromInputWeight(n, state.settings.unit);
    else return;
    persist();
    document.getElementById('weight-hint').textContent = weightHint();
    refreshSummary();
  } else if (el.id?.startsWith('target-')) {
    const n = parseNum(el.value);
    el.classList.toggle('is-invalid', n === null || Number.isNaN(n));
    if (n === null || Number.isNaN(n)) return;
    state.settings.targets[el.dataset.macro] = n;
    persist();
    refreshTargetDerived();
  }
});

$view.addEventListener('change', (event) => {
  if (event.target.id !== 'import-file') return;
  const [file] = event.target.files;
  event.target.value = '';
  if (file) importBackup(file);
});

$sheet.addEventListener('input', refreshPreview);
$sheet.addEventListener('submit', (event) => {
  event.preventDefault();
  if (sheetState.kind === 'entry') submitEntry();
  else submitFood();
});
// 点面板外的遮罩关闭
$sheet.addEventListener('click', (event) => { if (event.target === $sheet) $sheet.close(); });

// 过了午夜再回到页面时，跟着切到新的一天
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = dateKey(new Date());
  if (now === today) return;
  if (date === today) date = now;
  today = now;
  render();
});

render();

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

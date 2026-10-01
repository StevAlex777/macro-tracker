import {
  MACROS, calories, kcalOf, sumKcal, sumEntries, multiples, weightOn, foodPortion,
  fromInputWeight, toDisplayWeight, dateKey, parseDateKey, shiftDate,
  rollingAverage, weeklyRate, averageIntake, estimateExpenditure, EXPENDITURE_NEEDS, kgPerWeekFromDeficit,
  dailyTarget, status,
  restingEnergy, totalEnergy, intakeRangeForLoss, ACTIVITY_LEVELS,
} from './calc.js';
import { load, save, parseBackup, isBirthYear } from './store.js';
import { weightChartSvg } from './chart.js';

const NAMES = { p: 'Protein', c: 'Carbs', f: 'Fat' };
const KCAL_PER_G = { p: 4, c: 4, f: 9 };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

const $view = document.getElementById('view');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

const state = load(localStorage);
let view = 'today';
let today = dateKey(new Date());
let date = today;
let trendRange = 30;
let sheetState = null;
let justAdded = null; // 刚添加的记录 id，渲染时给它一个进入动画

// ---------- 小工具 ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const num = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const otherUnit = (unit) => (unit === 'lb' ? 'kg' : 'lb');
const round50 = (n) => Math.round(n / 50) * 50;
const thisYear = () => Number(today.slice(0, 4));

// 空 → null；不是非负数字 → NaN
function parseNum(text) {
  const t = String(text).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function dayLabel(key) {
  const d = parseDateKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
const weekday = (key) => WEEKDAYS[parseDateKey(key).getDay()];

function persist() {
  try {
    save(localStorage, state);
  } catch {
    showToast('Could not save: browser storage is unavailable');
  }
}

let toastTimer;
function showToast(message, action) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  $toast.classList.add('is-open');
  if (action) {
    $toast.querySelector('button').addEventListener('click', () => {
      $toast.classList.remove('is-open');
      action.run();
    });
  }
  toastTimer = setTimeout(() => { $toast.classList.remove('is-open'); }, action ? 5000 : 2500);
}

// 旧版本存下的份量文字是中文（如「2 份」），显示时换成英文，不改已存的数据
const qtyLabel = (qty) => qty.replace(/^([\d.,]+) \u4efd$/, (_, n) => `${n} ${n === '1' ? 'serving' : 'servings'}`);

const macroLine = (m) => MACROS.map((k) => `<span class="dot dot--${k}">${NAMES[k]} ${num(m[k])}</span>`).join('');

// ---------- 记录页 ----------

function todayHtml() {
  const { unit } = state.settings;
  const own = state.weights[date];
  const carried = weightOn(state.weights, date);
  const isToday = date === today;
  return `
    <header class="datebar">
      <button type="button" class="iconbtn" data-act="prev-day" aria-label="Previous day">‹</button>
      <div class="datebar__label">
        <h1>${dayLabel(date)}</h1>
        <p>${weekday(date)}${isToday ? ', today' : ''}</p>
      </div>
      <button type="button" class="iconbtn" data-act="next-day" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </header>
    ${isToday ? '' : '<button type="button" class="linkbtn backtoday" data-act="go-today">Back to today</button>'}

    <section class="weight" aria-label="Weight">
      <label for="weight">Weight</label>
      <input id="weight" type="text" inputmode="decimal" autocomplete="off"
        value="${own ? toDisplayWeight(own, unit) : ''}"
        placeholder="${carried ? toDisplayWeight(carried, unit) : '0.0'}">
      <div class="seg" role="group" aria-label="Weight unit">
        ${['lb', 'kg'].map((u) => `<button type="button" data-act="set-unit" data-unit="${u}" aria-pressed="${u === unit}">${u}</button>`).join('')}
      </div>
      <p class="weight__hint" id="weight-hint">${weightHint()}</p>
    </section>

    <div id="summary">${summaryHtml()}</div>
    <button type="button" class="btn btn--primary fab" data-act="add-entry"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add food</button>`;
}

function weightHint() {
  const { unit } = state.settings;
  const own = state.weights[date];
  if (own) return `Equals ${toDisplayWeight(own, otherUnit(unit))} ${otherUnit(unit)}`;
  const carried = weightOn(state.weights, date);
  if (carried) return `Not weighed this day. Using your last weight, ${toDisplayWeight(carried, unit)} ${unit}`;
  return 'Enter your weight to see your targets';
}

// 蛋白质是下限（吃够就行），碳水、脂肪和总热量是上限
const KIND = { p: 'floor', c: 'ceiling', f: 'ceiling' };

// 把「吃了多少 / 目标多少」变成界面上的一句话。达标区间内不再报差几克
function verdict(kind, eaten, target) {
  const st = status(kind, eaten, target);
  const diff = Math.abs(Math.round((eaten - target) * 10) / 10);
  if (st === 'under') return { state: 'under', value: diff, over: false };
  if (st === 'over') return { state: 'over', value: diff, over: true };
  // 蛋白质明显吃多时说明多了多少，但不算超
  const surplus = status('ceiling', eaten, target) === 'over';
  return surplus ? { state: 'extra', value: diff, over: false } : { state: 'met', value: null, over: false };
}

// count 为 true 时给数字打上标记，变化时由 animateSummary 滚动过去
function verdictHtml(v, unit, count = false) {
  if (v.state === 'met') return '<b class="is-met">On target</b>';
  const number = `<b ${count ? `data-count="${Math.round(v.value)}"` : ''}>${num(v.value)}</b> ${unit}`;
  if (v.state === 'extra') return `On target, ${number} extra`;
  return `${number} ${v.state === 'over' ? 'over' : 'left'}`;
}

function kcalBarHtml(eaten, target) {
  const max = Math.max(target * 1.12, eaten, 1);
  const ratio = Math.min(eaten / max, 1).toFixed(4);
  return `
    <div class="ruler ruler--kcal" aria-hidden="true">
      <div class="ruler__track"><div class="ruler__fill" data-k="kcal" data-ratio="${ratio}" style="transform:scaleX(${ratio})"></div></div>
      <i class="ruler__target" style="left:${((target / max) * 100).toFixed(2)}%"></i>
    </div>`;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
let lastSummary = null;

// 同一天的数据变了（加了食物、改了体重）时，让进度条和大数字从旧值过渡到新值。
// 切换日期或标签页不算变化，直接显示，不做动画
function animateSummary() {
  const now = { date };
  for (const el of document.querySelectorAll('.ruler__fill')) now[el.dataset.k] = Number(el.dataset.ratio);
  const $count = document.querySelector('.kcal__gap [data-count]');
  if ($count) now.count = Number($count.dataset.count);

  const prev = lastSummary;
  lastSummary = now;
  if (!prev || prev.date !== date || reduceMotion.matches) return;

  for (const el of document.querySelectorAll('.ruler__fill')) {
    const from = prev[el.dataset.k];
    const to = now[el.dataset.k];
    if (from === undefined || from === to) continue;
    el.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: 450, easing: EASE_OUT });
  }
  if ($count && prev.count !== undefined && prev.count !== now.count) {
    const start = performance.now();
    const tick = (t) => {
      if (!$count.isConnected) return;
      const p = Math.min((t - start) / 450, 1);
      const eased = 1 - (1 - p) ** 4;
      $count.textContent = num(Math.round(prev.count + (now.count - prev.count) * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function rulerHtml(eatenMult, targetMult, key) {
  const max = Math.max(targetMult, eatenMult, 0.4) * 1.12;
  const step = max > 3.4 ? 1 : max > 1.2 ? 0.5 : 0.25;
  const pct = (v) => `${Math.min((v / max) * 100, 100).toFixed(2)}%`;
  const ratio = Math.min(eatenMult / max, 1).toFixed(4);
  let ticks = '';
  // 贴着右边缘的刻度文字会溢出，留一点余量
  for (let t = step; t < max * 0.96; t += step) {
    ticks += `<i class="ruler__tick" style="left:${pct(t)}"><span>${t}×</span></i>`;
  }
  return `
    <div class="ruler" aria-hidden="true">
      <div class="ruler__track"><div class="ruler__fill" data-k="${key}" data-ratio="${ratio}" style="transform:scaleX(${ratio})"></div></div>
      ${ticks}
      <i class="ruler__target" style="left:${pct(targetMult)}"></i>
    </div>`;
}

function macroRowHtml(k, eaten, target, mult, kg) {
  const v = verdict(KIND[k], eaten[k], target[k]);
  return `
    <article class="macro macro--${k}">
      <div class="macro__head">
        <h2>${NAMES[k]}</h2>
        <p class="macro__gap ${v.over ? 'is-over' : ''}">${verdictHtml(v, 'g')}</p>
      </div>
      ${rulerHtml(mult[k], target[k] / kg, k)}
      <div class="macro__foot">
        <span>Eaten ${num(eaten[k])} g, ${mult[k]}× body weight</span>
        <span>${KIND[k] === 'floor' ? 'At least' : 'Target'} ${num(target[k])} g</span>
      </div>
    </article>`;
}

function entriesHtml(entries) {
  if (entries.length === 0) {
    return '<p class="empty">Nothing logged for this day yet. Tap “Add food” below to log what you ate.</p>';
  }
  return `<ul class="entries">${entries.map((e) => `
    <li class="${e.id === justAdded ? 'is-new' : ''}">
      <button type="button" class="entry" data-act="edit-entry" data-id="${esc(e.id)}">
        <span class="entry__name">${esc(e.name)}${e.qty ? `<small>${esc(qtyLabel(e.qty))}</small>` : ''}</span>
        <span class="entry__kcal">${num(kcalOf(e))} kcal</span>
        <span class="entry__macros">${macroLine(e)}</span>
      </button>
      <button type="button" class="iconbtn iconbtn--quiet" data-act="delete-entry" data-id="${esc(e.id)}" aria-label="Delete ${esc(e.name)}">×</button>
    </li>`).join('')}</ul>`;
}

function summaryHtml() {
  const entries = state.entries[date] ?? [];
  const eaten = sumEntries(entries);
  const eatenKcal = sumKcal(entries);
  const kg = weightOn(state.weights, date);

  if (kg === null) {
    return `
      <section class="kcal">
        <p class="kcal__gap"><b>${num(eatenKcal)}</b> kcal eaten</p>
        <p class="kcal__detail">${macroLine(eaten)}</p>
      </section>
      <p class="notice">Enter your weight above and this will show how much of each macro you have left, based on multiples of your body weight.</p>
      <section class="log"><h2>Food log</h2>${entriesHtml(entries)}</section>`;
  }

  const target = dailyTarget(state.settings, kg);
  const mult = multiples(eaten, kg);
  const v = verdict('ceiling', eatenKcal, target.kcal);
  return `
    <section class="kcal">
      <p class="kcal__gap ${v.over ? 'is-over' : ''}">${verdictHtml(v, 'kcal', true)}</p>
      ${kcalBarHtml(eatenKcal, target.kcal)}
      <p class="kcal__detail">Eaten ${num(eatenKcal)} of ${num(target.kcal)} kcal</p>
    </section>
    <section class="macros">${MACROS.map((k) => macroRowHtml(k, eaten, target, mult, kg)).join('')}</section>
    <section class="log"><h2>Food log</h2>${entriesHtml(entries)}</section>`;
}

const refreshSummary = () => {
  document.getElementById('summary').innerHTML = summaryHtml();
  animateSummary();
};

// ---------- 趋势页 ----------

const signed = (n) => `${n > 0 ? '+' : ''}${num(n)}`;

function rateHtml() {
  const { unit } = state.settings;
  const rate = weeklyRate(state.weights, today);
  if (!rate.ok) {
    return `<p class="hint">${plural(rate.weighIns, 'weigh-in')} across ${plural(rate.spanDays, 'day')} in the last 21 days. It takes at least 4 weigh-ins across 7 days to work out your weekly rate.</p>`;
  }
  const loss = -rate.pctPerWeek;
  let note;
  if (loss > 1) note = 'Faster than the commonly advised 0.5–1% per week. Losing this fast makes muscle loss more likely; consider raising your calorie target a little.';
  else if (loss >= 0.5) note = 'Within the commonly advised 0.5–1% per week.';
  else if (loss >= 0.25) note = 'Going down, but slower than the commonly advised 0.5–1% per week.';
  else if (loss > -0.25) note = 'Roughly flat, which means you have been eating about what you burn.';
  else note = 'Going up, which means you have been eating more than you burn.';
  return `
    <p class="stat"><b>${signed(toDisplayWeight(rate.kgPerWeek, unit))}</b> ${unit} per week<small>${num(Math.abs(rate.pctPerWeek))}% of body weight</small></p>
    <p class="hint">Based on ${plural(rate.weighIns, 'weigh-in')} in the last 21 days. ${note}</p>`;
}

function intakeHtml() {
  const intake = averageIntake(state.entries, today);
  if (!intake) return '<p class="hint">No food logged in the past 7 days.</p>';
  return `
    <p class="stat"><b>${num(intake.kcal)}</b> kcal per day<small>${plural(intake.days, 'day')} logged</small></p>
    <p class="entry__macros">${macroLine(intake)}</p>
    <p class="hint">A single day matters little; the weekly average tells you more. Today is not included.</p>`;
}

function expenditureHtml() {
  const est = estimateExpenditure(state.weights, state.entries, today);
  if (!est.ok) {
    const need = EXPENDITURE_NEEDS;
    const formula = bestExpenditure();
    return `
      <p class="hint">Once you have logged enough, this works out how much you actually burn each day from what you eat and how your weight changes. Progress over the last 28 days:</p>
      <ul class="needs">
        <li>Weigh-ins: <b>${est.weighIns}</b> / ${need.weighIns}</li>
        <li>Days from first to last weigh-in: <b>${est.spanDays}</b> / ${need.spanDays}</li>
        <li>Days with food logged: <b>${est.loggedDays}</b> / ${need.loggedDays}</li>
      </ul>
      ${formula
        ? `<p class="note">Until then, the formula estimates you burn about ${num(formula.kcal)} kcal a day. ${deficitNote(latestTarget().target)}</p>`
        : '<p class="hint">For a reference right now, fill in sex, birth year, height and activity level on the Goals tab to get a formula estimate.</p>'}`;
  }
  const [low, high] = [round50(est.low), round50(est.high)];
  const { target } = latestTarget();
  return `
    <p class="stat">About <b>${num(round50(est.kcal))}</b> kcal${low === high ? '' : `<small>likely between ${num(low)} and ${num(high)}</small>`}</p>
    <p class="note">${deficitNote(target)}</p>
    <p class="hint">Estimated from ${plural(est.loggedDays, 'day')} of food logs (averaging ${num(est.avgIntake)} kcal) and ${plural(est.weighIns, 'weigh-in')} in the last 28 days. Days that were only partly logged push this too low. In the first week or two of a cut most of the loss is water, which pushes it too high.</p>`;
}

function trendsHtml() {
  const { unit } = state.settings;
  const from = trendRange ? shiftDate(today, -trendRange) : '';
  const inRange = (d) => d.date >= from;
  const raw = Object.keys(state.weights).sort()
    .map((k) => ({ date: k, value: toDisplayWeight(state.weights[k], unit) })).filter(inRange);
  // 平均值用全部历史算，再截取范围，这样范围开头的平均也是完整的 7 天
  const avg = rollingAverage(state.weights)
    .map((a) => ({ date: a.date, value: toDisplayWeight(a.kg, unit) })).filter(inRange);

  let change = '';
  if (avg.length >= 2) {
    const diff = Math.round((avg[avg.length - 1].value - avg[0].value) * 10) / 10;
    change = `<p class="trend__change">7-day average since ${dayLabel(avg[0].date)}: <b>${signed(diff)}</b> ${unit}</p>`;
  }

  const days = [...new Set([...Object.keys(state.weights), ...Object.keys(state.entries).filter((k) => state.entries[k].length)])]
    .filter((k) => k >= from).sort().reverse();

  const rows = days.map((k) => {
    const eaten = sumEntries(state.entries[k]);
    const kcal = sumKcal(state.entries[k]);
    const kg = weightOn(state.weights, k);
    const own = state.weights[k];
    let versus = '';
    if (kg !== null && kcal > 0) {
      const v = verdict('ceiling', kcal, dailyTarget(state.settings, kg).kcal);
      versus = `<small class="${v.over ? 'is-over' : ''}">${v.state === 'met' ? 'on target' : `${num(v.value)} ${v.over ? 'over' : 'under'}`}</small>`;
    }
    return `
      <li><button type="button" class="day" data-act="open-day" data-date="${k}">
        <span class="day__date">${dayLabel(k)}<small>${weekday(k)}</small></span>
        <span class="day__weight">${own ? `${toDisplayWeight(own, unit)} ${unit}` : 'no weigh-in'}</span>
        <span class="day__kcal">${kcal ? `${num(kcal)} kcal` : 'no food logged'}${versus}</span>
        <span class="day__macros">${kcal ? macroLine(eaten) : ''}</span>
      </button></li>`;
  }).join('');

  return `
    <header class="page__head">
      <h1>Trends</h1>
      <div class="seg" role="group" aria-label="Time range">
        ${[[30, '30 days'], [90, '90 days'], [0, 'All']].map(([v, label]) => `<button type="button" data-act="set-range" data-range="${v}" aria-pressed="${v === trendRange}">${label}</button>`).join('')}
      </div>
    </header>
    <section class="panel trend">
      <h2>Weight (${unit})</h2>
      ${raw.length ? `
        ${weightChartSvg(raw, avg, unit)}
        <p class="legend"><span class="legend__dot"></span>Daily weigh-in<span class="legend__line"></span>7-day average</p>
        ${change}
        ${rateHtml()}` : '<p class="empty">No weight logged in this period. Enter your weight on the Log tab and the trend shows up here.</p>'}
    </section>
    <section class="panel trend">
      <h2>Average intake, past 7 days</h2>
      ${intakeHtml()}
    </section>
    <section class="panel trend">
      <h2>Energy burned per day (estimate)</h2>
      ${expenditureHtml()}
    </section>
    <section class="log">
      <h2>By day</h2>
      ${rows ? `<ul class="days">${rows}</ul>` : '<p class="empty">Nothing logged in this period.</p>'}
    </section>`;
}

// ---------- 食物库页 ----------

const basisLabel = (basis) => (basis === '100g' ? 'per 100 g' : 'per serving');

function foodsHtml() {
  const list = state.foods.map((f) => `
    <li><button type="button" class="entry" data-act="edit-food" data-id="${esc(f.id)}">
      <span class="entry__name">${esc(f.name)}<small>${basisLabel(f.basis)}</small></span>
      <span class="entry__kcal">${num(kcalOf(f))} kcal</span>
      <span class="entry__macros">${macroLine(f)}</span>
    </button></li>`).join('');
  return `
    <header class="page__head"><h1>My foods</h1></header>
    <p class="lede">Save the foods you eat often. When logging, pick one and enter the amount, and the macros are worked out for you.</p>
    ${list ? `<ul class="entries">${list}</ul>` : '<p class="empty">No saved foods yet. Tap “New food” below and copy the numbers from the nutrition label once.</p>'}
    <button type="button" class="btn btn--primary fab" data-act="new-food"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New food</button>`;
}

// ---------- 目标页 ----------

const kcalMode = () => state.settings.mode === 'kcal' && state.settings.kcalTarget != null;
const latestTarget = () => {
  const kg = weightOn(state.weights, today);
  return { kg, target: kg === null ? null : dailyTarget(state.settings, kg) };
};

function targetDerived(k, target, kg) {
  if (target === null) return 'Enter your weight to see grams';
  if (k === 'c' && kcalMode()) {
    return `Carbs get the remaining calories: ${num(target.c)} g a day, ${Math.round((target.c / kg) * 100) / 100}× body weight`;
  }
  return `${num(target[k])} g a day, ${num(Math.round(target[k] * KCAL_PER_G[k]))} kcal`;
}

function targetTotal(target) {
  if (target === null || state.settings.mode === 'kcal') return '';
  return `Total <b>${num(target.kcal)}</b> kcal`;
}

// 当前最可信的每日消耗：记录够了用反推的，否则用公式；都没有则为 null
function bestExpenditure() {
  const est = estimateExpenditure(state.weights, state.entries, today);
  if (est.ok) return { kcal: round50(est.kcal), source: 'data' };
  const formula = totalEnergy(state.settings.profile, weightOn(state.weights, today), thisYear());
  return formula === null ? null : { kcal: round50(formula), source: 'formula' };
}

// 目标和估算消耗相比是多大的缺口；估算不出来时返回空串
function deficitNote(target) {
  const best = bestExpenditure();
  if (!best || target === null) return '';
  const { unit } = state.settings;
  const deficit = best.kcal - target.kcal;
  if (deficit <= 0) return `Your target of ${num(target.kcal)} kcal is not below your estimated burn, so your weight will not go down at this intake.`;
  return `Your target of ${num(target.kcal)} kcal is a deficit of about ${num(round50(deficit))} kcal a day, or roughly ${toDisplayWeight(kgPerWeekFromDeficit(deficit), unit)} ${unit} lost per week.`;
}

function targetNotes(target) {
  const { mode, kcalTarget, targets } = state.settings;
  const notes = [];
  if (mode === 'kcal' && kcalTarget == null) notes.push('Enter a daily calorie total and carbs will take whatever is left. Until then the three multipliers still apply.');
  if (target?.overBudget) notes.push('<span class="is-over">Protein and fat already add up to more than your calorie total, so carbs are set to 0. Raise the total, or lower the protein or fat multiplier.</span>');
  if (targets.p < 1.6) notes.push('Protein is below the 1.6–2.4 g/kg commonly used when cutting, which makes muscle loss more likely.');
  if (targets.f < 0.5) notes.push('Fat is below the commonly advised minimum of 0.5 g/kg.');
  const best = bestExpenditure();
  if (best && target) {
    notes.push(`${best.source === 'data' ? 'Based on your recent logs' : 'By formula'}, you burn about ${num(best.kcal)} kcal a day. ${deficitNote(target)}`);
  }
  return notes.map((n) => `<p class="hint">${n}</p>`).join('');
}

function stepperHtml(id, value, act, attrs, step, name, unit) {
  return `
    <div class="stepper">
      <button type="button" class="iconbtn" data-act="${act}" ${attrs} data-delta="-${step}" aria-label="Decrease ${name} by ${step}">−</button>
      <input id="${id}" ${attrs} type="text" inputmode="decimal" autocomplete="off" value="${value ?? ''}">
      <button type="button" class="iconbtn" data-act="${act}" ${attrs} data-delta="${step}" aria-label="Increase ${name} by ${step}">+</button>
      <span>${unit}</span>
    </div>`;
}

function energyHtml() {
  const { unit, profile } = state.settings;
  const kg = weightOn(state.weights, today);
  if (kg === null) return '<p class="hint">Enter your weight on the Log tab first.</p>';
  const resting = restingEnergy(profile, kg, thisYear());
  if (resting === null) return '<p class="hint">Fill in sex, birth year and height to see your resting energy.</p>';
  const restingHtml = `<p class="stat">Resting energy about <b>${num(round50(resting))}</b> kcal<small>What you burn lying still all day</small></p>`;
  const total = totalEnergy(profile, kg, thisYear());
  if (total === null) return `${restingHtml}<p class="hint">Pick an activity level to see your total daily energy.</p>`;

  const best = bestExpenditure();
  const range = intakeRangeForLoss(best.kcal, kg);
  // 建议的摄入不低于静息消耗
  const floor = round50(resting);
  const low = Math.max(round50(range.low), floor);
  const high = Math.max(round50(range.high), low);
  return `
    ${restingHtml}
    <p class="stat">Total daily energy about <b>${num(round50(total))}</b> kcal<small>Resting energy × activity level</small></p>
    ${best.source === 'data' ? `<p class="note">Working back from your recent food and weight logs, you actually burn about ${num(best.kcal)} kcal. Where the two differ, trust this one; the suggestion below uses it.</p>` : ''}
    <p class="note">To lose ${toDisplayWeight(kg * 0.005, unit)}–${toDisplayWeight(kg * 0.01, unit)} ${unit} per week (0.5–1% of body weight), eat about ${low === high ? num(low) : `${num(low)}–${num(high)}`} kcal a day.${round50(range.low) < floor ? ' The lower end is capped at your resting energy; eating below that for long is not advised.' : ''}</p>
    <p class="hint">The formula is Mifflin-St Jeor. It is within about ±10% for most people, and activity level is the hardest part to judge. After two weeks of logging, the Trends tab works this out from your own data, which is more accurate.</p>`;
}

function profileHtml() {
  const { profile } = state.settings;
  return `
    <section class="panel profile">
      <fieldset class="radios">
        <legend>Sex (the formula needs it)</legend>
        ${[['male', 'Male'], ['female', 'Female']].map(([v, label]) => `<label><input type="radio" name="sex" value="${v}" ${profile.sex === v ? 'checked' : ''}> ${label}</label>`).join('')}
      </fieldset>
      <div class="field-row">
        ${field('profile-year', 'Birth year', profile.birthYear ?? '', 'inputmode="numeric" placeholder="e.g. 1995"')}
        ${field('profile-cm', 'Height (cm)', profile.heightCm ?? '', 'inputmode="decimal" placeholder="e.g. 175"')}
      </div>
      <fieldset class="radios radios--stack">
        <legend>Activity level</legend>
        ${ACTIVITY_LEVELS.map((a) => `<label><input type="radio" name="activity" value="${a.value}" ${profile.activity === a.value ? 'checked' : ''}> <span>${a.name}<small>${a.detail}</small></span></label>`).join('')}
      </fieldset>
      <div id="energy-result">${energyHtml()}</div>
    </section>`;
}

function settingsHtml() {
  const { unit, targets, mode, kcalTarget } = state.settings;
  const { kg, target } = latestTarget();
  const basis = kg === null ? '' : ` Based on your latest weight, ${toDisplayWeight(kg, unit)} ${unit}${unit === 'lb' ? ` (${toDisplayWeight(kg, 'kg')} kg)` : ''}.`;
  const intro = mode === 'kcal'
    ? 'Set your daily calories first, then protein and fat as multiples of body weight. Carbs get whatever calories are left.'
    : 'Grams per kilogram of body weight per day. Total calories are the three added up.';
  const macroRow = (k) => `
    <div class="target macro--${k}">
      <label ${mode === 'kcal' && k === 'c' ? '' : `for="target-${k}"`}>${NAMES[k]}</label>
      ${mode === 'kcal' && k === 'c' ? '' : stepperHtml(`target-${k}`, targets[k], 'step', `data-macro="${k}"`, 0.1, NAMES[k], 'g/kg')}
      <p data-derived="${k}">${targetDerived(k, target, kg)}</p>
    </div>`;
  return `
    <header class="page__head"><h1>Daily goals</h1></header>
    <h2 class="section-title">How much you burn</h2>
    ${profileHtml()}
    <h2 class="section-title">How much to eat</h2>
    <div class="seg seg--wide" role="group" aria-label="How goals are set">
      <button type="button" data-act="set-mode" data-mode="multiples" aria-pressed="${mode !== 'kcal'}">Three multipliers</button>
      <button type="button" data-act="set-mode" data-mode="kcal" aria-pressed="${mode === 'kcal'}">Fixed calories</button>
    </div>
    <p class="lede lede--after-seg">${intro}${basis}</p>
    <section class="panel targets">
      ${mode === 'kcal' ? `
        <div class="target target--kcal">
          <label for="target-kcal">Daily calories</label>
          ${stepperHtml('target-kcal', kcalTarget, 'step-kcal', '', 50, 'daily calories', 'kcal')}
        </div>` : ''}
      ${(mode === 'kcal' ? ['p', 'f', 'c'] : MACROS).map(macroRow).join('')}
      <p class="targets__total" id="target-total">${targetTotal(target)}</p>
    </section>
    <div class="notes" id="target-notes">${targetNotes(target)}</div>

    <section class="backup">
      <h2>Backup</h2>
      <p class="lede">Your data lives only in this device’s browser and is never uploaded. Export a copy before clearing browser data or switching phones.</p>
      <div class="backup__actions">
        <button type="button" class="btn" data-act="export">Export backup</button>
        <button type="button" class="btn" data-act="import">Import backup</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>`;
}

function refreshTargetDerived() {
  const { kg, target } = latestTarget();
  for (const k of MACROS) {
    document.querySelector(`[data-derived="${k}"]`).textContent = targetDerived(k, target, kg);
  }
  document.getElementById('target-total').innerHTML = targetTotal(target);
  document.getElementById('target-notes').innerHTML = targetNotes(target);
}

function refreshEnergy() {
  document.getElementById('energy-result').innerHTML = energyHtml();
  refreshTargetDerived();
}

// ---------- 渲染 ----------

const VIEWS = { today: todayHtml, trends: trendsHtml, foods: foodsHtml, settings: settingsHtml };

function render() {
  $view.innerHTML = VIEWS[view]();
  $view.dataset.view = view;
  if (view === 'today') animateSummary();
  justAdded = null;
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
  </div>
  ${field('f-kcal', 'Calories (optional)', m.kcal ?? '')}
  <p class="hint hint--field">Leave blank to calculate at 4 kcal/g for protein and carbs and 9 for fat. That overcounts foods with fiber or sugar alcohols, so the number on the label is more accurate.</p>`;

function entrySheetHtml() {
  const { tab, foodId, editId } = sheetState;
  const editing = editId ? (state.entries[date] ?? []).find((e) => e.id === editId) : null;
  const food = state.foods.find((f) => f.id === foodId);

  const tabs = editing ? '' : `
    <div class="seg seg--wide" role="group" aria-label="How to enter">
      <button type="button" data-act="sheet-tab" data-tab="foods" aria-pressed="${tab === 'foods'}">From my foods</button>
      <button type="button" data-act="sheet-tab" data-tab="manual" aria-pressed="${tab === 'manual'}">Enter manually</button>
    </div>`;

  let body;
  if (tab === 'foods') {
    body = state.foods.length === 0
      ? '<p class="empty">No saved foods yet. Switch to “Enter manually” and tick “Save to my foods” to pick it here next time.</p>'
      : `
        <div class="foodpick">
          ${state.foods.map((f) => `<button type="button" data-act="pick-food" data-id="${esc(f.id)}" aria-pressed="${f.id === foodId}">${esc(f.name)}</button>`).join('')}
        </div>
        ${food ? `
          ${field('f-amount', food.basis === '100g' ? 'Grams eaten' : 'Servings eaten', food.basis === '100g' ? '100' : '1')}
          <p class="preview" id="preview"></p>` : '<p class="hint">Pick a food, then enter how much you ate.</p>'}`;
  } else {
    body = `
      ${field('f-name', 'Name', editing?.name ?? '', 'placeholder="e.g. Chicken breast"')}
      ${macroFields(editing ?? {})}
      <p class="preview" id="preview"></p>
      ${editing ? '' : '<label class="check"><input type="checkbox" id="f-save"> Save to my foods for next time</label>'}`;
  }

  const canSubmit = tab === 'manual' || food;
  return `
    <form id="sheet-form" novalidate>
      ${GRAB}
      <header class="sheet__head">
        <h2>${editing ? 'Edit entry' : 'Add food'}</h2>
        <button type="button" class="iconbtn iconbtn--quiet" data-act="close-sheet" aria-label="Close">×</button>
      </header>
      ${tabs}
      ${body}
      <p class="form-error" id="form-error" role="alert" hidden></p>
      ${canSubmit ? `<button type="submit" class="btn btn--primary">${editing ? 'Save changes' : `Add to ${dayLabel(date)}`}</button>` : ''}
    </form>`;
}

function foodSheetHtml() {
  const editing = state.foods.find((f) => f.id === sheetState.editId);
  const basis = editing?.basis ?? '100g';
  return `
    <form id="sheet-form" novalidate>
      ${GRAB}
      <header class="sheet__head">
        <h2>${editing ? 'Edit food' : 'New food'}</h2>
        <button type="button" class="iconbtn iconbtn--quiet" data-act="close-sheet" aria-label="Close">×</button>
      </header>
      ${field('f-name', 'Name', editing?.name ?? '', 'placeholder="e.g. Oats"')}
      <fieldset class="radios">
        <legend>The macros below are</legend>
        <label><input type="radio" name="basis" value="100g" ${basis === '100g' ? 'checked' : ''}> per 100 g</label>
        <label><input type="radio" name="basis" value="serving" ${basis === 'serving' ? 'checked' : ''}> per serving</label>
      </fieldset>
      ${macroFields(editing ?? {})}
      <p class="preview" id="preview"></p>
      <p class="form-error" id="form-error" role="alert" hidden></p>
      <button type="submit" class="btn btn--primary">${editing ? 'Save changes' : 'Save to my foods'}</button>
      ${editing ? '<button type="button" class="btn btn--danger" data-act="delete-food">Delete from my foods</button>' : ''}
    </form>`;
}

const GRAB = '<div class="sheet__grab" aria-hidden="true"></div>';

function renderSheet() {
  $sheet.innerHTML = sheetState.kind === 'entry' ? entrySheetHtml() : foodSheetHtml();
  refreshPreview();
}

function openSheet(next) {
  sheetState = next;
  renderSheet();
  if (!$sheet.open) {
    $sheet.style.transform = '';
    $sheet.showModal();
  }
}

function readMacros() {
  const m = {};
  for (const k of MACROS) m[k] = parseNum(document.getElementById(`f-${k}`).value) ?? 0;
  // 卡路里没填时不带 kcal 字段，交给 4/4/9 自动算
  const kcal = parseNum(document.getElementById('f-kcal').value);
  if (kcal !== null) m.kcal = kcal;
  return m;
}

const hasBadNumber = (m) => Object.values(m).some(Number.isNaN);

// 当前面板里将要记下的营养素；填得不完整时返回 null
function draftMacros() {
  if (sheetState.kind === 'entry' && sheetState.tab === 'foods') {
    const food = state.foods.find((f) => f.id === sheetState.foodId);
    const amount = food ? parseNum(document.getElementById('f-amount').value) : null;
    return food && amount ? foodPortion(food, amount) : null;
  }
  const m = readMacros();
  return hasBadNumber(m) ? null : m;
}

function refreshPreview() {
  const $preview = document.getElementById('preview');
  if (!$preview) return;
  const m = draftMacros();
  const $kcal = document.getElementById('f-kcal');
  if ($kcal) $kcal.placeholder = m ? `Calculated: ${num(calories(m))}` : '';
  $preview.innerHTML = m ? `<b>${num(kcalOf(m))} kcal</b>${macroLine(m)}` : '';
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
    if (!amount) return formError('Enter a number greater than 0.');
    justAdded = uid();
    list.push({
      id: justAdded,
      name: food.name,
      qty: food.basis === '100g' ? `${num(amount)} g` : plural(amount, 'serving'),
      ...foodPortion(food, amount),
    });
  } else {
    const m = readMacros();
    if (hasBadNumber(m)) return formError('Macros and calories must be numbers, such as 23.5.');
    if (MACROS.every((k) => m[k] === 0)) return formError('Enter grams for at least one macro.');
    const name = document.getElementById('f-name').value.trim() || 'Unnamed food';
    const editing = list.find((e) => e.id === sheetState.editId);
    if (editing) {
      // 手动改过数值后，原来的「200 g」已不可信；卡路里清空则回到自动算
      delete editing.qty;
      delete editing.kcal;
      Object.assign(editing, { name, ...m });
    } else {
      justAdded = uid();
      list.push({ id: justAdded, name, ...m });
      if (document.getElementById('f-save').checked) {
        state.foods.push({ id: uid(), name, basis: 'serving', ...m });
      }
    }
  }
  persist();
  if (justAdded) navigator.vibrate?.(10);
  $sheet.close();
  render();
}

function submitFood() {
  const name = document.getElementById('f-name').value.trim();
  const m = readMacros();
  if (!name) return formError('Give this food a name.');
  if (hasBadNumber(m)) return formError('Macros and calories must be numbers, such as 23.5.');
  if (MACROS.every((k) => m[k] === 0)) return formError('Enter grams for at least one macro.');
  const basis = document.querySelector('input[name="basis"]:checked').value;
  const editing = state.foods.find((f) => f.id === sheetState.editId);
  if (editing) {
    delete editing.kcal;
    Object.assign(editing, { name, basis, ...m });
  }
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
  a.download = `macro-tracker-backup-${today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch {
    showToast('Import failed: not a valid backup file. Your data was not changed.');
    return;
  }
  if (!confirm('Importing replaces all of your current data with the backup. Continue?')) return;
  Object.assign(state, parsed);
  persist();
  render();
  showToast('Backup imported');
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
    showToast(`Deleted “${removed.name}”`, {
      label: 'Undo',
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
    showToast(`Deleted “${removed.name}” from my foods`, {
      label: 'Undo',
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

  'step-kcal': (el) => {
    const base = state.settings.kcalTarget ?? latestTarget().target?.kcal;
    if (base == null) return;
    state.settings.kcalTarget = Math.max(0, base + Number(el.dataset.delta));
    document.getElementById('target-kcal').value = state.settings.kcalTarget;
    persist();
    refreshTargetDerived();
  },
  'set-mode': (el) => {
    const { settings } = state;
    // 首次切到定总热量时沿用三倍数算出的合计，目标不会突变
    if (el.dataset.mode === 'kcal' && settings.kcalTarget == null) {
      settings.kcalTarget = latestTarget().target?.kcal ?? null;
    }
    settings.mode = el.dataset.mode;
    persist();
    render();
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
  } else if (el.id === 'target-kcal') {
    const n = parseNum(el.value);
    el.classList.toggle('is-invalid', Number.isNaN(n));
    if (Number.isNaN(n)) return;
    state.settings.kcalTarget = n;
    persist();
    refreshTargetDerived();
  } else if (el.id?.startsWith('profile-')) {
    const { profile } = state.settings;
    const n = parseNum(el.value);
    if (el.id === 'profile-year') {
      // 年份要输完四位才合理，输入过程中先当作没填
      const valid = isBirthYear(n);
      el.classList.toggle('is-invalid', n !== null && !valid && el.value.trim().length >= 4);
      profile.birthYear = valid ? n : null;
    } else {
      el.classList.toggle('is-invalid', Number.isNaN(n));
      if (Number.isNaN(n)) return;
      profile.heightCm = n;
    }
    persist();
    refreshEnergy();
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
  const { name, value } = event.target;
  if (name === 'sex' || name === 'activity') {
    state.settings.profile[name] = name === 'sex' ? value : Number(value);
    persist();
    refreshEnergy();
    return;
  }
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
// 点面板上方的遮罩关闭。按坐标判断：拖拽时指针被面板捕获，松手的 click 也会落在面板上
$sheet.addEventListener('click', (event) => {
  if (event.target === $sheet && event.clientY < $sheet.getBoundingClientRect().top) $sheet.close();
});

// 按住把手或标题往下拖可以关闭面板：跟手移动，松手时看速度和距离决定关还是弹回
let drag = null;
// 往上拖没有更多内容，越拖阻力越大
const rubberband = (overshoot, size) => (overshoot * size * 0.55) / (size + 0.55 * overshoot);

$sheet.addEventListener('pointerdown', (event) => {
  if (drag || !event.target.closest('.sheet__grab, .sheet__head') || event.target.closest('button')) return;
  drag = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 };
  $sheet.setPointerCapture(event.pointerId);
  $sheet.style.transition = 'none';
});

$sheet.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const dy = event.clientY - drag.startY;
  const dt = event.timeStamp - drag.lastT;
  if (dt > 0) drag.velocity = (event.clientY - drag.lastY) / dt; // px/ms
  drag.lastY = event.clientY;
  drag.lastT = event.timeStamp;
  const y = dy >= 0 ? dy : -rubberband(-dy, $sheet.offsetHeight);
  $sheet.style.transform = `translateY(${y}px)`;
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dy = event.clientY - drag.startY;
  // 手指停住再松开时不会再有 move 事件，上一次的速度已经过期，不能算作一甩
  const paused = event.timeStamp - drag.lastT > 80;
  const flick = !paused && drag.velocity > 0.5 && dy > 0;
  const far = dy > $sheet.offsetHeight * 0.3;
  drag = null;
  // 恢复 CSS 过渡后再清掉内联位移，面板会从当前位置继续滑走或弹回
  $sheet.style.transition = '';
  $sheet.style.transform = '';
  if (event.type === 'pointerup' && (flick || far)) $sheet.close();
}
$sheet.addEventListener('pointerup', endDrag);
$sheet.addEventListener('pointercancel', endDrag);

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

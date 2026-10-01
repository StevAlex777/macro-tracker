import {
  MACROS, calories, kcalOf, sumKcal, sumEntries, multiples, weightOn, foodPortion,
  fromInputWeight, toDisplayWeight, dateKey, parseDateKey, shiftDate,
  rollingAverage, weeklyRate, averageIntake, estimateExpenditure, EXPENDITURE_NEEDS, kgPerWeekFromDeficit,
  dailyTarget, status,
  restingEnergy, totalEnergy, intakeRangeForLoss, ftInToCm, cmToFtIn, ACTIVITY_LEVELS,
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
const round50 = (n) => Math.round(n / 50) * 50;

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

// 蛋白质是下限（吃够就行），碳水、脂肪和总热量是上限
const KIND = { p: 'floor', c: 'ceiling', f: 'ceiling' };

// 把「吃了多少 / 目标多少」变成界面上的一句话。达标区间内不再报差几克
function verdict(kind, eaten, target) {
  const st = status(kind, eaten, target);
  const diff = Math.abs(Math.round((eaten - target) * 10) / 10);
  if (st === 'under') return { label: '还差', value: diff, over: false };
  if (st === 'over') return { label: '超出', value: diff, over: true };
  // 蛋白质明显吃多时说明多了多少，但不算超
  const surplus = status('ceiling', eaten, target) === 'over';
  return surplus ? { label: '已达标，多', value: diff, over: false } : { label: '已达标', value: null, over: false };
}

const verdictHtml = (v, unit) => (
  v.value === null ? `<b class="is-met">${v.label}</b>` : `${v.label} <b>${num(v.value)}</b> ${unit}`
);

function rulerHtml(eatenMult, targetMult) {
  const max = Math.max(targetMult, eatenMult, 0.4) * 1.12;
  const step = max > 3.4 ? 1 : max > 1.2 ? 0.5 : 0.25;
  const pct = (v) => `${Math.min((v / max) * 100, 100).toFixed(2)}%`;
  let ticks = '';
  // 贴着右边缘的刻度文字会溢出，留一点余量
  for (let t = step; t < max * 0.96; t += step) {
    ticks += `<i class="ruler__tick" style="left:${pct(t)}"><span>${t}×</span></i>`;
  }
  return `
    <div class="ruler" aria-hidden="true">
      <div class="ruler__track"><div class="ruler__fill" style="width:${pct(eatenMult)}"></div></div>
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
      ${rulerHtml(mult[k], target[k] / kg)}
      <div class="macro__foot">
        <span>已吃 ${num(eaten[k])} g，体重的 ${mult[k]} 倍</span>
        <span>${KIND[k] === 'floor' ? '至少' : '目标'} ${num(target[k])} g</span>
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
        <span class="entry__kcal">${num(kcalOf(e))} kcal</span>
        <span class="entry__macros">${macroLine(e)}</span>
      </button>
      <button type="button" class="iconbtn iconbtn--quiet" data-act="delete-entry" data-id="${esc(e.id)}" aria-label="删除 ${esc(e.name)}">×</button>
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
        <p class="kcal__gap">已吃 <b>${num(eatenKcal)}</b> kcal</p>
        <p class="kcal__detail">${macroLine(eaten)}</p>
      </section>
      <p class="notice">先在上面输入体重，这里就会按「体重的几倍」算出每种营养素还差多少。</p>
      <section class="log"><h2>吃了什么</h2>${entriesHtml(entries)}</section>`;
  }

  const target = dailyTarget(state.settings, kg);
  const mult = multiples(eaten, kg);
  const v = verdict('ceiling', eatenKcal, target.kcal);
  return `
    <section class="kcal">
      <p class="kcal__gap ${v.over ? 'is-over' : ''}">${verdictHtml(v, 'kcal')}</p>
      <p class="kcal__detail">已吃 ${num(eatenKcal)}，目标 ${num(target.kcal)} kcal</p>
    </section>
    <section class="macros">${MACROS.map((k) => macroRowHtml(k, eaten, target, mult, kg)).join('')}</section>
    <section class="log"><h2>吃了什么</h2>${entriesHtml(entries)}</section>`;
}

const refreshSummary = () => { document.getElementById('summary').innerHTML = summaryHtml(); };

// ---------- 趋势页 ----------

const signed = (n) => `${n > 0 ? '+' : ''}${num(n)}`;

function rateHtml() {
  const { unit } = state.settings;
  const rate = weeklyRate(state.weights, today);
  if (!rate.ok) {
    return `<p class="hint">最近 21 天称了 ${rate.weighIns} 次、前后跨 ${rate.spanDays} 天。至少称 4 次并跨 7 天，才能算出每周的变化速度。</p>`;
  }
  const loss = -rate.pctPerWeek;
  let note;
  if (loss > 1) note = '比常见建议的每周 0.5–1% 快。降得太快更容易掉肌肉，可以把目标热量调高一些。';
  else if (loss >= 0.5) note = '在常见建议的每周 0.5–1% 范围内。';
  else if (loss >= 0.25) note = '在下降，但比常见建议的每周 0.5–1% 慢。';
  else if (loss > -0.25) note = '基本持平，说明这段时间吃的量大约等于消耗。';
  else note = '体重在上升，说明这段时间吃的量高于消耗。';
  return `
    <p class="stat">每周 <b>${signed(toDisplayWeight(rate.kgPerWeek, unit))}</b> ${unit}<small>体重的 ${num(Math.abs(rate.pctPerWeek))}%</small></p>
    <p class="hint">按最近 21 天的 ${rate.weighIns} 次称重算出。${note}</p>`;
}

function intakeHtml() {
  const intake = averageIntake(state.entries, today);
  if (!intake) return '<p class="hint">过去 7 天还没有饮食记录。</p>';
  return `
    <p class="stat">每天 <b>${num(intake.kcal)}</b> kcal<small>${intake.days} 天有记录</small></p>
    <p class="entry__macros">${macroLine(intake)}</p>
    <p class="hint">单独某一天的多少不重要，看一周的平均更准。不含今天。</p>`;
}

function expenditureHtml() {
  const est = estimateExpenditure(state.weights, state.entries, today);
  if (!est.ok) {
    const need = EXPENDITURE_NEEDS;
    const formula = bestExpenditure();
    return `
      <p class="hint">记录够多之后，这里会用你吃的量和体重的变化，反推你每天实际消耗多少。最近 28 天的进度：</p>
      <ul class="needs">
        <li>称重 <b>${est.weighIns}</b> / ${need.weighIns} 次</li>
        <li>称重前后跨 <b>${est.spanDays}</b> / ${need.spanDays} 天</li>
        <li>饮食记录 <b>${est.loggedDays}</b> / ${need.loggedDays} 天</li>
      </ul>
      ${formula
        ? `<p class="note">在那之前，按公式估算每天消耗约 ${num(formula.kcal)} kcal。${deficitNote(latestTarget().target)}</p>`
        : '<p class="hint">想现在就有个参考，到「目标」页填性别、年龄、身高和活动量，可以先按公式估算。</p>'}`;
  }
  const [low, high] = [round50(est.low), round50(est.high)];
  const { target } = latestTarget();
  return `
    <p class="stat">约 <b>${num(round50(est.kcal))}</b> kcal${low === high ? '' : `<small>可能在 ${num(low)}–${num(high)} 之间</small>`}</p>
    <p class="note">${deficitNote(target)}</p>
    <p class="hint">用最近 28 天里 ${est.loggedDays} 天的饮食记录（平均 ${num(est.avgIntake)} kcal）和 ${est.weighIns} 次称重估算。有的天没记全会让结果偏低；刚开始减脂的头一两周掉的多是水分，会让结果偏高。</p>`;
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
    change = `<p class="trend__change">7 天平均从${dayLabel(avg[0].date)}至今 <b>${signed(diff)}</b> ${unit}</p>`;
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
      versus = `<small class="${v.over ? 'is-over' : ''}">${v.value === null ? '达标' : `${v.over ? '超' : '差'} ${num(v.value)}`}</small>`;
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
      ${raw.length ? `
        ${weightChartSvg(raw, avg, unit)}
        <p class="legend"><span class="legend__dot"></span>每天称的<span class="legend__line"></span>7 天平均</p>
        ${change}
        ${rateHtml()}` : '<p class="empty">这段时间还没有体重记录。在「记录」页输入体重，这里会画出变化曲线。</p>'}
    </section>
    <section class="panel trend">
      <h2>近 7 天平均摄入</h2>
      ${intakeHtml()}
    </section>
    <section class="panel trend">
      <h2>每天实际消耗（估算）</h2>
      ${expenditureHtml()}
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
      <span class="entry__kcal">${num(kcalOf(f))} kcal</span>
      <span class="entry__macros">${macroLine(f)}</span>
    </button></li>`).join('');
  return `
    <header class="page__head"><h1>食物库</h1></header>
    <p class="lede">把常吃的食物存在这里，记录时选中它、填重量，营养素会自动算好。</p>
    ${list ? `<ul class="entries">${list}</ul>` : '<p class="empty">食物库还是空的。点下面的「新增食物」，照着包装上的营养成分表填一次就行。</p>'}
    <button type="button" class="btn btn--primary fab" data-act="new-food">新增食物</button>`;
}

// ---------- 目标页 ----------

const kcalMode = () => state.settings.mode === 'kcal' && state.settings.kcalTarget != null;
const latestTarget = () => {
  const kg = weightOn(state.weights, today);
  return { kg, target: kg === null ? null : dailyTarget(state.settings, kg) };
};

function targetDerived(k, target, kg) {
  if (target === null) return '输入体重后显示克数';
  if (k === 'c' && kcalMode()) {
    return `剩下的热量都给碳水：每天 ${num(target.c)} g，体重的 ${Math.round((target.c / kg) * 100) / 100} 倍`;
  }
  return `每天 ${num(target[k])} g，${num(Math.round(target[k] * KCAL_PER_G[k]))} kcal`;
}

function targetTotal(target) {
  if (target === null || state.settings.mode === 'kcal') return '';
  return `合计 <b>${num(target.kcal)}</b> kcal`;
}

// 当前最可信的每日消耗：记录够了用反推的，否则用公式；都没有则为 null
function bestExpenditure() {
  const est = estimateExpenditure(state.weights, state.entries, today);
  if (est.ok) return { kcal: round50(est.kcal), source: 'data' };
  const formula = totalEnergy(state.settings.profile, weightOn(state.weights, today));
  return formula === null ? null : { kcal: round50(formula), source: 'formula' };
}

// 目标和估算消耗相比是多大的缺口；估算不出来时返回空串
function deficitNote(target) {
  const best = bestExpenditure();
  if (!best || target === null) return '';
  const { unit } = state.settings;
  const deficit = best.kcal - target.kcal;
  if (deficit <= 0) return `现在的目标 ${num(target.kcal)} kcal 不低于估算的消耗，照这样吃体重不会降。`;
  return `现在的目标 ${num(target.kcal)} kcal 相当于每天缺口约 ${num(round50(deficit))} kcal，照这样每周大约降 ${toDisplayWeight(kgPerWeekFromDeficit(deficit), unit)} ${unit}。`;
}

function targetNotes(target) {
  const { mode, kcalTarget, targets } = state.settings;
  const notes = [];
  if (mode === 'kcal' && kcalTarget == null) notes.push('填入每日总热量后，碳水会自动取剩下的部分。在那之前仍按三个倍数计算。');
  if (target?.overBudget) notes.push('<span class="is-over">蛋白质和脂肪加起来已经超过总热量，碳水被记为 0。调高总热量，或调低蛋白质、脂肪的倍数。</span>');
  if (targets.p < 1.6) notes.push('蛋白质低于减脂期常用的 1.6–2.4 g/kg，更容易掉肌肉。');
  if (targets.f < 0.5) notes.push('脂肪低于常见建议的下限 0.5 g/kg。');
  const best = bestExpenditure();
  if (best && target) {
    notes.push(`${best.source === 'data' ? '按你最近的记录反推' : '按公式估算'}，每天消耗约 ${num(best.kcal)} kcal。${deficitNote(target)}`);
  }
  return notes.map((n) => `<p class="hint">${n}</p>`).join('');
}

function stepperHtml(id, value, act, attrs, step, name, unit) {
  return `
    <div class="stepper">
      <button type="button" class="iconbtn" data-act="${act}" ${attrs} data-delta="-${step}" aria-label="${name}减少 ${step}">−</button>
      <input id="${id}" ${attrs} type="text" inputmode="decimal" autocomplete="off" value="${value ?? ''}">
      <button type="button" class="iconbtn" data-act="${act}" ${attrs} data-delta="${step}" aria-label="${name}增加 ${step}">+</button>
      <span>${unit}</span>
    </div>`;
}

function energyHtml() {
  const { unit, profile } = state.settings;
  const kg = weightOn(state.weights, today);
  if (kg === null) return '<p class="hint">先在「记录」页输入体重，这里才能算。</p>';
  const resting = restingEnergy(profile, kg);
  if (resting === null) return '<p class="hint">填好性别、年龄和身高，就能算出静息消耗。</p>';
  const restingHtml = `<p class="stat">静息消耗约 <b>${num(round50(resting))}</b> kcal<small>整天躺着也会消耗的量</small></p>`;
  const total = totalEnergy(profile, kg);
  if (total === null) return `${restingHtml}<p class="hint">再选一个活动量，就能算出每日总消耗。</p>`;

  const best = bestExpenditure();
  const range = intakeRangeForLoss(best.kcal, kg);
  // 建议的摄入不低于静息消耗
  const floor = round50(resting);
  const low = Math.max(round50(range.low), floor);
  const high = Math.max(round50(range.high), low);
  return `
    ${restingHtml}
    <p class="stat">每日总消耗约 <b>${num(round50(total))}</b> kcal<small>静息消耗 × 活动量</small></p>
    ${best.source === 'data' ? `<p class="note">按你最近的饮食和体重记录反推，实际消耗约 ${num(best.kcal)} kcal。两个数不一样时以这个为准，下面的建议按它算。</p>` : ''}
    <p class="note">想每周降 ${toDisplayWeight(kg * 0.005, unit)}–${toDisplayWeight(kg * 0.01, unit)} ${unit}（体重的 0.5–1%），每天吃大约 ${low === high ? num(low) : `${num(low)}–${num(high)}`} kcal。${round50(range.low) < floor ? '下限没有低于静息消耗，不建议长期吃得比它还少。' : ''}</p>
    <p class="hint">公式是 Mifflin-St Jeor，对多数人的误差在 ±10% 左右，活动量是最估不准的一项。连续记录两周后，「趋势」页会用你自己的数据反推，比公式准。</p>`;
}

function profileHtml() {
  const { unit, profile } = state.settings;
  const height = profile.heightCm === null ? { ft: '', inch: '' } : cmToFtIn(profile.heightCm);
  return `
    <section class="panel profile">
      <fieldset class="radios">
        <legend>性别（公式需要）</legend>
        ${[['male', '男'], ['female', '女']].map(([v, label]) => `<label><input type="radio" name="sex" value="${v}" ${profile.sex === v ? 'checked' : ''}> ${label}</label>`).join('')}
      </fieldset>
      <div class="field-row">
        ${field('profile-age', '年龄', profile.age ?? '')}
        ${unit === 'lb'
          ? field('profile-ft', '身高（英尺）', height.ft) + field('profile-in', '英寸', height.inch)
          : field('profile-cm', '身高（厘米）', profile.heightCm ?? '')}
      </div>
      <fieldset class="radios radios--stack">
        <legend>活动量</legend>
        ${ACTIVITY_LEVELS.map((a) => `<label><input type="radio" name="activity" value="${a.value}" ${profile.activity === a.value ? 'checked' : ''}> <span>${a.name}<small>${a.detail}</small></span></label>`).join('')}
      </fieldset>
      <div id="energy-result">${energyHtml()}</div>
    </section>`;
}

function settingsHtml() {
  const { unit, targets, mode, kcalTarget } = state.settings;
  const { kg, target } = latestTarget();
  const basis = kg === null ? '' : `按最近的体重 ${toDisplayWeight(kg, unit)} ${unit}${unit === 'lb' ? `（${toDisplayWeight(kg, 'kg')} kg）` : ''}计算。`;
  const intro = mode === 'kcal'
    ? '先定每天的总热量，再定蛋白质和脂肪各吃体重的几倍，剩下的热量都给碳水。'
    : '每公斤体重每天吃多少克，总热量是三者相加的结果。';
  const macroRow = (k) => `
    <div class="target macro--${k}">
      <label ${mode === 'kcal' && k === 'c' ? '' : `for="target-${k}"`}>${NAMES[k]}</label>
      ${mode === 'kcal' && k === 'c' ? '' : stepperHtml(`target-${k}`, targets[k], 'step', `data-macro="${k}"`, 0.1, NAMES[k], 'g/kg')}
      <p data-derived="${k}">${targetDerived(k, target, kg)}</p>
    </div>`;
  return `
    <header class="page__head"><h1>每日目标</h1></header>
    <h2 class="section-title">你每天消耗多少</h2>
    ${profileHtml()}
    <h2 class="section-title">每天吃多少</h2>
    <div class="seg seg--wide" role="group" aria-label="目标的设法">
      <button type="button" data-act="set-mode" data-mode="multiples" aria-pressed="${mode !== 'kcal'}">三个倍数</button>
      <button type="button" data-act="set-mode" data-mode="kcal" aria-pressed="${mode === 'kcal'}">定总热量</button>
    </div>
    <p class="lede lede--after-seg">${intro}${basis}</p>
    <section class="panel targets">
      ${mode === 'kcal' ? `
        <div class="target target--kcal">
          <label for="target-kcal">每日总热量</label>
          ${stepperHtml('target-kcal', kcalTarget, 'step-kcal', '', 50, '每日总热量', 'kcal')}
        </div>` : ''}
      ${(mode === 'kcal' ? ['p', 'f', 'c'] : MACROS).map(macroRow).join('')}
      <p class="targets__total" id="target-total">${targetTotal(target)}</p>
    </section>
    <div class="notes" id="target-notes">${targetNotes(target)}</div>

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
  ${field('f-kcal', '卡路里（选填）', m.kcal ?? '')}
  <p class="hint hint--field">不填就按蛋白质 4、碳水 4、脂肪 9 自动算。含膳食纤维或糖醇的食物会算高，照包装上的数字填更准。</p>`;

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
  if ($kcal) $kcal.placeholder = m ? `自动算是 ${num(calories(m))}` : '';
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
    if (!amount) return formError('填一个大于 0 的数字。');
    list.push({
      id: uid(),
      name: food.name,
      qty: food.basis === '100g' ? `${num(amount)} g` : `${num(amount)} 份`,
      ...foodPortion(food, amount),
    });
  } else {
    const m = readMacros();
    if (hasBadNumber(m)) return formError('营养素和卡路里只能填数字，比如 23.5。');
    if (MACROS.every((k) => m[k] === 0)) return formError('至少填一种营养素的克数。');
    const name = document.getElementById('f-name').value.trim() || '未命名食物';
    const editing = list.find((e) => e.id === sheetState.editId);
    if (editing) {
      // 手动改过数值后，原来的「200 g」已不可信；卡路里清空则回到自动算
      delete editing.qty;
      delete editing.kcal;
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
  if (hasBadNumber(m)) return formError('营养素和卡路里只能填数字，比如 23.5。');
  if (MACROS.every((k) => m[k] === 0)) return formError('至少填一种营养素的克数。');
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
    el.classList.toggle('is-invalid', Number.isNaN(n));
    if (Number.isNaN(n)) return;
    if (el.id === 'profile-age') profile.age = n;
    else if (el.id === 'profile-cm') profile.heightCm = n;
    else {
      const ft = parseNum(document.getElementById('profile-ft').value);
      const inch = parseNum(document.getElementById('profile-in').value) ?? 0;
      if (Number.isNaN(ft) || Number.isNaN(inch)) return;
      profile.heightCm = ft === null ? null : ftInToCm(ft, inch);
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

import {
  schedule, previewIntervals, humanInterval, GRADES,
} from './srs.js';

// ---------- Хранилище ----------
const LS_STATES = 'flashcards.v1.states'; // расписание по карточкам
const LS_META = 'flashcards.v1.meta';     // настройки и дневная статистика

const DEFAULT_META = {
  cardsUrl: './cards.json',
  newPerDay: 20,
  daily: { date: '', newDone: 0, reviews: 0 },
};

let deck = [];        // [{ id, q, a }]
let states = {};      // id -> состояние SM-2
let meta = structuredClone(DEFAULT_META);
let session = [];     // очередь id на сейчас
let flipped = false;
let practiceMode = false; // «пройти все заново»: листаем всю колоду, расписание не трогаем
let sessionLog = {};      // id -> 'again' | 'hard': что отметили трудным за этот прогон

// ---------- Утилиты ----------
const $ = (sel) => document.querySelector(sel);

// Стабильный id из текста вопроса (djb2). При правке вопроса прогресс начнётся заново.
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'c' + h.toString(36);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function load() {
  try { states = JSON.parse(localStorage.getItem(LS_STATES)) || {}; } catch { states = {}; }
  try {
    meta = { ...structuredClone(DEFAULT_META), ...(JSON.parse(localStorage.getItem(LS_META)) || {}) };
    meta.daily = { ...DEFAULT_META.daily, ...(meta.daily || {}) };
  } catch { meta = structuredClone(DEFAULT_META); }
}
const saveStates = () => localStorage.setItem(LS_STATES, JSON.stringify(states));
const saveMeta = () => localStorage.setItem(LS_META, JSON.stringify(meta));

const byId = (id) => deck.find((c) => c.id === id);

// Приводим разные форматы файла к [{id,q,a}].
function normalize(data) {
  const cards = [];
  const push = (q, a) => {
    if (q == null || a == null) return;
    q = String(q); a = String(a);
    cards.push({ id: hashId(q), q, a });
  };
  if (Array.isArray(data)) {
    for (const it of data) push(it.q ?? it.question ?? it.front, it.a ?? it.answer ?? it.back);
  } else if (data && typeof data === 'object') {
    for (const [q, a] of Object.entries(data)) push(q, a);
  }
  return cards;
}

// ---------- Данные ----------
async function loadDeck() {
  const url = meta.cardsUrl || './cards.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const cards = normalize(data);
  if (!cards.length) throw new Error('В файле нет карточек');
  deck = cards;
}

function rolloverDaily() {
  const today = new Date().toISOString().slice(0, 10);
  if (meta.daily.date !== today) {
    meta.daily = { date: today, newDone: 0, reviews: 0 };
    saveMeta();
  }
}

function buildSession() {
  practiceMode = false; // обычная учёба по расписанию
  sessionLog = {};
  rolloverDaily();
  const now = Date.now();
  const dueIds = [];
  const newIds = [];
  for (const c of deck) {
    const s = states[c.id];
    if (!s) newIds.push(c.id);
    else if (s.due <= now) dueIds.push(c.id);
  }
  shuffle(dueIds);
  shuffle(newIds);
  const remainingNew = Math.max(0, meta.newPerDay - meta.daily.newDone);
  session = shuffle([...dueIds, ...newIds.slice(0, remainingNew)]);
}

// Когда станет доступна следующая карточка (для экрана «всё на сегодня»).
function nextDueLabel() {
  const now = Date.now();
  let min = Infinity;
  for (const c of deck) {
    const s = states[c.id];
    if (s && s.due > now) min = Math.min(min, s.due);
  }
  if (min === Infinity) return null;
  const ms = min - now;
  const h = Math.round(ms / 3600000);
  if (h < 1) return `через ${Math.max(1, Math.round(ms / 60000))} мин`;
  if (h < 24) return `через ${h} ч`;
  return `через ${Math.round(h / 24)} д`;
}

// Свободное повторение: прогоняем колоду (или подмножество id) заново, не меняя расписание SRS.
function startPractice(ids) {
  const pool = (Array.isArray(ids) && ids.length ? ids : deck.map((c) => c.id)).filter(byId);
  if (!pool.length) return;
  practiceMode = true;
  sessionLog = {};
  session = shuffle(pool);
  flipped = false;
  render();
}

// Запоминаем карточки, которые дались тяжело («не помню» важнее «трудно»).
function logStruggle(id, grade) {
  if (grade === 'again') sessionLog[id] = 'again';
  else if (grade === 'hard' && sessionLog[id] !== 'again') sessionLog[id] = 'hard';
}

// ---------- Оценка ----------
function gradeCurrent(grade) {
  const id = session[0];
  if (!id) return;
  logStruggle(id, grade);

  // В режиме повторения расписание не трогаем — просто листаем дальше.
  if (practiceMode) {
    session.shift();
    if (grade === 'again') session.push(id); // «Не помню» — вернуть в конец круга
    if (!session.length) practiceMode = false;
    flipped = false;
    render();
    return;
  }

  const wasNew = !(id in states);
  states[id] = schedule(states[id], grade, Date.now());
  if (wasNew) meta.daily.newDone += 1;
  meta.daily.reviews += 1;
  saveStates();
  saveMeta();

  session.shift();
  if (grade === 'again') session.push(id); // вернуть в конец текущей сессии
  flipped = false;
  render();
}

// ---------- Рендер ----------
function render() {
  const card = byId(session[0]);
  const empty = !card;

  $('#empty-state').hidden = !empty;
  $('#card-area').hidden = empty;
  $('#controls').hidden = empty;

  // Шапка: обычная статистика или индикатор режима повторения.
  $('#study-stats').hidden = practiceMode;
  $('#mode-badge').hidden = !practiceMode;
  if (practiceMode) {
    $('#mode-badge').textContent = `🔁 Повторение · осталось ${session.length}`;
  } else {
    const newLeft = session.filter((id) => !(id in states)).length;
    $('#stat-review').textContent = session.length - newLeft;
    $('#stat-new').textContent = newLeft;
    $('#stat-done').textContent = meta.daily.reviews;
  }

  if (empty) {
    const nd = nextDueLabel();
    $('#next-due').textContent = nd ? `Следующее повторение ${nd}.` : 'Новых карточек на сегодня тоже нет.';
    renderStruggle();
    return;
  }

  $('#question').textContent = card.q;
  $('#answer').textContent = card.a;
  $('#card').classList.toggle('flipped', flipped);
  $('#card').setAttribute('aria-label', flipped ? 'Ответ' : 'Вопрос. Нажмите, чтобы показать ответ');

  $('#show-btn').hidden = flipped;
  $('#grades').hidden = !flipped;

  if (flipped) {
    // В режиме повторения интервалы не показываем — расписание не меняется.
    $('#grades').classList.toggle('no-when', practiceMode);
    if (!practiceMode) {
      const preview = previewIntervals(states[card.id] || null);
      for (const g of GRADES) {
        const btn = document.querySelector(`.grade[data-grade="${g}"] .grade-when`);
        if (btn) btn.textContent = humanInterval(preview[g]);
      }
    }
  }
}

// Список карточек, которые дались тяжело за прогон (для экрана завершения).
function renderStruggle() {
  const items = Object.entries(sessionLog)
    .map(([id, grade]) => ({ card: byId(id), grade }))
    .filter((x) => x.card)
    .sort((a, b) => (a.grade === 'again' ? 0 : 1) - (b.grade === 'again' ? 0 : 1));

  const box = $('#struggle');
  const btn = $('#review-hard-btn');
  box.hidden = !items.length;
  btn.hidden = !items.length;
  if (!items.length) return;

  $('#struggle-title').textContent = `Стоит повторить (${items.length})`;
  btn.textContent = `🔁 Повторить трудные (${items.length})`;

  const list = $('#struggle-list');
  list.replaceChildren();
  for (const { card, grade } of items) {
    const li = document.createElement('li');
    li.className = 'struggle-item';
    const tag = document.createElement('span');
    tag.className = `struggle-tag ${grade}`;
    tag.textContent = grade === 'again' ? 'не помню' : 'трудно';
    const q = document.createElement('span');
    q.className = 'struggle-q';
    q.textContent = card.q; // textContent — без риска XSS
    li.append(tag, q);
    list.appendChild(li);
  }
}

function flip() {
  if (!session.length) return;
  flipped = true;
  render();
}

// ---------- Тосты ----------
let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Обновление колоды ----------
async function refresh(silent = false) {
  try {
    const before = deck.length;
    await loadDeck();
    buildSession();
    flipped = false;
    render();
    if (!silent) {
      const diff = deck.length - before;
      toast(diff > 0 ? `Обновлено: +${diff} карточек` : 'Колода обновлена');
    }
  } catch (e) {
    toast(`Не удалось загрузить колоду: ${e.message}`, true);
  }
}

// ---------- Настройки ----------
function openSettings() {
  $('#url-input').value = meta.cardsUrl;
  $('#new-input').value = meta.newPerDay;
  $('#settings').showModal();
}

function saveSettings(e) {
  e.preventDefault();
  meta.cardsUrl = $('#url-input').value.trim() || './cards.json';
  meta.newPerDay = Math.max(0, parseInt($('#new-input').value, 10) || 0);
  saveMeta();
  $('#settings').close();
  refresh();
}

function resetProgress() {
  if (!confirm('Сбросить весь прогресс изучения? Карточки останутся, расписание обнулится.')) return;
  states = {};
  saveStates();
  meta.daily = { date: '', newDone: 0, reviews: 0 };
  saveMeta();
  $('#settings').close();
  buildSession();
  flipped = false;
  render();
  toast('Прогресс сброшен');
}

// ---------- Инициализация ----------
function wireEvents() {
  $('#card').addEventListener('click', flip);
  $('#show-btn').addEventListener('click', flip);
  $('#refresh-btn').addEventListener('click', () => refresh());
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#reset-btn').addEventListener('click', resetProgress);
  $('#practice-btn').addEventListener('click', () => startPractice());
  $('#review-hard-btn').addEventListener('click', () => startPractice(Object.keys(sessionLog)));

  for (const btn of document.querySelectorAll('.grade')) {
    btn.addEventListener('click', () => gradeCurrent(btn.dataset.grade));
  }

  // Горячие клавиши: пробел/Enter — перевернуть; 1–4 — оценки.
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (!flipped && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); flip(); return; }
    if (flipped) {
      const map = { Digit1: 'again', Digit2: 'hard', Digit3: 'good', Digit4: 'easy' };
      if (map[e.code]) { e.preventDefault(); gradeCurrent(map[e.code]); }
    }
  });
}

async function init() {
  load();
  wireEvents();
  try {
    await loadDeck();
  } catch (e) {
    toast(`Колода не загрузилась: ${e.message}`, true);
  }
  buildSession();
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();

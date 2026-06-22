// Интервальные повторения на основе алгоритма SM-2 (как в Anki).
// Чистые функции, без обращения к DOM — это удобно тестировать.

export const DAY = 86400000; // мс в сутках
export const GRADES = ['again', 'hard', 'good', 'easy'];

// Состояние одной карточки в расписании.
export function newCardState() {
  return { reps: 0, ef: 2.5, interval: 0, lapses: 0, due: 0, last: 0 };
}

// Считает новое состояние карточки после оценки.
// grade: 'again' | 'hard' | 'good' | 'easy'
export function schedule(state, grade, now = Date.now()) {
  let { reps = 0, ef = 2.5, interval = 0, lapses = 0 } = state || {};

  // «Не помню» — сбрасываем серию и показываем снова через минуту.
  if (grade === 'again') {
    return {
      reps: 0,
      ef: Math.max(1.3, ef - 0.2),
      interval: 0,
      lapses: lapses + 1,
      due: now + 60 * 1000,
      last: now,
    };
  }

  // Качество ответа по шкале SM-2: hard≈3, good≈4, easy≈5.
  const q = grade === 'hard' ? 3 : grade === 'good' ? 4 : 5;
  ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  reps += 1;
  if (reps === 1) {
    interval = grade === 'easy' ? 4 : 1;
  } else if (reps === 2) {
    interval = grade === 'hard' ? 3 : 6;
  } else {
    const factor = grade === 'hard' ? 1.2 : grade === 'easy' ? ef * 1.3 : ef;
    interval = Math.round(interval * factor);
  }
  interval = Math.max(1, interval);

  return { reps, ef, interval, lapses, due: now + interval * DAY, last: now };
}

// Прогноз состояния для каждой кнопки — чтобы показать «через сколько» на кнопках.
export function previewIntervals(state, now = Date.now()) {
  const out = {};
  for (const g of GRADES) out[g] = schedule(state, g, now);
  return out;
}

// Короткая человекочитаемая подпись интервала: «1 мин», «6 д», «2 мес», «1.4 г».
export function humanInterval(state, now = Date.now()) {
  if (!state) return '';
  if (state.interval === 0) {
    const min = Math.max(1, Math.round((state.due - now) / 60000));
    return `${min} мин`;
  }
  const d = state.interval;
  if (d < 30) return `${d} д`;
  if (d < 365) return `${(d / 30).toFixed(d < 90 ? 1 : 0)} мес`;
  return `${(d / 365).toFixed(1)} г`;
}

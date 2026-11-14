// Кэш ответов источников: держим только удачные ответы и незавершённые запросы.

// Раньше сюда попадали и неудачи, поэтому первая сетевая ошибка на холодном старте
// решала за всю страницу: сообщение «источник не ответил» висело до перезагрузки,
// а Ctrl+F5 повторял ту же неудачную попытку, потому что маршрут к хосту уже работал.
// Теперь неудача не запоминается: повтор (кнопка на странице или автоповтор) может
// пройти, и тот же id не долбит источник повторно в одну и ту же минуту, пока запрос
// ещё в полёте.

const done = new Map();
const inflight = new Map();

export default async function netCache(key, run, force = false) {
  if (!force && done.has(key)) return { ...done.get(key), cached: true };
  if (!force && inflight.has(key)) return inflight.get(key);

  const promise = run()
    .then((result) => {
      inflight.delete(key);

      if (result?.ok) done.set(key, result);

      return result;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });

  inflight.set(key, promise);

  return promise;
}

export function cachedResults() {
  return done;
}

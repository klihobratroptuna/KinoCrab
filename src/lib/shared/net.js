// Общий слой сети для проверок источников и Kinopoisk API.

// Почему через прокси: браузер может читать Kinopoisk и Alloha напрямую (у них открыт
// CORS), но на холодном старте маршрут браузера до этих хостов не работает, когда
// контейнер уже отвечает. Проверено замерами в один момент: PocketBase с localhost
// отвечает за 5 мс, запрос к прокси kodik — 226 мс, а прямой запрос из браузера к
// kinopoiskapiunofficial.tech и api.alloha.tv в этот же момент висит 12 секунд и
// обрывается. Из контейнера те же адреса проходят за 379 мс и 224 мс.
// Поэтому каждый запрос идёт сначала через прокси nginx — браузеру нужен только
// localhost:3000 — и только если прокси ошибся, пробуем напрямую из браузера.

// Повтор нужен, потому что на холодном старте падает чаще всего первая попытка:
// после неё те же запросы проходили за 60-300 мс. Пауза между попытками растёт,
// чтобы не долбить источник, который только что не ответил.

// Неудачу не запоминаем: кэшируем только удачный ответ (см. netCache.js). Раньше
// первое неудачное состояние оставалось в памяти до перезагрузки страницы, и
// Ctrl+F5 повторяло ту же неудачную попытку — на это и жаловались.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_ATTEMPTS = 2;
const PAUSE_MS = 600;

// Фоновый сервис (scripts/scrape-series.mjs) работает в Node, где браузера нет: путь
// прокси там относительный, и fetch() его не понимает — нужен base. BASE берём из
// окружения: в сети compose это http://web/ (тот же nginx), на машине разработчика
// http://localhost:3000. В браузере переменная пустая, путь остаётся относительным,
// и поведение запросов не меняется.
//
// Конечный слеш срезаем. Замер 2026-11-06: в compose NET_BASE задан со слешем
// («http://web/»), и join давал «http://web//api/tmdb/...» — двойной слеш. nginx
// подбирает апстрим по условию «$request_uri ~ "^/api/tmdb/..."», а «//api/tmdb/» под
// это условие не попадает: переменная остаётся неинициализированной и nginx отвечает
// 500 за 8 мс (в его логах «invalid URL prefix in ""»). С машины разработчика тот же
// путь шёл без двойного слеша и отвечал 200 — отсюда расхождение: один и тот же запрос
// работал из хоста и падал из контейнера. Срез слеша приводит оба пути к одному виду.
const NET_BASE = (globalThis.process?.env?.NET_BASE || '').replace(/\/+$/, '');

function reasonFor(error, timeoutMs) {
  // AbortController.abort() без причины даёт AbortError, таймаут соединителя nginx
  // даёт 504 — оба случая считаем «не ответил».
  if (error?.name === 'AbortError') return `не ответил за ${timeoutMs / 1000} секунд`;
  return `не дошёл: ${error?.message || error?.name || 'сеть'}`;
}

/**
 * paths — список адресов по порядку: сначала путь прокси nginx, потом прямой адрес
 * браузера. Возвращает { ok, status, text, data, reason, via, attempts, ms }.
 * Ответы 4xx считаем настоящим ответом источника и не повторяем: там повтор ничего
 * не меняет, а пользователю нужно показать причину.
 */
export default async function netFetch(paths, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const headers = opts.headers || {};
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);

  let last = { ok: false, status: 0, text: '', data: null, reason: 'не ответил', via: '', attempts: 0, ms: 0 };
  const notes = [];

  for (const path of list) {
    // Подпись пути: в браузере относительный путь — это прокси nginx («через контейнер»),
    // в фоновом скрипте тот же путь становится абсолютным через NET_BASE («через прокси»).
    // Прямой адрес в скрипте — это уже не браузер, а Node, поэтому там «напрямую».
    const target = path.startsWith('/') && NET_BASE ? NET_BASE + path : path;
    const via = path.startsWith('/')
      ? (NET_BASE ? 'через прокси' : 'через контейнер')
      : (NET_BASE ? 'напрямую' : 'из браузера');

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Метод и тело нужны не всем: JSON-RPC myshows принимает только POST. Для GET
        // поведение не меняется — без opts.method запрос остаётся обычным GET.
        const res = await fetch(target, {
          signal: controller.signal,
          ...(opts.method ? { method: opts.method } : {}),
          ...(opts.body ? { body: opts.body } : {}),
          ...(headers ? { headers } : {})
        });
        const text = await res.text().catch(() => '');

        if (res.ok) {
          return {
            ok: true,
            status: res.status,
            text,
            data: jsonOrNothing(text),
            reason: '',
            via,
            attempts: attempt,
            ms: Date.now() - started
          };
        }

        last = {
          ok: false,
          status: res.status,
          text,
          data: jsonOrNothing(text),
          reason: `ответил ${res.status}`,
          via,
          attempts: attempt,
          ms: Date.now() - started
        };

        notes.push(`${via}: ${res.status}`);

        // 4xx — источник ответил и отказал: повторять смысла нет, и такой ответ
        // не должен перекрывать удачный ответ другого пути.
        if (res.status < 500) return { ...last, notes };
      } catch (error) {
        last = {
          ok: false,
          status: 0,
          text: '',
          data: null,
          reason: reasonFor(error, timeoutMs),
          via,
          attempts: attempt,
          ms: Date.now() - started
        };
        notes.push(`${via}: ${last.reason}`);
      } finally {
        clearTimeout(timer);
      }

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * attempt));
      }
    }
  }

  return { ...last, notes };
}

function jsonOrNothing(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Короткая строка о том, куда именно не дошёл запрос: «через контейнер» — путь прокси
// nginx, «из браузера» — прямой запрос. Нужна, чтобы на странице было видно, какой
// путь не работает: контейнер отвечает всегда, а маршрут браузера на холодном старте
// падает первым.
export function netSummary(prefix, answer) {
  const notes = answer.notes?.length ? answer.notes.join(' · ') : answer.reason;

  return `${prefix} ${notes}`;
}

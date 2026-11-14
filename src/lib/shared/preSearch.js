// Pre-search: перед поиском по названию берём номер фильма одним запросом.
//
// Почему это нужно. Текстовый поиск Kodik ошибается больше чем в половине случаев —
// замер живыми запросами 2026-10-31:
//   «Чужая мама» без strict → первым «Чужая шуба» (1985), по strict → «Чужая» (1978);
//   «Идеальная работа» без strict → 5 результатов, из них 2 верные и 3 посторонние,
//     по strict → 2 результата, оба верные (serial-79386 и serial-79389);
//   «Баларао» → 0 результатов обоими способами, при этом тайтл в Kinopoisk есть.
// По номеру ошибки нет: search?kinopoisk_id=7791628 выдаёт ровно свою запись serial-79386
// (проверено запросом). Значит путь «сначала ID, и только потом текст» быстрее и точнее.
//
// Один запрос даёт оба id. Ответ v2.2 films?keyword содержит kinopoiskId и imdbId; в
// v2.1 search-by-keyword поля imdbId нет (проверено 2026-10-31: «Баларао» → filmId
// 14328310, imdbId отсутствует). У «Баларао» в v2.2 imdbId тоже null — у тайтла его просто
// нет, поэтому IMDb-путь используем только когда код действительно есть.
//
// Лимит — 500 запросов в сутки, и API его нигде не показывает: endpoint'а нет
// (проверено: /api/v2.1/account/info и /api/v1.3/account/info отвечают 400 «No static
// resource»), заголовков X-RateLimit-* нет ни в одном ответе. Поэтому счёт ведём сами:
// повторный запрос того же названия не отправляем вообще, а при исчерпанном бюджете
// прекращаем искать и говорим об этом прямо, а не выдаём пустой результат.
//
// Резерв: из 500 оставляем 100 на страницу поиска (она тоже ходит в Kinopoisk), модулю
// остаётся 400. Скрипт scripts/updater.js считает свой бюджет отдельно (100), и в сумме
// 400 + 100 = ровно 500: если бы оба считали по 400, вместе они вышли бы за лимит.
// Счётчик хранится в localStorage по дню Москвы: на следующий день он обнуляется,
// кэш ответов — тот же файл, он переживает перезагрузку. В фоновом сервисе (Node)
// localStorage нет, и там счёт дня живёт в памяти процесса — см. hasLocalStorage ниже.

// Замер 2026-11-03 по обоим ключам (одинаковые запросы, один и тот же API):
//   ключ 72a598a4-12da-4143-b09f-8511bde0c08e — 402 «You have sent 530 request, but
//   available 500 per day», то есть его квота в 500 реальна и уже была исчерпана;
//   ключ 4b12f46d-638b-4bac-bf06-33865d3a3524 (наш) — 1320 запросов подряд, все 200.
// Наш ключ оставляем именно по этой причине: его фактический суточный порог выше 500.
// Заголовков X-RateLimit-* API не отдаёт (проверено), поэтому единственный способ узнать
// о конце квоты — ответ 402; ниже он разбирается и закрывает счёт дня досрочно.

import apiFetch from '$lib/shared/api/_fetch';
import { todayKey } from '$lib/shared/moscowDate';
import netCache from '$lib/shared/netCache';

export const DAILY_CAP = 400;

// Ответ 402 приходит телом вида «You exceeded the quota. You have sent 530 request, but
// available 500 per day». Число из него и есть настоящий потолок ключа на сегодня: если
// он меньше нашего бюджета, закрываем счёт дня по факту, а не по своей цифре.
function quotaCap(message) {
	const match = String(message || '').match(/available\s+(\d+)\s+per\s+day/i);
	return match ? Number(match[1]) : 0;
}

const STORE_KEY = 'preSearch';

// Где живёт счёт дня. В браузере — localStorage (он переживает перезагрузку страницы).
// В фоновом сервисе Node хранилища нет, поэтому счёт держим в памяти процесса: он
// переживает проходы внутри одного запуска, а после перезапуска начинается заново.
// Это безопасно: скрипт тратит не больше LOOKUP_LIMIT проверок по имени за проход
// (60 в «Сериалах») и никогда не подходит к потолку ключа — 500 запросов в сутки.
const memory = new Map();

function hasLocalStorage() {
	return typeof localStorage !== 'undefined';
}

// Совпадение проверяем в коде: поиск по длинному имени с двоеточием и тире выдаёт
// посторонние тайтлы (проверено живым запросом 2026-10-29: «Шёпот смерти: Саминг –
// зверь-оборотень» → 0 карточек, «Чужая мама» → чужой фильм). Принимаем только точное
// совпадение имени, как в kinovibe.
function normName(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

// Карточка дорамы названа «Ягодная любовь 1 Сезон (2026)», а в Kinopoisk имя — «Ягодная
// любовь». Суффикс сезона и год в скобках убираем: полным именем поиск отвечает 0 результатов.
// Замер 2026-10-31 по шести сегодняшним карточкам: полное имя — 0 у всех, основа без суффикса
// находит 3 (Ягодная любовь 13424081, Заставь меня дрожать 14144619, Безмолвные — точное имя
// есть среди 11 результатов), ещё 3 в Kinopoisk действительно нет.
// Границу \b не используем: в JavaScript она работает только для [A-Za-z0-9_], после
// кириллического «сезон» её нет, и суффикс не снимался (проверено на первой версии функции).
function baseName(value) {
	return normName(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

function titleYear(value) {
	const match = String(value || '').match(/\b(19|20)\d{2}\b/);

	return match ? Number(match[0]) : 0;
}

// Кэш дня: { day, used, answers: { имя: { kinopoiskId, imdbId, ... } } }.
// Неудачу не запоминаем как ответ — иначе первая сетевая ошибка решала бы за всю страницу.
// Но запоминаем отметку «проверяли, не нашли»: это не то же самое, что неответивший запрос,
// и по этой отметке видно, что тайтл действительно проверяли.
function store() {
	if (hasLocalStorage()) {
		let data = null;

		try {
			data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
		} catch {
			data = null;
		}

		if (!data || typeof data !== 'object') data = { day: '', used: 0, cap: DAILY_CAP, answers: {} };

		if (data.day != todayKey()) {
			data = { day: todayKey(), used: 0, cap: DAILY_CAP, answers: {} };
		}

		return data;
	}

	// Node (фоновый сервис): тот же счёт дня, только в памяти процесса.
	if (!memory.has(STORE_KEY)) memory.set(STORE_KEY, { day: '', used: 0, cap: DAILY_CAP, answers: {} });

	const data = memory.get(STORE_KEY);

	if (data.day != todayKey()) memory.set(STORE_KEY, { day: todayKey(), used: 0, cap: DAILY_CAP, answers: {} });

	return memory.get(STORE_KEY);
}

function saveStore(data) {
	if (!hasLocalStorage()) return; // в Node счёт уже в памяти процесса, писать некуда

	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(data));
	} catch {
		// localStorage мог быть переполнен или закрыт частным режимом — счёт тогда только
		// в памяти страницы, и об этом написано в примечании к результату.
	}
}

/**
 * Запрос к Kinopoisk через общий счёт дня. Считается только тот запрос, который реально
 * ушёл в сеть: ответ дня из кэса счёт не увеличивает. Возвращает { ok, status, data, used }
 * или { ok: false, note, retry }. Этот же бюджет используют preSearch и модуль фильмов,
 * потому что лимит ключа — 500 запросов в сутки на весь проект: скрипт
 * scripts/updater.js тратит 100, браузер — 400 (сумма ровно 500).
 */
export async function kinopoiskGet(path, force = false) {
	const data = store();

	if (!data) {
		return { ok: false, note: 'кэш дня недоступен (хранилища нет: ни localStorage, ни памяти процесса)' };
	}

	// Потолок дня мог сузиться из ответа 402 (см. quotaCap): тогда считаем по нему,
	// а не по своей цифре DAILY_CAP.
	const cap = data.cap > 0 && data.cap < DAILY_CAP ? data.cap : DAILY_CAP;

	if (data.used >= cap) {
		return {
			ok: false,
			note: `бюджет Kinopoisk на сегодня исчерпан: ${data.used} из ${cap} запросов`
		};
	}

	return netCache(`preSearch:${path}`, async () => {
		data.used++;

		const answer = await apiFetch(`https://kinopoiskapiunofficial.tech${path}`);

		if (!answer.ok || !answer.data) {
			// 402 — квота ключа кончилась: закрепляем фактический потолок в счёт дня,
			// чтобы остальные модули (movieSource, kinovibe) не долбили API до конца дня.
			if (answer.status === 402) {
				const reported = quotaCap(answer.data?.message || answer.text);
				if (reported > 0 && reported < DAILY_CAP) data.cap = reported;
				saveStore(data);
			}

			return {
				ok: false,
				note: `Kinopoisk ${answer.status || 'не ответил'}: запрос ${data.used} из ${cap}`,
				retry: !answer.status || answer.status >= 500
			};
		}

		return { ok: true, status: answer.status, data: answer.data, used: data.used };
	}, force);
}

/**
 * Номер фильма и код IMDb по названию тайтла. Возвращает { ok, kinopoiskId, imdbId, year,
 * genre, poster, note, cached }. ok=true — только когда нашли тайтл; при сетевой ошибке
 * note говорит «не ответил», при пустом поиске — «проверяли, записи нет».
 */
export async function preSearch(title, force = false) {
	const name = baseName(title);
	const full = normName(title);
	const year = titleYear(title);

	if (!name) {
		return { ok: false, note: 'названия нет, искать нечем' };
	}

	const data = store();

	if (data?.answers?.[name]) {
		return { ...data.answers[name], cached: true };
	}

	if (!data) {
		return { ok: false, note: 'кэш дня недоступен (хранилища нет: ни localStorage, ни памяти процесса)' };
	}

	// v2.2, а не v2.1: только здесь в строке есть imdbId, и отдельного запроса ради него нет.
	const answer = await kinopoiskGet(
		`/api/v2.2/films?keyword=${encodeURIComponent(name)}&page=1`,
		force
	);

	if (!answer.ok) {
		return answer;
	}

	return lookup(name, data, answer, full, year);
}

async function lookup(name, data, answer, full, year) {
	const items = Array.isArray(answer.data.items) ? answer.data.items : [];
	const exact = items.filter(
		(item) =>
			normName(item.nameRu) === name ||
			normName(item.nameEn) === name ||
			(full !== name && normName(item.nameRu) === full)
	);

	if (!exact.length) {
		const result = {
			ok: false,
			note: `проверяли по «${name}»: ${answer.data.total || 0} результатов, ни одно имя не совпало`,
			checked: true,
			used: data.used
		};

		data.answers[name] = result;
		saveStore(data);

		return result;
	}

	// Совпадений может быть несколько, и первое не всегда наше: замер 2026-10-31 по
	// «Безмолвные» — два точных имени, 662203 (2013, Нидерланды/Венгрия) и 13003442
	// (2025, Россия), карточке 2026 года не соответствует ни одно. Поэтому берём запись
	// того же года, а при несовпадении года id не выдаём и пишем отметку.
	// Год у строки Kinopoisk бывает null — это новый тайтл без года в базе: замер
	// «Идеальная работа» (7791628, год null) — то же имя, что в карточке 2026 года. Такую
	// запись берём; отказываем только когда год известен и он другой.
	const fits = (item) => !year || !item.year || Number(item.year) === year;
	const good = exact.filter(fits);
	const match = good[0] || exact[0];

	if (!good.length && year) {
		const country = (Array.isArray(match.countries) ? match.countries : []).map((c) => c.country).filter(Boolean)[0] || '';

		const result = {
			ok: false,
			note: `имя совпало, но год другой: ${match.kinopoiskId} — ${match.year}${country ? `, ${country}` : ''} (в карточке ${year})`,
			checked: true,
			used: data.used
		};

		data.answers[name] = result;
		saveStore(data);

		return result;
	}

	const genres = (Array.isArray(match.genres) ? match.genres : []).map((item) => item?.name || item?.genre).filter(Boolean);
	const countries = (Array.isArray(match.countries) ? match.countries : []).map((item) => item?.country).filter(Boolean);

	const result = {
		ok: true,
		kinopoiskId: String(match.kinopoiskId || ''),
		imdbId: match.imdbId || '',
		year: match.year || '',
		genre: genres[0] || '',
		country: countries[0] || '',
		// Оценка приходит той же строкой: поля ratingKinopoisk и ratingImdb есть в ответе
		// v2.2 films?keyword (проверено живым запросом 2026-10-31 на «Баларао», где обе
		// оценки null — тайтл новый). Отдельного запроса ради оценки нет.
		rating: match.ratingKinopoisk || match.ratingImdb || '',
		ratingSource: match.ratingKinopoisk ? 'Кинопоиск' : match.ratingImdb ? 'IMDB' : '',
		poster: match.posterUrl || match.posterUrlPreview || '',
		type: match.type || '',
		note: `Kinopoisk ${match.kinopoiskId}, ${match.type || ''} (${match.year || 'год неизвестен'})` + (match.imdbId ? `, IMDb ${match.imdbId}` : ', IMDb нет'),
		used: data.used
	};

	data.answers[name] = result;
	saveStore(data);

	return result;
}

/** Сколько запросов Kinopoisk израсходовал этот модуль сегодня. Для отчёта в интерфейсе. */
export function preSearchUsage() {
	const data = store();

	if (!data) return { day: '', used: 0, cap: DAILY_CAP };

	// cap может быть сузён ответом 402 — в отчёте показываем фактический потолок дня.
	return { day: data.day, used: data.used, cap: data.cap > 0 ? data.cap : DAILY_CAP };
}

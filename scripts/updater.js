#!/usr/bin/env node
/*
 * scripts/updater.js — ежедневное наполнение трёх каруселей PocketBase из Kinopoisk.
 *
 *   node --env-file=.env scripts/updater.js                        # все три вкладки
 *   node --env-file=.env scripts/updater.js --mode movie           # только «Фильмы»
 *   node --env-file=.env scripts/updater.js --top 15 --prune      # топ-15, старые дни удалить
 *   node --env-file=.env scripts/updater.js --dry-run              # показать, что запишется
 *   node --env-file=.env scripts/updater.js --kodik                # id Kodik строго по номеру
 *
 * Замеры живыми запросами 2026-10-31 (ключ берём из .env, KINOPOISK_API_KEY; каждый запрос
 * с заголовком X-API-KEY):
 *   1. /api/v2.2/films/collections?type=TOP_POPULAR_MOVIES → 200, total 700. В строке есть
 *      kinopoiskId, imdbId, nameRu, year, genres, posterUrl — год, жанр и постер приходят
 *      тем же запросом, отдельного запроса «по названию» для них не нужно.
 *   2. type=TOP_POPULAR_SERIES → 400 «Failed to convert ... CollectionType». Сериальной
 *      подборки у API нет, поэтому вкладку «Дорамы» из Kinopoisk наполнить нечем: там остаётся
 *      выборка источника (kinovibe), а Kinopoisk даёт только id по названию.
 *   3. /films/premieres?month=10 → 400, месяц принимается именем (OCTOBER). С month=OCTOBER
 *      ответ 200, total 62, но фильтр country= игнорируется: в ответе 27 стран, корейских
 *      тайтлов 2. Дорамы по стране выбрать нельзя — этот путь не используем.
 *   4. В v2.1 search-by-keyword поля imdbId нет, в v2.2 films?keyword оно есть. Для «Баларао»
 *      (filmId 14328310) imdbId null — у тайтла его просто нет, поэтому IMDb-путь только когда
 *      код реально есть.
 *   5. Лимит 500 запросов в сутки API нигде не показывает: endpoint'а нет (проверено:
 *      /api/v2.1/account/info и /api/v1.3/account/info отвечают 400), заголовков X-RateLimit-*
 *      нет ни в одном ответе. Значит счёт ведём сами. Считаем отдельно: скрипт — 100 запросов
 *      (ему хватает ~20 в день: 1 на подборку и по одному на карточку дорам/аниме), браузер
 *      — 400 (src/lib/shared/preSearch.js). В сумме это 500, то есть ровно лимит; если бы
 *      оба считали по 400, вместе они могли бы выйти за него и получить 401.
 *
 * Кэш: scratch/updater-cache.json с счётчиком запросов дня. Повторный запуск в тот же день
 * не отправляет запросов — строки берутся из файла, потому что выборка TOP_POPULAR_*
 * меняется редко, а лимит кончается быстрее, чем кажется.
 *
 * Имена полей: схема PocketBase уже называет их kinopoiskId и poster, и их читает фронтенд.
 * Скрипт пишет в эти имена (не kinopoisk_id / poster_url), а year, genre и imdbId добавляет
 * миграция pb_migrations/1793300500_updated_carousel_fields.js.
 *
 * Про «удалять старые»: без --prune история дней остаётся, а карусель показывает самый свежий
 * день. С --prune в базе остаётся только сегодняшняя выборка — тогда история теряется, и это
 * выбор, а не случайность.
 */

import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';

const args = process.argv.slice(2);

function flag(name, dflt) {
	const named = args.find((a) => a.startsWith(`--${name}=`));

	if (named) return named.split('=').slice(1).join('=');

	const bare = args.indexOf(`--${name}`);

	// Флаг работает в обеих формах: --mode movie и --mode=movie. Первая написана в шапке,
	// поэтому парсер должен её принимать.
	if (bare >= 0) {
		const next = args[bare + 1];

		if (next && !next.startsWith('--')) return next;

		return true;
	}

	return dflt;
}

const TOP = Number(flag('top', 15));
const CAP = Number(flag('budget', 100));
const MODE = flag('mode', 'all');
const PRUNE = Boolean(flag('prune', false));
const DRY = Boolean(flag('dry-run', false));
const KODIK = Boolean(flag('kodik', false));
const KODIK_DELAY = Number(flag('kodik-delay', 700));
const PAUSE_MS = Number(flag('delay', 300));
const KEY = process.env.KINOPOISK_API_KEY || '';
const KODIK_TOKEN = process.env.KODIK_TOKEN || '';
const PB_URL = process.env.PB_URL || 'http://localhost:8090';
const CACHE_FILE = process.env.UPDATER_CACHE || 'scratch/updater-cache.json';
const API = 'https://kinopoiskapiunofficial.tech';
const KODIK_API = (process.env.KODIK_API_URL || 'https://kodik-api.com').replace(/\/+$/, '');

const COLLECTIONS = { movie: 'movie_carousel', drama: 'drama_carousel', anime: 'season_carousel' };

// День по Москве — тот же порядок, что в src/lib/shared/moscowDate.js: снимок показывается
// по дню, и счётчик лимита тоже привязан к московскому дню.
function todayKey() {
	return new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'Europe/Moscow' });
}

function normName(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

// Карточка дорамы названа «Ягодная любовь 1 Сезон (2026)», а в Kinopoisk имя «Ягодная
// любовь». Суффикс сезона и год в скобках убираем: с ними поиск по полному имени отвечает
// 0 результатов. Замер 2026-10-31 по шести сегодняшним карточкам: полное имя — 0 у всех,
// основа без суффикса находит 3 (Ягодная любовь 13424081, Заставь меня дрожать 14144619,
// Безмолвные — точное имя есть среди 11 результатов), ещё 3 в Kinopoisk действительно нет.
// Границу \b не используем: в JavaScript она работает только для [A-Za-z0-9_], после
// кириллического «сезон» её нет, и суффикс не снимался (проверено на первой версии функции).
function baseName(value) {
	return normName(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

// Кэш дня: ответы + счётчик запросов. Неудачу не запоминаем как ответ, но запоминаем
// отметку «проверяли, не нашли»: пустой поиск и неответивший запрос — разные вещи.
function loadCache() {
	let data = null;

	try {
		data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
	} catch {
		data = null;
	}

	if (!data || typeof data !== 'object') data = { day: '', used: 0, answers: {} };

	if (data.day != todayKey()) data = { day: todayKey(), used: 0, answers: {} };

	return data;
}

const cache = loadCache();

function saveCache() {
	if (DRY) return;

	fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
	fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(path, params = {}) {
	const url = `${API}${path}?${new URLSearchParams(params)}`;
	const key = `${path}?${new URLSearchParams(params)}`;

	if (cache.answers[key]) return { data: cache.answers[key], cached: true };

	if (cache.used >= CAP) {
		return { failed: true, reason: `бюджет на сегодня исчерпан: ${cache.used} из ${CAP}` };
	}

	cache.used++;

	try {
		const res = await fetch(url, { headers: { 'X-API-KEY': KEY } });
		const data = await res.json().catch(() => null);

		if (!res.ok) {
			// 402 — квота ключа кончилась. Наш ключ (4b12f46d…) по замеру 2026-11-03 держит
			// больше тысячи запросов в сутки, но потолок всё равно есть, и при 402 нужно
			// остановиться: дальнейшие попытки только повторяют тот же отказ.
			if (res.status === 402) return { failed: true, status: 402, reason: `квота дня: ${data?.message || 'HTTP 402'}` };

			return { failed: true, status: res.status, reason: `HTTP ${res.status}` };
		}

		cache.answers[key] = data;
		saveCache();

		return { data, status: res.status };
	} catch (error) {
		return { failed: true, reason: `не ответил (${error?.message || error?.name})` };
	}
}

function titleYear(value) {
	const match = String(value || '').match(/\b(19|20)\d{2}\b/);

	return match ? Number(match[0]) : 0;
}

/**
 * Совпадение проверяем в коде: поиск по длинному имени выдаёт посторонние тайтлы
 * (проверено 2026-10-29: «Чужая мама» → чужой фильм). Принимаем только точное имя.
 * Если точных имён несколько, берём то, у которого год совпадает с годом карточки:
 * замер 2026-10-31 по «Безмолвные 1 Сезон (2026)» — среди результатов два «Безмолвные»,
 * 662203 (2013, Нидерланды/Венгрия) и 13003442 (2025, Россия), ни один не 2026. Первый
 * вариант был неверным, поэтому при несовпадении года id не пишем, а пишем отметку.
 */
function preSearch(title) {
	const full = normName(title);
	const base = baseName(title);
	const year = titleYear(title);

	return apiGet('/api/v2.2/films', { keyword: base, page: 1 }).then((answer) => {
		if (answer.failed) return { ok: false, note: `Kinopoisk ${answer.reason}` };

		const items = Array.isArray(answer.data?.items) ? answer.data.items : [];
		const exact = items.filter((item) => normName(item.nameRu) === base || normName(item.nameEn) === base || normName(item.nameRu) === full);

		if (!exact.length) {
			return { ok: false, checked: true, note: `проверяли по «${base}»: ${answer.data?.total || 0} результатов, ни одно имя не совпало` };
		}

		// Год у строки Kinopoisk может быть null — новый тайтл, запись без года. Такой
		// вариант подходит: «Идеальная работа» (7791628) — exact-совпадение с карточкой
		// 2026 года, у строки года нет. Отказываем только когда годKnown и он отличается.
		const fits = (item) => !year || !item.year || Number(item.year) === year;
		const good = exact.filter(fits);
		const match = good[0] || exact[0];

		if (!good.length) {
			const country = (Array.isArray(match.countries) ? match.countries : []).map((c) => c.country).filter(Boolean)[0] || '';

			return {
				ok: false,
				checked: true,
				note: `имя совпало, но год другой: ${match.kinopoiskId} — ${match.year}${country ? `, ${country}` : ''} (в карточке ${year})`
			};
		}

		return {
			ok: true,
			kinopoiskId: String(match.kinopoiskId || ''),
			imdbId: match.imdbId || '',
			year: match.year || '',
			genre: (Array.isArray(match.genres) ? match.genres : []).map((g) => g?.name || g?.genre).filter(Boolean)[0] || '',
			poster: match.posterUrl || match.posterUrlPreview || '',
			type: match.type || '',
			note: `Kinopoisk ${match.kinopoiskId}${match.imdbId ? `, IMDb ${match.imdbId}` : ', IMDb нет'}`
		};
	});
}

function kpLink(type, id) {
	const value = String(type || '');
	const path = /serial|series/i.test(value) ? 'series' : /^cartoon$/i.test(value) ? 'cartoon' : 'film';

	return `https://www.kinopoisk.ru/${path}/${id}`;
}

/** Фильмы: подборка TOP_POPULAR_MOVIES — одним запросом на весь снимок. */
async function fillMovie(pb) {
	const day = todayKey();
	const answer = await apiGet('/api/v2.2/films/collections', { type: 'TOP_POPULAR_MOVIES' });

	if (answer.failed) {
		console.log(`movie: ${answer.reason}`);
		return { day, rows: [], reason: answer.reason };
	}

	const items = (Array.isArray(answer.data?.items) ? answer.data.items : []).slice(0, TOP);
	const rows = items.map((item, index) => ({
		day,
		pos: index + 1,
		title: item.nameRu || item.nameEn || '',
		year: item.year || '',
		genre: (Array.isArray(item.genres) ? item.genres : []).map((g) => g?.name || g?.genre).filter(Boolean)[0] || '',
		kinopoiskId: String(item.kinopoiskId || ''),
		imdbId: item.imdbId || '',
		poster: item.posterUrl || item.posterUrlPreview || '',
		sourceUrl: kpLink(item.type, item.kinopoiskId)
	}));

	await write(pb, COLLECTIONS.movie, rows, (row) => row.kinopoiskId);

	return { day, rows, reason: '' };
}

/**
 * Дорамы и аниме: подборку тут взять нечем (замер 2: TOP_POPULAR_SERIES — 400, замер 3:
 * фильтр country у premieres игнорируется). Поэтому наполняет их тот же источник, что и
 * раньше (kinovibe, AnimeGO), а этот проход только добавляет id тем карточкам, где его ещё
 * нет, — один запрос на название, из кэса.
 */
async function fillIds(pb, collection) {
	const day = todayKey();
	const all = await pb.collection(collection).getFullList({ sort: 'pos' }).catch(() => []);

	// День берём максимальный, а не день первой записи: с sort:'pos' первой могла оказаться
	// запись вчерашнего снимка, и тогда скрипт правил вчерашние карточки, а сегодняшние
	// остались без id (проверено прогоном 2026-10-31: он обработал день 2026-10-30,
	// а «Баларао» — карточка сегодняшнего снимка).
	// У season_carousel поля day нет: там снимок один, без дней.
	const days = [...new Set(all.map((record) => record.day).filter(Boolean))].sort().reverse();
	const newest = days[0] || '';
	const rows = newest ? all.filter((record) => record.day == newest) : all;

	let checked = 0;
	let found = 0;

	for (const record of rows) {
		if (record.kinopoiskId) continue;

		const match = await preSearch(record.title);

		checked++;

		if (!match.ok) {
			const patch = { checkNote: match.note, checkDay: day };

			if (match.checked) {
				if (DRY) console.log(`  ${collection}: ${record.title} → ${match.note}`);
				else await pb.collection(collection).update(record.id, patch).catch((error) => console.log(`  запись ${record.id}: ${error?.message || error}`));
			}

			continue;
		}

		found++;

		const patch = {
			kinopoiskId: match.kinopoiskId,
			imdbId: match.imdbId,
			year: record.year || match.year,
			genre: record.genre || match.genre,
			poster: record.poster || match.poster,
			checkNote: match.note,
			checkDay: day
		};

		if (DRY) console.log(`  ${collection}: ${record.title} → ${patch.kinopoiskId}${patch.imdbId ? ` / ${patch.imdbId}` : ''}`);
		else await pb.collection(collection).update(record.id, patch).catch((error) => console.log(`  запись ${record.id}: ${error?.message || error}`));
	}

	return { day, rows, checked, found };
}

async function write(pb, collection, rows, keyOf) {
	if (DRY) {
		rows.forEach((row) => console.log(`  ${collection}: ${row.pos}. ${row.title} (${row.year}) ${row.genre} kp=${row.kinopoiskId} imdb=${row.imdbId || '—'} ${row.poster}`));
		return;
	}

	if (PRUNE) {
		const all = await pb.collection(collection).getFullList({ sort: 'pos' }).catch(() => []);
		const stale = all.filter((record) => record.day != rows[0]?.day);

		for (const record of stale) await pb.collection(collection).delete(record.id).catch((error) => console.log(`  удаление ${record.id}: ${error?.message || error}`));

		console.log(`  ${collection}: удалили ${stale.length} записей других дней`);
	}

	const existing = await pb.collection(collection).getFullList({ sort: 'pos' }).catch(() => []);
	const byKey = new Map(existing.map((record) => [keyOf(record), record]));

	let added = 0;
	let updated = 0;

	for (const row of rows) {
		const record = byKey.get(keyOf(row));

		try {
			if (record) {
				await pb.collection(collection).update(record.id, row);
				updated++;
			} else {
				await pb.collection(collection).create(row);
				added++;
			}
		} catch (error) {
			console.log(`  запись ${keyOf(row)}: ${error?.message || error}`);
		}
	}

	console.log(`  ${collection}: добавлено ${added}, обновлено ${updated}`);
}

/**
 * Kodik строго по номеру фильма. Это ровно тот путь, который нужен: без поиска по названию
 * ошибки нет. Замер 2026-10-31: search?kinopoisk_id=7791628 → ровно serial-79386; текстовый
 * поиск по «Идеальной работе» без strict дал 5 результатов, где 3 посторонние. Метод
 * get-player отвечает и по публичному токену, search — только по личному (401), поэтому здесь
 * используется get-player. Хост kodikapi.com из песочницы не открылся (fetch failed), запрос
 * проверен через прокси nginx /api/kodik/.
 */
async function fillKodik(pb, collection) {
	if (!KODIK) return;

	const day = todayKey();
	const all = await pb.collection(collection).getFullList({ sort: 'pos' }).catch(() => []);
	const newest = all.length ? all[0].day : '';

	for (const record of all.filter((r) => r.day == newest)) {
		if (record.kodikId || !record.kinopoiskId) continue;

		const query = `token=${encodeURIComponent(KODIK_TOKEN || 'PUBLIC')}&kinopoiskID=${encodeURIComponent(record.kinopoiskId)}`;

		try {
			const res = await fetch(`${KODIK_API}/get-player?${query}`);
			const data = await res.json().catch(() => null);

			if (res.ok && data?.data?.found) {
				if (DRY) console.log(`  ${collection}: ${record.title} → Kodik ${data.data.id}`);
				else await pb.collection(collection).update(record.id, { kodikId: data.data.id, checkDay: day }).catch(() => {});
			} else {
				if (DRY) console.log(`  ${collection}: ${record.title} → Kodik: проверяли, записи нет (${res.status})`);
			}
		} catch (error) {
			console.log(`  ${collection}: ${record.title} → Kodik не ответил (${error?.message || error?.name})`);
		}

		await sleep(KODIK_DELAY);
	}
}

async function main() {
	if (!KEY) {
		console.log('Нужен KINOPOISK_API_KEY в .env (запрос без X-API-KEY отвечает 401).');
		return;
	}

	const pb = new PocketBase(PB_URL);

	// В --dry-run тоже входим: без чтения схем и записям нечего показать, а PocketBase
	// отвечает 403 на список каруселей для анонима.
	if (process.env.PB_EMAIL && process.env.PB_PASSWORD) {
		try {
			await pb.collection('_superusers').authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);
		} catch (error) {
			console.log(`Вход в PocketBase не прошёл (${error?.message || error}): скрипт работает без записей.`);
		}
	} else if (!DRY) {
		console.log('Для записи нужны PB_EMAIL и PB_PASSWORD (учётка superuser PocketBase).');
		return;
	}

	const modes = MODE === 'all' ? ['movie', 'drama', 'anime'] : [MODE];

	for (const mode of modes) {
		if (mode === 'movie') {
			await fillMovie(pb);
		} else {
			await fillIds(pb, COLLECTIONS[mode]);
		}

		if (KODIK) await fillKodik(pb, COLLECTIONS[mode]);

		await sleep(PAUSE_MS);
	}

	console.log(`Запросов Kinopoisk сегодня: ${cache.used} из ${CAP} (кэш ответа: ${Object.keys(cache.answers).length})`);
}

// --watch: один запуск в сутки (interval в минутах, как у других сервисов compose).
// Счётчик дня сбрасываем при смене московского дня, иначе второй запуск в цикле работал
// бы с вчерашним бюджетом и вчерашними ответами.
const WATCH = Boolean(flag('watch', false));
const INTERVAL_MIN = Number(flag('interval', 1440));

async function run() {
	if (WATCH && cache.day != todayKey()) {
		cache.day = todayKey();
		cache.used = 0;
		cache.answers = {};
	}

	await main();
}

run()
	.then(() => {
		if (!WATCH) return;

		return (async () => {
			while (true) {
				await sleep(INTERVAL_MIN * 60000);
				await run();
			}
		})();
	})
	.catch((error) => console.log(error?.message || error));

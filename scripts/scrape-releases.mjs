#!/usr/bin/env node
/**
 * Скрапер кинопремьер -> PocketBase (коллекция `releases`).
 *
 * Источник по умолчанию — api.poiskkino.dev/v1.5 (ключ пользователя), флаг `--source api`.
 * Kg-portal остался как резервный вариант (`--source kg`): он уже дал архив в 472 записи.
 *
 * Про календарь премьер. Важно, почему нельзя одним запросом:
 *   - фильтра по диапазону дат у эндпоинта нет: `query[premiere.russia][gte]` / `[lte]`
 *     API принимает молча и возвращает обычные документы без фильтра;
 *   - работает только точная дата в плоском параметре `premiere.russia=DD.MM.YYYY`;
 *   - отдельного маршрута календаря тоже нет (`/v1.5/movie/premiere` -> 400/404).
 * Значит «График кинопремьер» собирается как серия запросов: один запрос = один день.
 * `sortFields=premiere.russia` не сортирует, поэтому сортировку делает PocketBase (`sort=date`).
 *
 * Дата берётся по часовому поясу браузера/сервера (TZ, по умолчанию Europe/Moscow) и
 * везде сравнивается как строка YYYY-MM-DD.
 *
 * Использование:
 *   node scripts/scrape-releases.mjs --dry-run                                   # только разбор
 *   node scripts/scrape-releases.mjs --from 2026-10-19 --days 21                # окно дат
 *   node scripts/scrape-releases.mjs --watch --rescan 3 --forward 30 --interval 120
 *   node scripts/scrape-releases.mjs --source kg --weeks 3                      # старый путь
 *   node scripts/scrape-releases.mjs --types movie                               # только фильмы
 *   node scripts/scrape-releases.mjs --limit 10                                  # максимум запусков
 *   node scripts/scrape-releases.mjs --posters                                    # дописать постеры записям без постера
 *   node scripts/scrape-releases.mjs --fill-fields                                # жанр и платформы пачкой по id
 *
 * Экономия квоты (взята из проекта-парсера ПоискКино):
 *   - `selectFields` работает только на списочном маршруте /movie, поэтому поля берём
 *     простые (вложенные rating.kp, genres.name API не принимает) и получаем 2427 байт
 *     вместо 6195 на три документа;
 *   - пачка по id: повторяющиеся параметры `id=` (через запятую — 400), limit до 250 —
 *     один запрос вместо запроса на каждый тайтл;
 *   - резерв `--quota-reserve` (по умолчанию 10): пачку не начинаем, если остаток квоты
 *     меньше нужного плюс резерв, и остаток смотрим через /v1.5/token, который лимит не
 *     списывает (проверено живыми запросами: requestsUsed не изменился за два вызова);
 *   - 401 — ключ не работает, повтор бессмысленен; 403 — суточный лимит, и это разные
 *     случаи: при 403 печатаем время сброса по Москве;
 *   - пауза при 429 по Retry-After, но не больше `--retry-after-cap` (30 с);
 *   - `--max-fail-count` (по умолчанию 3): запись с тремя неудачами подряд больше не
 *     запрашиваем, пока её не пересматривают заново.
 *
 * Постер-запас (для плиток календаря и блока на главной): если у фильма на Kinopoisk нет
 * постера, ищем картинку по kinopoiskId, затем по оригинальному названию и году
 * (тот же ключ, Wikipedia, при TMDB_API_KEY — TMDB) и сохраняем URL в поле poster.
 * Флаги: --no-poster-fallback, --poster-delay (мс), --poster-budget (запросов в сутки).
 *
 * Лимит API — 5 запросов в секунду (видно в заголовках x-ratelimit-*), поэтому задержка
 * по умолчанию 400 мс и пауза при 429 до конца секунды. В дежурном режиме записи не
 * дублируются: релиз ищем по kinopoiskId, поле меняется только если данные реально изменились.
 *
 * Авторизация в PocketBase (для записи): PB_EMAIL / PB_PASSWORD, PB_URL по умолчанию http://localhost:8090.
 */
const PK_BASE = 'https://api.poiskkino.dev/v1.5';
const PK_KEY =
	process.env.POISK_KINO_API_KEY ||
	process.env.KINOPOISK_API_KEY ||
	'ZFCV2WP-QAXMMNZ-Q8H2KH7-CA7JV04';
const SELECT_FIELDS = 'id,name,enName,alternativeName,poster,premiere,year,type,genres,watchability';

const KG_BASE = 'https://kg-portal.ru';
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const UNOFFICIAL_KEY = process.env.KINOPOISK_API_KEY || '4b12f46d-638b-4bac-bf06-33865d3a3524';
const PB_URL = process.env.PB_URL || 'http://localhost:8090';
const COLLECTION = 'releases';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
	const i = args.indexOf(flag);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const source = ['api', 'kg'].includes(valueOf('--source', 'api'))
	? valueOf('--source', 'api')
	: 'api';
const timezone = process.env.TZ || 'Europe/Moscow';
const days = clampInt(valueOf('--days', clampInt(valueOf('--weeks', 1), 1, 60) * 7), 1, 400);
const weeks = clampInt(valueOf('--weeks', 1), 1, 60);
const delayMs = clampInt(valueOf('--delay', source === 'api' ? 400 : 1200), 0, 60000);
const dryRun = has('--dry-run');
const dedupe = has('--dedupe'); // убрать уже накопившиеся дубли (одна запись на один фильм)
const useApi = !has('--no-api'); // для --source kg: сопоставление названий через kinopoiskapiunofficial
const limit = clampInt(valueOf('--limit', 0), 0, 500);
const watch = has('--watch');
const intervalMin = clampInt(valueOf('--interval', 120), 1, 1440);
const rescanDays = clampInt(valueOf('--rescan', 3), 1, 30);
const forwardDays = clampInt(valueOf('--forward', source === 'api' ? 30 : 7), 1, 90);
const budget = clampInt(valueOf('--budget', 80), 1, 200); // запросов API за один цикл дежурного режима
const dailyBudget = clampInt(valueOf('--daily-budget', 180), 1, 1000); // запросов API за сутки (на бесплатном тарифе лимит 200)
const types = has('--all-types') ? '' : valueOf('--types', 'movie'); // movie, tv-series, cartoon, animated-series, anime

// Экономия квоты: резерв для шага пачкой по id, пауза по Retry-After и число неудач
// подряд, после которого запись перестаём запрашивать.
const quotaReserve = clampInt(valueOf('--quota-reserve', 10), 0, 200);
const retryAfterCap = clampInt(valueOf('--retry-after-cap', 30), 1, 120);
const maxFailCount = clampInt(valueOf('--max-fail-count', 3), 1, 20);
const fillFields = has('--fill-fields');
const batchLimit = clampInt(valueOf('--batch-limit', 250), 1, 250);

// Первый проход — окно, которое указали (обычно архив -> текущая дата).
let startIso = valueOf('--from', todayIso(0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (s) =>
	String(s || '')
		.toLowerCase()
		.replace(/ё/g, 'е')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

function clampInt(v, min, max) {
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** Сегодня как строка YYYY-MM-DD в нужном часовом поясе (en-CA -> всегда ISO-формат). */
function todayIso(offsetDays = 0, now = new Date()) {
	const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
	return fmt.format(new Date(now.getTime() + offsetDays * 86400000));
}

function addDaysIso(iso, offset) {
	const t = Date.parse(`${iso}T00:00:00Z`);
	if (!Number.isFinite(t)) throw new Error(`Некорректная дата: ${iso} (нужно YYYY-MM-DD)`);
	return new Date(t + offset * 86400000).toISOString().slice(0, 10);
}

/** Смещение часового пояса источника в минутах (для ожидания полуночи по этому поясу). */
function tzOffsetMinutes(date = new Date()) {
	const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
	const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
	return Math.round((local - utc) / 60000);
}

/** Сколько миллисекунд ждать до полуночи часового пояса источника — там же считается суточный лимит. */
function msUntilNextDay(now = new Date()) {
	const tomorrow = addDaysIso(todayIso(0, now), 1);
	const midnight = Date.parse(`${tomorrow}T00:00:00Z`) - tzOffsetMinutes(now) * 60000;
	return Math.max(0, midnight - now.getTime());
}

/** Понедельник недели (нужно для URL kg-portal), тоже как строка. */
function mondayIso(input) {
	const d = new Date(`${input}T00:00:00Z`);
	if (!Number.isFinite(d.getTime()))
		throw new Error(`Некорректная дата: ${input} (нужно YYYY-MM-DD)`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
}

/** Kinopoisk хочет дату фильтра как DD.MM.YYYY. */
function dotDate(iso) {
	return iso.split('-').reverse().join('.');
}

function kgUrl(iso) {
	const [y, m, d] = iso.split('-').map(Number);
	return `${KG_BASE}/movies/s_week/${y}/${m}/${d}/`;
}

async function fetchText(url, headers = { 'User-Agent': UA }) {
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.text();
}

/* ----------------------------- api.poiskkino.dev ----------------------------- */

/**
 * Документы за один день премьер в России. Один запрос = одна дата, курсорная пагинация
 * (`next`) нужна только если за день больше `limit` тайтлов.
 */
async function apiDay(iso, perPage = 250) {
	const params = new URLSearchParams({
		[`premiere.russia`]: dotDate(iso),
		limit: String(Math.min(perPage, 250)),
		selectFields: SELECT_FIELDS,
		notNullFields: 'premiere.russia'
	});
	if (types) params.set('type', types);

	const docs = [];

	for (let page = 1; page <= 4; page++) {
		const data = await apiGet(params);
		docs.push(...(data.docs || []));
		if (!data.hasNext || !data.next) break;
		params.set('cursor', data.next);
	}

	return docs;
}

class QuotaError extends Error {}
class KeyError extends Error {}

// Остаток суточной квоты смотрим через /v1.5/token: этот маршрут лимит не списывает
// (проверено живыми запросами 2026-10-31 — requestsUsed не изменился за два вызова),
// поэтому проверку можно делать свободно и держать результат десять минут.
let tokenCache = null;
let tokenAt = 0;
const TOKEN_TTL_MS = 10 * 60 * 1000;

async function tokenInfo(force = false) {
	if (!force && tokenCache && Date.now() - tokenAt < TOKEN_TTL_MS) return tokenCache;

	const res = await fetch(`${PK_BASE}/token`, { headers: { 'X-API-KEY': PK_KEY } });

	if (!res.ok) {
		if (res.status === 401) throw new KeyError('ключ API не работает (HTTP 401)');
		throw new Error(`API /token -> HTTP ${res.status}`);
	}

	const data = await res.json();

	tokenCache = {
		limit: Number(data.requestsLimit ?? 0),
		used: Number(data.requestsUsed ?? 0),
		remaining: Number(data.requestsRemaining ?? 0),
		resetAt: data.resetAt || ''
	};
	tokenAt = Date.now();

	return tokenCache;
}

/** «23:59 по Москве» из UTC-строки сброса лимита. */
function mskTime(value) {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return '';

	return new Intl.DateTimeFormat('ru-RU', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short'
	}).format(date);
}

/** Хватит ли запросов на пачку и на резерв (резерв нужен, чтобы суточный синк не остался
 * без квоты: карточки поиска и другие шаги работают на том же ключе). */
async function canSpend(needed) {
	let info = null;

	try {
		info = await tokenInfo();
	} catch (error) {
		if (error instanceof KeyError) throw error;
		console.warn(`  остаток квоты не проверили: ${error.message || error}`);
	}

	if (!info) return needed <= Math.max(0, dailyBudget - requestsToday);

	return info.remaining >= needed + quotaReserve;
}

/** Имена из списочного поля API: у справочников это items, у жанров — сам список. */
function namesOf(list) {
	return (Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : [])
		.map((item) => item?.name || item?.genre)
		.filter(Boolean);
}

/**
 * Пачка тайтлов по id одним запросом: списочный маршрут принимает повторяющиеся `id=`
 * (через запятую — 400), limit до 250, и selectFields работает именно там.
 */
async function apiBatch(ids) {
	const params = new URLSearchParams({
		limit: String(Math.min(ids.length, batchLimit)),
		selectFields: SELECT_FIELDS
	});

	ids.forEach((id) => params.append('id', id));

	const data = await apiGet(params);

	return Array.isArray(data.docs) ? data.docs : [];
}

// Счётчик запросов за сутки: у бесплатного тарифа 200 запросов в сутки, поэтому держим
// свой запас (по умолчанию 180) и при исчерпании ждём полуночи по часовому поясу источника.
let quotaDay = todayIso();
let requestsToday = 0;
let quotaHit = false;

function countRequest() {
	const day = todayIso();
	if (day !== quotaDay) {
		quotaDay = day;
		requestsToday = 0;
		quotaHit = false;
	}
	requestsToday++;
	if (requestsToday >= dailyBudget) quotaHit = true;
}

async function apiGet(params, path = '/movie') {
	// Повторы по правилам парсера: одна попытка при 5xx и до двух при 429. При 401 и 403
	// повтор ничего не меняет — это разные случаи: 401 — ключ не работает, 403 — суточный
	// лимит (или страница вне демо-тарифа), и про него надо сказать сразу.
	let rateRetries = 0;
	let serverRetries = 0;

	while (true) {
		if (quotaHit) throw new QuotaError('суточный лимит запросов исчерпан');

		const res = await fetch(`${PK_BASE}${path}?${params}`, { headers: { 'X-API-KEY': PK_KEY } });
		countRequest();

		// Пауза по Retry-After, но не дольше --retry-after-cap: иначе процесс ждёт слишком
		// долго, а при 429 API обычно просит подождать до конца секунды.
		const retryAfter = clampInt(
			res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset') || 1,
			1,
			retryAfterCap
		);

		if (res.status === 401) {
			const body = await res.text().catch(() => '');
			throw new KeyError(`ключ API не работает (HTTP 401): ${body.slice(0, 120)}`);
		}

		const remaining = Number(res.headers.get('x-ratelimit-remaining'));

		if (res.status === 429 || remaining === 0) {
			if (rateRetries >= 2) throw new Error(`API: rate limit, ${rateRetries} повторов уже использованы`);

			rateRetries++;
			console.warn(`  rate limit (повтор ${rateRetries} из 2), пауза ${retryAfter} c`);
			await sleep(retryAfter * 1000);
			continue;
		}

		if (!res.ok) {
			const body = await res.text().catch(() => '');

			if (res.status === 403 && /лимит/i.test(body)) {
				quotaHit = true;

				let reset = '';

				try {
					const info = await tokenInfo(true);
					reset = `, остаток ${info.remaining}, сброс в ${mskTime(info.resetAt)} (${timezone})`;
				} catch {
					// Остаток не посмотрели — не роняем сообщение из-за этого.
				}

				throw new QuotaError(`суточный лимит API исчерпан: ${body.slice(0, 120)}${reset}`);
			}

			if (res.status >= 500 && serverRetries < 1) {
				serverRetries++;
				console.warn(`  API -> HTTP ${res.status}, повтор через ${retryAfter} c`);
				await sleep(retryAfter * 1000);
				continue;
			}

			throw new Error(`API -> HTTP ${res.status}: ${body.slice(0, 160)}`);
		}

		return res.json();
	}
}

function mapDoc(doc, iso) {
	return {
		slug: `kp-${doc.id}`,
		title: doc.name || doc.alternativeName || '',
		titleEn: doc.alternativeName || '',
		poster: doc.poster?.url || doc.poster?.previewUrl || '',
		date: dateOnly(doc.premiere?.russia) || iso,
		year: Number(doc.year || 0),
		kinopoiskId: String(doc.id || ''),
		// жанр и платформы приходят в тех же ответах, что и остальное, — отдельных запросов
		// ради них нет. Платформы (watchability) у аниме и дорам на демо-токене бывают
		// пустые; сети (networks) — это сети производства, их в плитку не берём.
		genre: namesOf(doc.genres)[0] || '',
		platforms: namesOf(doc.watchability).join(', '),
		// API ответил по этому тайтлу: даже если жанра и платформ нет, второй раз его
		// не просим — это не неудача, данных просто не существует.
		fieldsChecked: true
	};
}

/* ------------------------------- kg-portal.ru -------------------------------- */

/** Достаёт ItemList из JSON-LD страницы: name, url, datePublished, image. */
function parseItems(html) {
	const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
		.map((m) => {
			try {
				return JSON.parse(m[1]);
			} catch {
				return null;
			}
		})
		.filter(Boolean);

	const list = blocks.find((b) => b['@type'] === 'ItemList');
	if (!list) return [];

	return (
		(list.itemListElement || [])
			// Элементы приходят как ListItem, сам фильм — во вложенном блоке item.
			.map((entry) => entry.item || entry)
			.filter((item) => item['@type'] === 'Movie')
			.map((item) => ({
				slug:
					String(item.url || '')
						.replace(/\/+$/, '')
						.split('/')
						.pop() || norm(item.name).replace(/ /g, '-'),
				title: item.name || '',
				titleEn: item.alternateName || '',
				date: dateOnly(item.datePublished) || '',
				poster: item.image || '',
				year: 0,
				kinopoiskId: '',
				sourceUrl: item.url || ''
			}))
			.filter((item) => item.slug && item.title && item.date)
	);
}

/** Название релиза -> filmId Kinopoisk через search-by-keyword (тот же ключ, что у проекта). */
async function findFilm(item) {
	const url = `https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(item.title)}&page=1`;
	const res = await fetch(url, { headers: { 'X-API-KEY': UNOFFICIAL_KEY } });

	if (res.status === 429) {
		console.warn(`Rate limit для «${item.title}», пауза 15 c`);
		await sleep(15000);
		return null;
	}
	if (!res.ok) {
		console.warn(`Поиск «${item.title}» -> HTTP ${res.status}, пропущено`);
		return null;
	}

	const data = await res.json();
	// В v2.1 search-by-keyword список лежит в `films`.
	const films = data.films || data.items || [];
	if (!films.length) return null;

	const target = norm(item.title);
	const exact =
		films.find(
			(f) =>
				norm(f.nameRu) === target || norm(f.nameEn) === target || norm(f.nameOriginal) === target
		) || films[0];

	return { kinopoiskId: String(exact.filmId || ''), year: Number(exact.year || 0) };
}

/* ---------------- постер-запас: картинка, если на Kinopoisk её нет ---------------- */

const UNOFFICIAL_API = 'https://kinopoiskapiunofficial.tech/api';
const WIKI_UA = `${UA} (kinofree poster fallback; admin@kinofree.local)`;
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const posterFallback = !has('--no-poster-fallback');
const posterOnly = has('--posters');
const posterDelay = clampInt(valueOf('--poster-delay', 400), 0, 60000);
const posterBudget = clampInt(valueOf('--poster-budget', 120), 1, 500);
const posterSources = 'Kinopoisk по id -> поиск по названию + году -> Wikipedia -> TMDB';

// kinopoiskapiunofficial и Wikipedia — отдельные лимиты, не путаем с суточным лимитом
// api.poiskkino.dev (счётчик выше), поэтому здесь свой счётчик.
let posterDay = todayIso();
let posterRequestsToday = 0;
let posterQuotaHit = false;

function countPosterRequest() {
	const day = todayIso();
	if (day !== posterDay) {
		posterDay = day;
		posterRequestsToday = 0;
		posterQuotaHit = false;
	}
	posterRequestsToday++;
	if (posterRequestsToday >= posterBudget) posterQuotaHit = true;
}

/** Нужна прямая ссылка на картинку: страницы каталогов в плитку не вставим. */
function looksLikeImage(url) {
	const u = String(url || '');
	if (!/^https?:\/\//i.test(u)) return false;
	// у unofficial API это заглушка «no-poster.png», она не годится в плитку
	if (/no-poster/i.test(u)) return false;
	return (
		/\.(jpe?g|png|webp|gif|svg)(\?|$)/i.test(u) ||
		/image\.kinopoisk\.ru|upload\.wikimedia\.org|image\.tmdb\.org/i.test(u)
	);
}

async function unofficialGet(path) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		if (posterQuotaHit) throw new QuotaError('суточный лимит постер-поиска исчерпан');

		const res = await fetch(`${UNOFFICIAL_API}${path}`, {
			headers: { 'X-API-KEY': UNOFFICIAL_KEY, 'User-Agent': UA }
		});
		countPosterRequest();

		if (res.status === 429) {
			console.warn(`  постер: rate limit (попытка ${attempt}), пауза 15 c`);
			await sleep(15000);
			continue;
		}
		if (!res.ok) {
			console.warn(`  постер: ${path} -> HTTP ${res.status}`);
			return null;
		}
		return res.json();
	}

	return null;
}

function pickPoster(film) {
	const url = film?.posterUrl || film?.posterUrlPreview || '';
	return looksLikeImage(url) ? url : '';
}

/** Постер по id фильма (тот же ключ проекта): поле poster у источника бывает пустым, а картинка есть. */
async function posterFromId(id) {
	if (!id) return '';
	const data = await unofficialGet(`/v2.2/films/${id}`);
	return pickPoster(data);
}

/** Поиск по оригинальному названию + год релиза. */
async function posterFromSearch(title, year) {
	const data = await unofficialGet(
		`/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(title)}&page=1`
	);
	const films = data?.films || data?.items || [];
	if (!films.length) return '';

	const target = norm(title);
	const matches = films.filter(
		(f) => norm(f.nameRu) === target || norm(f.nameEn) === target || norm(f.nameOriginal) === target
	);
	const pool = matches.length ? matches : films;
	const byYear = pool.find((f) => Number(f.year) === Number(year));

	return pickPoster(byYear || pool[0]);
}

/** Wikipedia: ищем статью и берём оригинальное изображение (pageimages, ключ не нужен). */
async function posterFromWikipedia(query, lang) {
	const search = await fetch(
		`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1`,
		{ headers: { 'User-Agent': WIKI_UA } }
	);
	countPosterRequest();

	if (!search.ok) {
		console.warn(`  постер: wikipedia ${lang} -> HTTP ${search.status}`);
		return '';
	}

	const hit = (await search.json().catch(() => null))?.query?.search?.[0];
	if (!hit) return '';

	const page = await fetch(
		`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&pageids=${hit.pageid}&prop=pageimages&piprop=original`,
		{ headers: { 'User-Agent': WIKI_UA } }
	);
	countPosterRequest();

	if (!page.ok) {
		console.warn(`  постер: wikipedia ${lang} (image) -> HTTP ${page.status}`);
		return '';
	}

	const data = await page.json().catch(() => null);
	const article = Object.values(data?.query?.pages ?? {})[0];
	const image = article?.thumbnail?.source || '';

	return looksLikeImage(image) ? image : '';
}

/** TMDB — только если задан TMDB_API_KEY (бесплатный ключ на themoviedb.org). */
async function posterFromTmdb(title, year) {
	if (!TMDB_KEY) return '';

	const res = await fetch(
		`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`,
		{ headers: { 'User-Agent': UA } }
	);
	countPosterRequest();

	if (!res.ok) {
		console.warn(`  постер: tmdb -> HTTP ${res.status}`);
		return '';
	}

	const results = (await res.json().catch(() => null))?.results || [];
	if (!results.length) return '';

	const tmdbYear = (r) => Number(String(r.release_date || '').slice(0, 4) || Number(r.year) || 0);
	const hit = results.find((r) => tmdbYear(r) === Number(year)) || results[0];

	return hit?.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : '';
}

/** Порядок поиска: свой ключ Kinopoisk -> поиск по оригинальному названию -> Wikipedia -> TMDB. */
async function resolvePoster(data) {
	const title = (data.titleEn || data.title || '').trim();
	const year = Number(data.year) || Number(String(data.date || '').slice(0, 4)) || 0;
	const id = /^\d{3,10}$/.test(data.kinopoiskId) ? data.kinopoiskId : '';

	const sources = [
		{ name: 'Kinopoisk по id', run: () => posterFromId(id) },
		{ name: 'Kinopoisk по названию', run: () => (title ? posterFromSearch(title, year) : '') },
		{ name: 'Wikipedia (en)', run: () => (title ? posterFromWikipedia(title, 'en') : '') },
		{
			name: 'Wikipedia (ru)',
			run: () => (data.title ? posterFromWikipedia(data.title, 'ru') : '')
		},
		{ name: 'TMDB', run: () => (title && TMDB_KEY ? posterFromTmdb(title, year) : '') }
	];

	for (const source of sources) {
		if (posterQuotaHit) break;
		try {
			const url = await source.run();
			if (url) return { url, source: source.name };
		} catch (error) {
			if (error instanceof QuotaError) throw error;
			console.warn(`  постер (${source.name}): ${error.message || error}`);
		}
		await sleep(posterDelay);
	}

	return { url: '', source: '' };
}

/** Дописывает постер в данные релиза, если своего нет. */
async function attachPoster(data) {
	if (data.poster || !posterFallback) return data;

	const found = await resolvePoster(data);
	if (found.url) {
		data.poster = found.url;
		console.log(`    постер из ${found.source}: ${data.title}`);
	}

	return data;
}

/* ----------------------------- PocketBase-часть ------------------------------ */

/** PocketBase отдаёт дату как "YYYY-MM-DD HH:mm:ss", сравниваем только день. */
function dateOnly(value) {
	return String(value || '').slice(0, 10);
}

function sameRecord(existing, data) {
	if (!existing) return false;

	return (
		(existing.title || '') === data.title &&
		(existing.titleEn || '') === data.titleEn &&
		(existing.poster || '') === data.poster &&
		dateOnly(existing.date) === data.date &&
		Number(existing.year || 0) === data.year &&
		(existing.kinopoiskId || '') === data.kinopoiskId &&
		(existing.genre || '') === (data.genre || '') &&
		(existing.platforms || '') === (data.platforms || '')
	);
}

async function main() {
	let pb = null;
	if (!dryRun || posterOnly || fillFields) {
		// Импорт только когда реально пишем: dry-run работает и без node_modules
		// (для --posters нужен даже в dry-run, потому что читаем уже записанные релизы;
		// --fill-fields тоже читает записанные релизы, поэтому PocketBase нужен и там).
		const PocketBase = (await import('pocketbase')).default;
		pb = new PocketBase(PB_URL);

		if (!process.env.PB_EMAIL || !process.env.PB_PASSWORD) {
			throw new Error('Для записи нужны PB_EMAIL и PB_PASSWORD (учётка superuser PocketBase)');
		}
		// С 0.23 superuser — это коллекция "_superusers"; старые namespace (pb.admins / pb.auth) уже не работают.
		await pb
			.collection('_superusers')
			.authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);
	}

	const stats = {
		created: 0,
		updated: 0,
		skipped: 0,
		cycleProcessed: 0,
		requests: 0,
		postersFilled: 0,
		placeholdersCleared: 0,
		fieldsFilled: 0,
		emptyFields: 0,
		paused: 0,
		fillRequests: 0,
		failures: 0
	};

	function report(label) {
		console.log(
			`\n${label}: создано ${stats.created}, обновлено ${stats.updated}, пропущено ${stats.skipped}` +
				` (запросов ${stats.requests})` +
				`${stats.postersFilled ? `, постеров дописано ${stats.postersFilled}` : ''}` +
				`${stats.placeholdersCleared ? `, заглушек убрано ${stats.placeholdersCleared}` : ''}` +
				`${posterRequestsToday ? ` (постер-запросов ${posterRequestsToday} из ${posterBudget})` : ''}` +
				`${dryRun ? ' — dry-run, ничего не записано' : ''}` +
				(source === 'api' ? ` — за сутки ${requestsToday} из ${dailyBudget}` : '')
		);
	}

	/**
	 * Дубли, которые появились из-за фильтра с двойными кавычками (одна запись на один фильм
	 * не находилась). Держим запись с постером Kinopoisk и годом, остальные удаляем.
	 */
	async function dedupePass() {
		const groups = new Map();

		for (let page = 1; ; page++) {
			const res = await fetch(
				`${PB_URL}/api/collections/releases/records?per_page=30&page=${page}&sort=kinopoiskId`
			);
			if (!res.ok) throw new Error(`PocketBase -> HTTP ${res.status}`);
			const data = await res.json();

			for (const r of data.items) {
				const key = r.kinopoiskId || `${r.slug}|${dateOnly(r.date)}`;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push(r);
			}

			if (page >= data.totalPages) break;
		}

		const score = (r) =>
			(String(r.poster || '').includes('kinopoisk') ? 2 : 0) + (Number(r.year || 0) ? 1 : 0);

		let dupGroups = 0;
		let removed = 0;

		for (const [key, list] of groups) {
			if (list.length < 2) continue;
			dupGroups++;
			const keeper = list.reduce((a, b) => (score(a) >= score(b) ? a : b));

			for (const r of list) {
				if (r.id === keeper.id) continue;
				console.log(`  дубль ${key}: держим ${keeper.slug}, убираем ${r.slug} (${r.title})`);
				if (!dryRun) await pb.collection(COLLECTION).delete(r.id);
				removed++;
			}
		}

		console.log(
			`\nДедупликация: групп с дублями ${dupGroups}, лишних записей ${removed}` +
				`${dryRun ? ' — dry-run, ничего не удалено' : ''}`
		);
	}

	/**
	 * Проход по записям без постера: ищем картинку по kinopoiskId, затем по оригинальному
	 * названию и году (Wikipedia, при TMDB_API_KEY — TMDB), и дописываем её в поле poster.
	 * Плитки календаря и блока на главной берут poster как есть, отдельной логики в браузере нет.
	 */
	async function posterPass() {
		console.log(`Постеры: ищем картинки для записей без постера (${posterSources})`);

		for (let page = 1; ; page++) {
			// PocketBase не принимает sort по системному полю created (400), сортируем по дате релиза.
			const data = await pb.collection(COLLECTION).getList(page, 50, { sort: 'date' });

			for (const r of data.items) {
				if (posterQuotaHit) continue;

				// заглушка no-poster.png считаем отсутствующим постером: её в плитку не ставим
				const placeholder = /no-poster/i.test(r.poster || '');
				if (r.poster && !placeholder) continue;

				const record = await attachPoster({
					slug: r.slug,
					title: r.title,
					titleEn: r.titleEn,
					poster: '',
					date: dateOnly(r.date),
					year: Number(r.year || 0),
					kinopoiskId: r.kinopoiskId || ''
				});

				if (!record.poster) {
					// После трёх неудач подряд запись больше не запрашиваем (тот же счётчик,
					// что и в проходе с полями) — иначе каждый цикл долбил бы один и тот же тайтл.
					if (posterFallback) await markFailure(r, 'картинку не нашли');

					// картинку не нашли — убираем битую заглушку, плитка покажет букву
					if (placeholder && r.poster && !dryRun) {
						await pb.collection(COLLECTION).update(r.id, { poster: '' });
						stats.placeholdersCleared++;
					}
					continue;
				}

				stats.postersFilled++;
				if (!dryRun) await pb.collection(COLLECTION).update(r.id, { poster: record.poster });
			}

			if (page >= data.totalPages) break;
		}

		report('Постеры');
	}

	// Записи с тремя неудачами подряд больше не запрашиваем (взято из парсера:
	// max_fail_count). Пауза — не суточный лимит, поэтому её показываем отдельно:
	// причина конкретная, и запись снова можно попробовать, обнулив счётчик.
	async function markFailure(record, reason) {
		const count = Number(record.failCount || 0) + 1;
		stats.failures++;

		if (dryRun) {
			console.log(`  fail ${count}: ${record.title || record.slug} — ${reason}`);
			return count;
		}

		await pb.collection(COLLECTION).update(record.id, {
			failCount: count,
			failReason: reason,
			failPaused: count >= maxFailCount
		});

		return count;
	}

	/**
	 * Жанры и платформы для записей, которым их не поставили (selectFields был без этих
	 * полей, и старые записи остались пустыми). Берём пачкой по id: списочный маршрут
	 * принимает повторяющиеся параметры id= (списком через запятую — 400), limit до 250,
	 * и selectFields работает именно там — на карточке по id API его игнорирует. Один
	 * запрос покрывает до 250 записей, и пачку начинаем только если остаток квоты покрывает
	 * запрос плюс резерв.
	 */
	async function fillPass(quiet = false) {
		if (!quiet) {
			console.log(
				`Поля: жанр и платформы пачкой по id (пачка до ${batchLimit}, резерв ${quotaReserve}, пауза после ${maxFailCount} неудач)`
			);
		}

		const need = [];

		for (let page = 1; ; page++) {
			const res = await pb.collection(COLLECTION).getList(page, 100, { sort: 'kinopoiskId' });

			for (const r of res.items) {
				if (!r.kinopoiskId) continue;

				if (Number(r.failCount || 0) >= maxFailCount) {
					stats.paused++;
					continue;
				}

				// already checked by API — fields may legitimately be empty (watchability
				// is empty for most anime and doramas), so we do not ask again
				if (r.fieldsChecked) continue;

				// id проверяем до пачки: один неправильный id обрывает весь запрос,
				// API отвечает 400 на всю группу.
				const id = Number(r.kinopoiskId);

				if (!Number.isFinite(id) || id < 250 || id > 15000000) {
					await markFailure(r, `id вне диапазона API: ${r.kinopoiskId}`);
					continue;
				}

				need.push(r);
			}

			if (page >= res.totalPages) break;
		}

		if (!need.length) {
			if (!quiet) console.log('  проверять нечего: по всем записям API уже отвечал');
			return;
		}

		console.log(`  записей, по которым API ещё не отвечал: ${need.length}`);

		for (let i = 0; i < need.length; i += batchLimit) {
			if (quotaHit) break;

			if (!(await canSpend(1))) {
				console.warn(`  остаток квоты меньше пачки плюс резерв ${quotaReserve} — пачку не начинаем`);
				break;
			}

			const chunk = need.slice(i, i + batchLimit);
			let docs;

			try {
				docs = await apiBatch(chunk.map((r) => r.kinopoiskId));
			} catch (error) {
				if (error instanceof QuotaError || error instanceof KeyError) throw error;
				console.warn(`  пачка ${chunk.length} id: ${error.message || error}`);
				continue;
			}

			stats.fillRequests++;

			const byId = new Map(docs.map((doc) => [String(doc.id), doc]));

			for (const r of chunk) {
				const doc = byId.get(String(r.kinopoiskId));

				if (!doc) {
					await markFailure(r, 'этого id нет в ответе API');
					continue;
				}

				const patch = {};
				const genre = namesOf(doc.genres)[0] || '';
				const platforms = namesOf(doc.watchability).join(', ');
				const networks = namesOf(doc.networks).join(', ');

				if (genre) patch.genre = genre;
				if (platforms) patch.platforms = platforms;
				if (networks) patch.networks = networks;
				patch.fieldsChecked = true;

				if (!genre && !platforms && !networks) {
					// Платформы у аниме и дорам на демо-токене бывают пустые: это не неудача,
					// данных просто нет, и запись не считаем проваленной. Отмечаем, что API
					// по ней уже отвечал, иначе каждый цикл перечитываем одно и то же.
					stats.emptyFields++;

					if (!dryRun) await pb.collection(COLLECTION).update(r.id, patch);

					continue;
				}

				if (dryRun) {
					console.log(`  ${r.kinopoiskId}: ${patch.genre || '—'} · ${patch.platforms || '—'}`);
					continue;
				}

				await pb.collection(COLLECTION).update(r.id, patch);
				stats.fieldsFilled++;
			}
		}

		if (!quiet || stats.fieldsFilled || stats.emptyFields || stats.failures) {
			console.log(
				`\nПоля: заполнено ${stats.fieldsFilled}, без данных ${stats.emptyFields}, на паузе ${stats.paused}` +
					` (запросов ${stats.fillRequests}, неудач ${stats.failures})` +
					`${dryRun ? ' — dry-run, ничего не записано' : ''}` +
					`${source === 'api' ? ` — за сутки ${requestsToday} из ${dailyBudget}` : ''}`
			);
		}
	}

	async function upsert(data) {
		if (!data.title || !data.date) return;

		if (dryRun) {
			console.log(`  ${data.kinopoiskId ? 'ok  ' : 'no id'} ${data.date}  ${data.title}`);
			return;
		}

		// Строковые значения держим в одинарных кавычках — так описан строковый литерал
		// в синтаксисе фильтров PocketBase.
		//
		// getFirstListItem не работает: клиент pocketbase 0.21.5 обращается к
		// /records/first, которого в сервере PocketBase 0.40.6 уже нет — проверено живым
		// запросом, этот путь отвечает 404 даже без фильтра. Поэтому ищем список с
		// perPage: 1, он отвечает 200. Без этой правки каждый проход создавал копию
		// фильма, потому что существующая запись не находилась.
		const filter = data.kinopoiskId ? `kinopoiskId='${data.kinopoiskId}'` : `slug='${data.slug}'`;
		const found = await pb.collection(COLLECTION).getFullList({ filter, perPage: 1 });
		const existing = found[0] || null;

		if (!existing) {
			await pb.collection(COLLECTION).create(data);
			stats.created++;
			console.log(
				`  new ${data.date}  ${data.title}${data.kinopoiskId ? ` -> ${data.kinopoiskId}` : ''}`
			);
			return;
		}

		if (sameRecord(existing, data)) {
			stats.skipped++;
			return;
		}

		await pb.collection(COLLECTION).update(existing.id, data);
		stats.updated++;
		console.log(`  upd  ${data.date}  ${data.title} -> ${data.kinopoiskId}`);
	}

	// Сколько запросов можно сделать в этом цикле: берём меньшее из лимита цикла и остатка суточного лимита.
	const cycleCap = () => Math.min(budget, Math.max(0, dailyBudget - requestsToday));

	// Один день премьер (источник — API Kinopoisk).
	async function processDay(iso) {
		if (limit && stats.cycleProcessed >= limit) return;
		if (quotaHit || stats.requests >= cycleCap()) return;

		stats.requests++;
		console.log(`День ${iso}: ${PK_BASE}/movie?premiere.russia=${dotDate(iso)}`);

		let docs;
		try {
			docs = await apiDay(iso);
		} catch (error) {
			if (error instanceof QuotaError) throw error;
			// В дежурном режиме одна неудачная дата не должна ронять процесс.
			console.warn(`  ${error.message || error}`);
			return;
		}

		if (!docs.length) console.warn('  пусто');

		for (const doc of docs) {
			if (limit && stats.cycleProcessed >= limit) break;
			stats.cycleProcessed++;
			await upsert(await attachPoster(mapDoc(doc, iso)));
		}

		if (delayMs) await sleep(delayMs);
	}

	// Один день через kg-portal (старый путь): неделя целиком, id по названию.
	async function processKgDay(iso) {
		const week = mondayIso(iso);
		if (limit && stats.cycleProcessed >= limit) return;

		stats.requests++;
		const url = kgUrl(week);
		console.log(`Неделя ${week}: ${url}`);

		let items;
		try {
			items = parseItems(await fetchText(url));
		} catch (error) {
			console.warn(`  ${error.message || error}`);
			return;
		}

		if (!items.length) console.warn('  Пустая неделя (в JSON-LD нет ItemList)');

		for (const item of items) {
			if (limit && stats.cycleProcessed >= limit) break;
			stats.cycleProcessed++;

			let film = null;
			if (useApi) {
				film = await findFilm(item);
				if (delayMs) await sleep(delayMs);
			}

			await upsert(
				await attachPoster({
					slug: item.slug,
					title: item.title,
					titleEn: item.titleEn,
					poster: item.poster,
					date: item.date,
					year: film?.year || item.year || 0,
					kinopoiskId: film?.kinopoiskId || item.kinopoiskId || ''
				})
			);
		}
	}

	async function runCycle(label, isoList) {
		stats.cycleProcessed = 0;
		stats.requests = 0;
		const step = source === 'api' ? processDay : processKgDay;
		for (const iso of isoList) {
			try {
				await step(iso);
			} catch (error) {
				if (!(error instanceof QuotaError)) throw error;
				console.warn(`  ${error.message}`);
				break;
			}
		}
		report(label);
	}

	const dayList = (fromIso, count) =>
		Array.from({ length: count }, (_, i) => addDaysIso(fromIso, i));

	if (dedupe) await dedupePass();

	if (fillFields) {
		// Проход перед основным циклом: он дешёвый (одна пачка на 250 записей) и проверяет
		// остаток квоты, поэтому основной суточный синк не останется без запросов.
		await fillPass();

		if (!watch) return;
	}

	if (posterOnly) {
		await posterPass();
		return;
	}

	// Первый проход — окно, которое указали (обычно архив -> текущая дата).
	await runCycle('Проход', dayList(startIso, days));

	if (!watch) return;

	console.log(
		`\nДежурный режим (${source}): перескан последних ${rescanDays} дн. и ${forwardDays} дн. вперёд ` +
			`каждые ${intervalMin} мин, не больше ${budget} запросов за цикл и ${dailyBudget} за сутки. Ctrl+C — остановить.`
	);

	while (true) {
		const current = todayIso();
		// От старых дат к новым: премьеры переносятся, поэтому прошедшие дни тоже пересматриваем.
		await runCycle(
			'Обновление',
			Array.from({ length: rescanDays + forwardDays }, (_, i) =>
				addDaysIso(current, i - (rescanDays - 1))
			)
		);

		if (fillFields && !quotaHit) await fillPass(true);

		if (quotaHit) {
			const waitMs = msUntilNextDay();
			console.log(
				`Суточный лимит (${requestsToday} из ${dailyBudget}) исчерпан — пауза до ${Math.round(waitMs / 60000)} мин, до полуночи (${timezone}).`
			);
			await sleep(waitMs);
			quotaDay = todayIso();
			requestsToday = 0;
			quotaHit = false;
			continue;
		}

		await sleep(intervalMin * 60000);
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exitCode = 1;
});

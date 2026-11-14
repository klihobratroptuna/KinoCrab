#!/usr/bin/env node
/**
 * Скрапер аниме-релизов -> PocketBase (коллекция `anime_releases`).
 *
 * Источник — Shikimori API (graphql): POST https://shikimori.io/api/graphql.
 * Парсить сам сайт нельзя (правила Shikimori: только API), из браузера запросы тоже не
 * сделать — API не отдаёт CORS-заголовки. Поэтому данные пишет этот скрипт, а вкладка
 * «Аниме» на /releases читает их из PocketBase и подписывается на Realtime API.
 *
 * Про календарь релизов аниме. Важно, почему нельзя одним запросом на неделю:
 *   - у Shikimori нет эндпоинта с расписанием серий по дням;
 *   - у аниме в статусе `ongoing` есть только `nextEpisodeAt` — дата ближайшей серии;
 *   - значит календарь собирается из «ближайшей серии» каждого онгоинга: один проход =
 *     одна страница онгоингов, запись = одна серия (аниме + дата).
 * Когда серия выходит, `nextEpisodeAt` переезжает на следующий день и скрипт добавляет
 * новую запись, а старая остаётся — так неделя за неделей наполняется история.
 * Даты, которых скрипт ещё не видел, пустыми не выдумываются: неделя будет пустой, пока
 * дежурный режим её не собрал.
 *
 * Правила Shikimori: User-Agent с именем приложения (SHIKIMORI_USER_AGENT), не больше
 * 5rps и 90rpm, лимит выборки — 50 записей на запрос. Задержка по умолчанию 1200 мс.
 *
 * Дата везде сравнивается как строка YYYY-MM-DD по часовому поясу источника (TZ,
 * по умолчанию Europe/Moscow) — `nextEpisodeAt` приходит с московским смещением.
 *
 * Использование:
 *   node scripts/scrape-anime.mjs --dry-run                                   # только разбор
 *   node scripts/scrape-anime.mjs --status ongoing                            # один проход
 *   node scripts/scrape-anime.mjs --limit 20                                  # максимум записей
 *   node scripts/scrape-anime.mjs --watch --back 7 --forward 21 --interval 360
 *   node scripts/scrape-anime.mjs --backfill --pages 30                       # поля карточки и kinopoiskId для уже созданных записей
 *
 * Авторизация в PocketBase (для записи): PB_EMAIL / PB_PASSWORD, PB_URL по умолчанию http://localhost:8090.
 */
const GRAPHQL_URL = 'https://shikimori.io/api/graphql';
const UA = process.env.SHIKIMORI_USER_AGENT || 'kinofree-anime-sync/1.0 (https://kinofree.su)';
const PB_URL = process.env.PB_URL || 'http://localhost:8090';
const COLLECTION = 'anime_releases';
const CAROUSEL = 'season_carousel';
// GraphQL принимает максимум 50 записей на запрос, даже если попросить больше.
const PER_PAGE = 50;

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
	const i = args.indexOf(flag);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const timezone = process.env.TZ || 'Europe/Moscow';
const status = ['ongoing', 'anons', 'released'].includes(valueOf('--status', 'ongoing'))
	? valueOf('--status', 'ongoing')
	: 'ongoing';
// GraphQL принимает order как enum-литералу (без кавычек), в отличие от status,
// где ожидается строка — за невалидное значение API отвечает ошибкой запроса.
const ORDER_VALUES = [
	'id',
	'id_desc',
	'ranked',
	'kind',
	'popularity',
	'name',
	'aired_on',
	'episodes',
	'status',
	'random',
	'ranked_random',
	'ranked_shiki',
	'created_at',
	'created_at_desc',
	'updated_at',
	'updated_at_desc'
];
const order = ORDER_VALUES.includes(valueOf('--order', 'popularity'))
	? valueOf('--order', 'popularity')
	: 'popularity';
const backDays = clampInt(valueOf('--back', 7), 0, 60);
const forwardDays = clampInt(valueOf('--forward', 21), 1, 90);
const delayMs = clampInt(valueOf('--delay', 1200), 0, 60000);
const dryRun = has('--dry-run');
// --backfill: страницы онгоингов читаем так же, но пишем только поля карточки и только
// в уже существующие записи. Скрапер создаёт запись про «ближайшую серию» и к прошлым
// датам не возвращается, поэтому записи, созданные до миграции 1730000310, иначе так и
// остались бы без описания, жанров и рейтинга.
const backfill = has('--backfill');
const limit = clampInt(valueOf('--limit', 0), 0, 500);
const watch = has('--watch');
const intervalMin = clampInt(valueOf('--interval', 360), 1, 1440);
const budget = clampInt(valueOf('--budget', 30), 1, 60); // запросов GraphQL за один цикл
const dailyBudget = clampInt(valueOf('--daily-budget', 120), 1, 500); // запросов GraphQL за сутки
// Сколько страниц онгоингов читать за цикл: 30 страниц по 50 записей — это весь ongoing
// (его около 1200), больше нужно только для очень длинного хвоста.
const pages = clampInt(valueOf('--pages', 30), 1, 40);
// --fill-name-key: заполняет nameKey — поле-ключ по имени, по которому работает индекс
// anime_releases_name_key_idx (миграция 1793440300). Сети не трогает, только PocketBase,
// поэтому шаг можно включать в дежурный цикл: он чинит ключи, появившиеся до индекса.
const fillNameKey = has('--fill-name-key');
// Регистрация тайтлов карусели в календаре. Шаг включён по умолчанию: если тайтла нет у
// источника (Shikimori), карточка карусели — единственное, что о нём известно, и без записи
// на нашем сайте у тайтла индекса нет. --no-register выключает шаг.
const registerCarousel = !has('--no-register');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * `nextEpisodeAt` — это ISO-датамомент с смещением Shikimori (+03:00). В плитке дата должна
 * быть той же строкой YYYY-MM-DD, что и в календаре фильмов, поэтому переводим её в даты
 * часового пояса источника, а не сервера или браузера.
 */
function dayKey(value) {
	if (!value) return '';
	const time = new Date(value);
	if (!Number.isFinite(time.getTime())) return '';
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(time);
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

class QuotaError extends Error {}

// Счётчик запросов за сутки: лимит Shikimori 90rpm, держим свой запас и при исчерпании
// ждём полуночи часового пояса источника.
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

/**
 * Одна страница онгоингов. Поле `nextEpisodeAt` может быть null — такие аниме пропускаем.
 * `description`, `score`, `genres` и `episodes` — поля карточки: они нужны внутренней
 * странице /anime?id=..., куда ведут плитки аниме без kinopoiskId.
 * `externalLinks` нужен только одним видом — `kinopoisk`: по id из этой ссылки работает
 * страница /watch?id=... с плеером, то есть плитка аниме открывается так же, как плитка фильма.
 * Дополнительно поля ничего не стоят: это тот же запрос, просто чуть больше полей.
 */
function pageQuery(page) {
	return (
		`{ animes(status: "${status}", order: ${order}, page: ${page}, limit: ${PER_PAGE}) {` +
		' id name russian kind status episodesAired episodes nextEpisodeAt url' +
		' description score genres { name russian } externalLinks { kind url }' +
		' airedOn { year } poster { previewUrl preview2xUrl } } }'
	);
}

/**
 * Shikimori отдаёт описание с BBCode-разметкой вида [character=4883]Текст[/character],
 * [spoiler]...[/spoiler], [video=b]...[/video]. Оставляем только текст: в карточке
 * ссылки на персонажей и спойлеры не нужны, а символы скобок портят абзацы.
 */
function cleanDescription(value) {
	return String(value || '')
		.replace(/\[[^\]]*\]/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** Русское название жанра, если Shikimori его знает. */
function genreList(genres) {
	return (genres || []).map((item) => item?.russian || item?.name || '').filter(Boolean);
}

/**
 * Kinopoisk id из externalLinks Shikimori. Вид `kinopoisk` — это ссылка вида
 * https://www.kinopoisk.ru/series/382731/ (сериалы) или /film/391104/ (полнометражки),
 * номер в ней — тот самый id, по которому работает страница /watch?id=...
 *
 * Поля `typeWeb` в GraphQL Shikimori нет (проверено introspection'ом), поэтому это
 * единственный надёжный способ получить id: поиск Kinopoisk по названию даёт то пустой
 * результат, то чужое произведение — на него полагаться нельзя.
 * Пустая строка означает, что аниме нет в Kinopoisk: для такой плитки остаётся
 * внутренняя карточка /anime?id=....
 */
function kinopoiskIdFromLinks(links) {
	const link = (links || []).find((item) => item?.kind === 'kinopoisk');
	return link?.url?.match(/(?:film|series|cartoon|tv_show)\/(\d+)/)?.[1] ?? '';
}

async function gql(query) {
	for (let attempt = 1; attempt <= 4; attempt++) {
		if (quotaHit) throw new QuotaError('суточный лимит запросов исчерпан');

		const res = await fetch(GRAPHQL_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
			body: JSON.stringify({ query })
		});
		countRequest();

		if (res.status === 429) {
			console.warn(`  rate limit (попытка ${attempt}), пауза 15 c`);
			await sleep(15000);
			continue;
		}

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			if (res.status === 403 && /ban|limit/i.test(body)) {
				quotaHit = true;
				throw new QuotaError(`Shikimori отказал в запросе: ${body.slice(0, 120)}`);
			}
			throw new Error(`GraphQL -> HTTP ${res.status}: ${body.slice(0, 160)}`);
		}

		const data = await res.json().catch(() => null);
		if (data?.errors?.length) throw new Error(`GraphQL: ${data.errors[0].message}`);
		return data?.data?.animes || [];
	}

	throw new Error('GraphQL: слишком много попыток из-за rate limit');
}

/** Запись плитки: одна серия = одна запись (аниме + день, когда она выходит). */
function mapAnime(anime) {
	const date = dayKey(anime.nextEpisodeAt);
	if (!date) return null;

	return {
		slug: `shiki-${anime.id}`,
		title: anime.russian || anime.name || '',
		titleEn: anime.name || '',
		// preview2x — webp ~2x разрешения: в сетку плиток в самый раз, original слишком тяжёлый.
		poster: anime.poster?.preview2xUrl || anime.poster?.previewUrl || '',
		date,
		year: Number(anime.airedOn?.year || 0),
		// episodeAired — уже вышедшие серии, поэтому ближайшая серия = +1.
		episode: Number(anime.episodesAired || 0) + 1,
		kind: anime.kind || '',
		status: anime.status || '',
		shikimoriId: String(anime.id),
		shikimoriUrl: anime.url || '',
		// Id из externalLinks kind=kinopoisk: по нему плитка ведёт на /watch?id=... с плеером.
		kinopoiskId: kinopoiskIdFromLinks(anime.externalLinks),
		// Поля карточки для страницы /anime?id=...
		description: cleanDescription(anime.description),
		score: Number(anime.score || 0),
		genres: genreList(anime.genres).join(', '),
		episodesTotal: Number(anime.episodes || 0),
		nameKey: normalizeTitle(anime.russian || anime.name || '')
	};
}

/* ----------------------------- PocketBase-часть ------------------------------ */

/**
 * Название для сравнения: без регистра и пунктуации. Правило то же, что в скрапере дорам и
 * в $lib/shared/nameIndex.js — иначе ключ, который пишет этот скрипт, не совпадёт с ключом,
 * по которому ищет фронтенд, и индекс не будет использован.
 */
function normalizeTitle(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Имя карточки карусели без суффикса сезона: «Киберпанк: Бегущие по краю 2» ->
 * «киберпанк бегущие по краю». Shikimori ведёт сезон отдельной записью, поэтому короткое
 * имя — только последний запасной путь, и поиск по нему отличается от точного совпадения
 * (об этом пишет шаг register).
 */
function shortNameKey(value) {
	return normalizeTitle(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** PocketBase отдаёт дату как "YYYY-MM-DD HH:mm:ss", сравниваем только день. */
function dateOnly(value) {
	return String(value || '').slice(0, 10);
}

/**
 * Следующие сутки в том же виде YYYY-MM-DD. Поле date PocketBase хранит с временем
 * («2026-10-28 00:00:00.000»), поэтому сутки находят только диапазоном: проверка
 * живым запросом — `date='2026-10-28'` отвечает 0 записей, а
 * `date>='2026-10-28' && date<'2026-10-29'` — 13 записей той же серии.
 */
function nextDayKey(key) {
	const parts = String(key).split('-').map(Number);
	return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10);
}

function sameRecord(existing, data) {
	if (!existing) return false;

	return (
		(existing.title || '') === data.title &&
		(existing.titleEn || '') === data.titleEn &&
		(existing.poster || '') === data.poster &&
		dateOnly(existing.date) === data.date &&
		Number(existing.year || 0) === data.year &&
		Number(existing.episode || 0) === data.episode &&
		(existing.shikimoriId || '') === data.shikimoriId &&
		(existing.kinopoiskId || '') === data.kinopoiskId &&
		// Поля карточки тоже сравниваем: иначе старые записи (до миграции
		// 1730000310) никогда не получили бы описание, жанры и рейтинг.
		(existing.description || '') === data.description &&
		(existing.genres || '') === data.genres &&
		Number(existing.score || 0) === data.score &&
		Number(existing.episodesTotal || 0) === data.episodesTotal
	);
}

async function main() {
	let pb = null;
	if (!dryRun) {
		// Импорт только когда реально пишем: dry-run работает и без node_modules.
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

	const stats = { created: 0, updated: 0, skipped: 0, processed: 0, requests: 0, nameKeyUpdated: 0, registered: 0 };

	function report(label) {
		console.log(
			`\n${label}: создано ${stats.created}, обновлено ${stats.updated}, пропущено ${stats.skipped}` +
				` (запросов ${stats.requests})` +
				`${dryRun ? ' — dry-run, ничего не записано' : ''}` +
				` — за сутки ${requestsToday} из ${dailyBudget}`
		);
	}

	async function upsert(data) {
		if (!data.title || !data.date) return;

		if (dryRun) {
			console.log(`  ${data.date}  ${data.title} · серия ${data.episode}`);
			return;
		}

		// Два места, из-за которых поиск не находил уже записанную серию и каждый проход
		// цикла добавлял её копию. Проверено живыми запросами к PocketBase 0.40.6:
		//   · getFirstListItem — путь клиента pocketbase 0.21.5, /records/first — отвечает
		//     404 даже без фильтра, поэтому ищем список с perPage: 1 (он отвечает 200);
		//   · равенство даты запись не находит: поле хранится со временем
		//     («2026-10-28 00:00:00.000»), поэтому сутки сравниваем диапазоном — nextDayKey.
		// Строковые значения держим в одинарных кавычках: так описан строковый литерал
		// в синтаксисе фильтров PocketBase (двойные тоже принимают — проверено,
		// shikimoriId="53913" отвечает те же 13 записей).
		// До этих правок в anime_releases накопилось 103 группы повторов, до 13 одинаковых
		// записей на одну серию, и одну и ту же плитку было видно несколько раз.
		const filter = `shikimoriId='${data.shikimoriId}' && date>='${data.date}' && date<'${nextDayKey(data.date)}'`;
		const found = await pb.collection(COLLECTION).getFullList({ filter, perPage: 1 });
		const existing = found[0] || null;

		if (!existing) {
			await pb.collection(COLLECTION).create(data);
			stats.created++;
			console.log(`  new ${data.date}  ${data.title} · серия ${data.episode}`);
			return;
		}

		if (sameRecord(existing, data)) {
			stats.skipped++;
			return;
		}

		await pb.collection(COLLECTION).update(existing.id, data);
		stats.updated++;
		console.log(`  upd  ${data.date}  ${data.title} · серия ${data.episode}`);
	}

	/**
	 * Режим --backfill: обновляем только поля карточки во всех записях аниме.
	 * Дату и номер серии не трогаем — записей у одного аниме много, и каждая описывает
	 * свой день выхода, а описание, рейтинг, жанры, общее число серий и kinopoiskId
	 * у них общие.
	 */
	async function fillCard(data) {
		const card = {
			description: data.description,
			score: data.score,
			genres: data.genres,
			episodesTotal: data.episodesTotal,
			kinopoiskId: data.kinopoiskId
		};

		const list = await pb
			.collection(COLLECTION)
			.getFullList({ filter: `shikimoriId='${data.shikimoriId}'` });

		for (const existing of list) {
			if (sameCard(existing, card)) {
				stats.skipped++;
				continue;
			}

			await pb.collection(COLLECTION).update(existing.id, card);
			stats.updated++;
			console.log(`  card ${dateOnly(existing.date)}  ${existing.title}`);
		}
	}

	function sameCard(existing, card) {
		return (
			(existing.description || '') === card.description &&
			(existing.genres || '') === card.genres &&
			Number(existing.score || 0) === card.score &&
			Number(existing.episodesTotal || 0) === card.episodesTotal &&
			(existing.kinopoiskId || '') === card.kinopoiskId
		);
	}

	/**
	 * Заполняет nameKey у записей, где ключа ещё нет или он устарел (например, изменилось
	 * название). Сети не трогает — только PocketBase, поэтому шаг можно включать в дежурный
	 * цикл: он чинит ключи, которые появились до индекса.
	 */
	async function nameKeyPass(label) {
		if (!fillNameKey || dryRun) return;

		const all = await pb.collection(COLLECTION).getFullList({ perPage: 200 });

		for (const record of all) {
			const key = normalizeTitle(record.title);

			if (!key || record.nameKey === key) continue;

			await pb.collection(COLLECTION).update(record.id, { nameKey: key });
			stats.nameKeyUpdated++;
		}

		console.log(`${label}: nameKey — записей ${all.length}, обновили ${stats.nameKeyUpdated}`);
	}

	/**
	 * Регистрация в календаре тайтлов карусели AnimeGO, которых нет у Shikimori.
	 *
	 * Замер живыми запросами (2026-10-31): карусель — 11 карточек, у 10 из них запись в
	 * календаре есть, у «Киберпанк: Бегущие по краю 2» (shiki=61990) записи нет: Shikimori
	 * ведёт сезон отдельной записью в статусе anons, а скрапер собирает календарь из
	 * `nextEpisodeAt` онгоингов, поэтому для анонса даты нет и запись не создаётся.
	 *
	 * Порядок на карточку:
	 *   1. id Shikimori из карточки — точный путь, запись по нему ищешь напрямую;
	 *   2. exact-совпадение по nameKey (работает индекс) — тогда записи не нужна, но если
	 *      у карточки своего id нет, дополняем его, чтобы карточка вела на внутреннюю
	 *      страницу, а не на сайт источника. По короткому имени не совпадаем: короткое имя
	 *      другого сезона (карточка «... 2», запись про сезон 1) — это другой тайтл;
	 *   3. ничего нет — создаём запись из карточки: тайтл, постер, ссылка источника,
	 *      номер фильма, nameKey. Дату выдумываем только одну — день, когда карточка
	 *      появилась в карусели; серию не придумываем, episode остаётся 0.
	 */
	async function registerPass(label) {
		if (dryRun || !registerCarousel) return;

		const cards = await pb
			.collection(CAROUSEL)
			.getFullList({ sort: 'pos', perPage: 100 })
			.catch((error) => {
				console.log(`${label}: карусель аниме не читается (${error?.message || error}) — шага нет`);
				return [];
			});

		if (!cards.length) {
			console.log(`${label}: карусель аниме пуста — шага нет`);
			return;
		}

		const today = todayIso();

		for (const card of cards) {
			const full = normalizeTitle(card.title);

			if (!full) continue;

			if (card.shikimoriId) {
				const found = await pb
					.collection(COLLECTION)
					.getFullList({ filter: `shikimoriId='${card.shikimoriId}'`, perPage: 1 });

				if (found.length) continue;
			} else {
				// Exact по индексируемому полю — без LIKE, как в $lib/shared/nameIndex.js.
				const found = await pb
					.collection(COLLECTION)
					.getFullList({ filter: `nameKey='${full}'`, sort: '-date', perPage: 1 });

				if (found.length) {
					if (!card.shikimoriId && found[0].shikimoriId) {
						await pb
							.collection(CAROUSEL)
							.update(card.id, { shikimoriId: found[0].shikimoriId })
							.catch((error) => console.log(`  карточка ${card.id}: ${error?.message || error}`));

						stats.registered++;
						console.log(`  карточка ${card.title} -> Shikimori ${found[0].shikimoriId} по имени`);
					}

					continue;
				}
			}

			const data = {
				slug: `carousel-${card.animegoId || card.id}`,
				title: card.title,
				nameKey: full,
				poster: card.poster || '',
				date: today,
				year: Number(String(card.title).match(/\b(19|20)\d{2}\b/)?.[0] || 0),
				episode: 0,
				kind: '',
				status: 'в карусели',
				shikimoriId: card.shikimoriId || '',
				shikimoriUrl: card.sourceUrl || '',
				kinopoiskId: card.kinopoiskId || '',
				matchNote: `запись создана из карусели AnimeGO: тайтла нет в календаре Shikimori`
			};

			await pb.collection(COLLECTION).create(data);
			stats.registered++;
			console.log(`  new ${data.date}  ${data.title} · из карусели`);
		}

		console.log(`${label}: регистрация аниме — карточек ${cards.length}, новых записей ${stats.registered}`);
	}

	// Окно дат: `backDays` — на случай, если Shikimori ещё не обновил дату уже вышедшей
	// серии, и `forwardDays` — ближайшие серии онгоингов. Записи вне окна не пишем: их не
	// видно в недельном календаре, а суточный лимит запросов они всё равно тратят.
	// Историю прошлых недель даёт не окно, а сами проходы: серия остаётся записью,
	// созданной в тот день, когда её даты были известны.
	const inWindow = (data, from, to) => data.date >= from && data.date <= to;

	async function runCycle(label) {
		stats.processed = 0;
		stats.requests = 0;

		const today = todayIso();
		const from = addDaysIso(today, -backDays);
		const to = addDaysIso(today, forwardDays);

		for (let page = 1; page <= pages; page++) {
			if (limit && stats.processed >= limit) break;
			if (quotaHit || stats.requests >= budget) break;

			stats.requests++;
			console.log(`Страница ${page}: animes(status=${status}, order=${order}, limit=${PER_PAGE})`);

			let list;
			try {
				list = await gql(pageQuery(page));
			} catch (error) {
				if (error instanceof QuotaError) {
					console.warn(`  ${error.message}`);
					break;
				}
				// В дежурном режиме одна неудачная страница не должна ронять процесс.
				console.warn(`  ${error.message || error}`);
				break;
			}

			if (!list.length) {
				console.warn('  пусто');
				break;
			}

			for (const anime of list) {
				if (limit && stats.processed >= limit) break;
				stats.processed++;

				const data = mapAnime(anime);
				if (!data) continue;

				// В backfill-режиме окно дат не важно: поля карточки пишем во все записи
				// этого аниме, а не только в запись ближайшей серии.
				if (backfill) {
					await fillCard(data);
					continue;
				}

				if (!inWindow(data, from, to)) {
					stats.skipped++;
					continue;
				}

				await upsert(data);
			}

			if (list.length < PER_PAGE) break;
			if (delayMs) await sleep(delayMs);
		}

		report(label);
	}

	await runCycle('Проход');
	await nameKeyPass('Проход');
	await registerPass('Проход');

	if (!watch) return;

	console.log(
		`\nДежурный режим (Shikimori): окно ${backDays} дн. назад и ${forwardDays} дн. вперёд, ` +
			`каждые ${intervalMin} мин, не больше ${budget} запросов за цикл и ${dailyBudget} за сутки. ` +
			`User-Agent: ${UA}. Ctrl+C — остановить.`
	);

	while (true) {
		await runCycle('Обновление');

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

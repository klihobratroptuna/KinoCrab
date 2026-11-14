// Постер TMDB — последний запасной путь для карточек карусели «Сериалы», где картинку
// показать нечем. Порядок путей задаёт posterLookup в src/lib/shared/seriesSource/index.js:
//   1) номер в Kinopoisk уже известен — картинка из одного номера без запроса;
//   2) код IMDb из строки Kodik;
//   3) поиск по названию (preSearch);
//   4) TMDB — этот модуль. Внутри него порядок такой: сначала имя ищем в массовом ответе
//      окна (discover/tv по first_air_date), это один запрос на сутки для всех карточек;
//      если имени там нет — отдельный поиск по имени карточки, и если по-русски TMDB не
//      находит, поиск по оригинальному имени из строки Kodik (варианты передаёт проход).
// TMDB идёт последним, как в scripts/scrape-releases.mjs, где он тоже последний источник
// постера: ответ Kinopoisk точнее (в нём есть тип записи), а TMDB по имени может дать
// другое шоу. Он нужен именно потому, что в окне 2026-11-03 из 27 имён в Kinopoisk есть
// 10, у остальных постер Kodik ведёт на i.mydramalist.com (403) — карточка остаётся с
// первой буквой, и TMDB добавляет картинку для этих десяти.
//
// Почему через nginx: TMDB требует ключ и читает его только в query (api_key=), без ключа
// отвечает 401 Invalid API key. Ключ подставляет location /api/tmdb/ из TMDB_API_KEY (.env
// -> docker compose), поэтому в сборке браузера его нет. Картинку ведём через
// /api/tmdb-poster/ — так запрос идёт с нашего адреса и карточка не зависит от
// блокировщика, отсеивающего посторонние домены (правило как у dorama-poster).
//
// Лимит по документации (https://developer.themoviedb.org/docs, проверено 2026-11-03):
// «somewhere in the 40 requests per second range», за превышение — 429. Паузу держит цикл
// прохода (PAUSE_MS), ответ дня лежит в netCache, поэтому один тайтл спрашивают один раз
// за сутки.
//
// Проверено 2026-11-03: запрос без ключа — 401 Invalid API key; имя в ответе search/tv
// (name) переводится на русский, когда language=ru; поле type в строке поиска отсутствует.
//
// Условия использования TMDB требуют атрибуции на сайте: «This product uses the TMDB API
// but is not endorsed or certified by TMDB» и логотип TMDB — строка держится в about/credits.

import netFetch, { netSummary } from '$lib/shared/net';
import netCache from '$lib/shared/netCache';
import { nameKeyOf } from '$lib/shared/nameIndex';
import { keyOf } from '$lib/shared/moscowDate';

// Размер postera оставили w500, как в scrape-releases. Карточка карусели меньше — 160 px, —
// поэтому можно было бы взять меньший размер: замер 2026-11-03 показал, что на части узлов
// BunnyCDN тело ответа обрывается примерно на 16 КБ (w154 — 14,5 КБ — проходило целиком,
// w185, w300 и w500 — нет). На закреплённом узле файл w500 весом 90–110 КБ доходит целиком,
// проверено тремя постерами карусели, поэтому размер не уменьшали. Если картинка снова
// начнёт обрезаться, проверять надо не размер, а узел: он закреплен в nginx.conf.template и
// в extra_hosts docker-compose.yml, и эти два адреса должны совпадать.
const POSTER_SIZE = 'w500';

// Страницы топа популярного: 5 по 20 тайтлов. Ответ дня лежит в netCache, поэтому
// это один набор запросов на сутки, а не на каждый показ карусели.
const POPULAR_PAGES = 5;

function clean(value) {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

// Год в ответе TMDB — часть даты first_air_date (YYYY-MM-DD), отдельного поля year нет.
function yearOf(value) {
	return clean(value).slice(0, 4);
}

// Порог для оценки TMDB — 10 голосов. Оценка премьера, вышедшего на этой неделе, почти всегда
// это 1–8 голосов: замер 2026-11-04 по двадцати карточкам снимка — 10.0 при 1 голосе
// («Голубая планета 3», «Kollegiet»), 9.0 при 1 голосе, 5.0 при 1 голосе, 8.1 при 7 голосах.
// На экране это выглядит как оценка тайтла, хотя оценки там ещё нет. Поэтому цифры ниже порога
// не берём, а причину пишем в отметку: по ней видно, что тайтл проверяли, а оценки просто нет.
const MIN_VOTES = 10;

function ratingOf(row) {
	// Оценка TMDB — vote_average. При vote_count 0 это не оценка, а ноль в базе.
	const votes = Number(row?.vote_count);
	const rating = Number(row?.vote_average);

	if (!Number.isFinite(rating) || rating <= 0 || !Number.isFinite(votes) || votes < MIN_VOTES) return '';

	return rating.toFixed(1);
}

// Числительное по русским правилам: 1 голос, 2 голоса, 5 голосов.
function votesWord(count) {
	const tail = count % 100;
	const last = count % 10;

	if (tail == 11 || (tail >= 12 && tail <= 14)) return `${count} голосов`;

	if (last == 1) return `${count} голос`;

	if (last >= 2 && last <= 4) return `${count} голоса`;

	return `${count} голосов`;
}

function posterOf(row) {
	const path = clean(row?.poster_path);

	return path ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${path}` : '';
}

function searchPath(name) {
	const params = new URLSearchParams({ query: name, language: 'ru' });

	return `/api/tmdb/3/search/tv?${params}`;
}

// Серии ни в строке окна, ни в строке поиска нет: документация TMDB даёт их только в
// подробности шоу (tv/{id}), где есть last_episode_to_air и number_of_episodes. Поэтому серии
// для карточки берём оттуда, и только когда карточке нечем их закрыть: если ответил Kodik,
// его серия точнее — она из строки плеера, по которому карточку смотрят. Подробности лежат в
// netCache, как остальные ответы модуля: один запрос на шоу за сутки.
async function episodeFromTmdb(result, card, day) {
	if (!result.ok || clean(card.episode)) return result;

	const answer = await netCache(
		`tmdb:detail:${result.tmdbId}:${day}`,
		() => netFetch(`/api/tmdb/3/tv/${result.tmdbId}?language=ru`, { timeoutMs: 10000, attempts: 2 })
	);

	if (!answer.ok) return { ...result, note: `${result.note}, серий нет: подробности TMDB не ответил` };

	const last = answer.data?.last_episode_to_air;
	const total = Number(answer.data?.number_of_episodes) || 0;

	if (!last?.episode_number) return { ...result, note: `${result.note}, серий в подробности нет` };

	const season = Number(last.season_number) || 1;
	const shown = total || last.episode_number;
	const episode = season > 1 ? `${season}-${last.episode_number} Серия из ${shown}` : `Серия ${last.episode_number} из ${shown}`;

	// cached остаётся true только если в сеть ничего не ушло: ответ дня и подробности,
	// кэсованные на сутки, лимит LOOKUP_LIMIT не тратят.
	return {
		...result,
		episode,
		cached: Boolean(result.cached) && Boolean(answer.cached),
		note: `${result.note}, серия ${last.episode_number} из ${shown}`
	};
}

// Массовый путь — ответы окна по дате премьеры. Один запрос на сутки даёт постер, жанр и
// оценку сразу для всех имён окна, вместо того чтобы спрашивать каждую карточку: на проход
// уходит один запрос вместо тринадцати.
//
// Важная оговорка: first_air_date — дата выхода первой серии, а не дата появления шоу в
// каталоге. Поэтому в окне только совсем новые шоу: сериал, который идёт с 2024 года и
// выпустил серию на этой неделе, сюда не попадёт. Поле last_air_date в строках discover
// отсутствует (проверено живым замером 2026-11-04: ключи строки — adult, backdrop_path,
// genre_ids, id, origin_country, original_language, original_name, overview, popularity,
// poster_path, first_air_date, softcore, name, vote_average, vote_count), поэтому
// сортировка last_air_date.desc не даёт шоу с новой серией за окно — из 20 строк в окне не
// было ни одной.
//
// С 2026-11-04 этот ответ ещё и источник имён: windowCandidates() отдаёт строки окна по
// разрешённым странам, и карусель строит по ним карточки. Без этого ответа карусель была бы
// пустой: лента Kodik за те же 30 дней по этим странам даёт 1–2 строки. Новинки Kodik —
// строки, созданные или обновлённые за те же 30 дней, — считаются новинками тоже.
//
// Жанр 16 (аниме) отсекаем: аниме и дорамы живут в своих каруселях, в «Сериалах» их показывать
// не нужно. Страница одна, сортировка first_air_date.desc — свежие премьеры в начале; если
// имени в ответе нет, путь идёт к поиску по имени. Ответ дня лежит в netCache, как и остальные
// ответы модуля.
// Коды стран, если они нужны: список через | работает (замер 2026-11-04 — 508 шоу за
// 30 дней по разрешённым странам). Без кодов путь отвечает по всему миру, и ответ дня
// лежит в netCache под отдельным ключом.
function windowPath(keys, codes = '') {
	const params = new URLSearchParams({
		language: 'ru',
		page: '1',
		sort_by: 'first_air_date.desc',
		'first_air_date.gte': keys.back,
		'first_air_date.lte': keys.forward,
		include_null_first_air_dates: 'false',
		without_genres: '16'
	});

	if (codes) params.set('with_origin_country', codes);

	return `/api/tmdb/3/discover/tv?${params}`;
}

async function windowRows(day, keys, force, codes = '') {
	return netCache(
		`tmdb:window:${day}:${codes || 'all'}`,
		() => netFetch(windowPath(keys, codes), { timeoutMs: 10000, attempts: 2 }),
		force
	);
}

// Имена жанров: строка поиска называет жанры только числами (genre_ids), имён там нет,
// поэтому имена берём из списка genre/tv/list — один запрос на сутки, он же в netCache.
let genres = null;

async function genreNames(day, force) {
	if (genres) return genres;

	const answer = await netCache(
		`tmdb:genres:${day}`,
		() => netFetch('/api/tmdb/3/genre/tv/list?language=ru', { timeoutMs: 10000, attempts: 2 }),
		force
	);

	if (!answer.ok) return null;

	const map = new Map();

	for (const row of Array.isArray(answer.data?.genres) ? answer.data.genres : []) {
		if (row?.id) map.set(String(row.id), clean(row.name));
	}

	genres = map;

	return map;
}

/**
 * Форма ответа — та же, что result из preSearch, чтобы проверка совпадения (accept в
 * seriesSource) была одна: { ok, note, cached, year, genre, rating, poster, type }.
 * С 2026-11-05 в форме ещё votes (число голосов, по которым решает порог оценки) и episode:
 * серии приходят из подробности шоу, когда карточке нечем закрыть строку Kodik.
 *
 * type выставляем TV_SHOW: ответы TMDB по сериалам отвечают только сериалами, поля type в
 * строке нет, поэтому проверка типа для этого пути проходит всегда — проверяем имя и год.
 * Имя сравниваем точно, потому что первое совпадение не всегда наше: TMDB называет тайтл без
 * суффикса сезона и года в скобках, как их называет карточка.
 */
function shape(hit, map, cached, where) {
	const year = yearOf(hit.first_air_date);
	const genre = map ? clean(map.get(String(hit.genre_ids?.[0] ?? ''))) : '';
	const votes = Number(hit?.vote_count) || 0;
	const rating = ratingOf(hit);

	return {
		ok: true,
		tmdbId: String(hit.id || ''),
		kinopoiskId: '',
		imdbId: '',
		year,
		genre,
		rating,
		votes,
		// origin_country — коды стран (KR, CN, US). Их читает проверка стран в seriesSource:
		// там список разрешённых стран собран и из слов Kodik, и из этих кодов.
		country: (Array.isArray(hit.origin_country) ? hit.origin_country : []).map((item) => clean(item)).join(', '),
		poster: posterOf(hit),
		// Серии в этой строке нет — её добавляет episodeFromTmdb, когда карточке нечем
		// закрыть строку Kodik.
		episode: '',
		type: 'TV_SHOW',
		note: `TMDB ${hit.id} (${year || 'год неизвестен'})${genre ? `, ${genre}` : ', жанров нет'}${where}${
			rating
				? `, оценка ${rating} при ${votesWord(votes)}`
				: votes
				? `: оценка ${Number(hit?.vote_average).toFixed(1)} при ${votesWord(votes)} — ниже порога ${MIN_VOTES}, не берём`
				: ', оценки нет'
		}`,
		cached
	};
}

// Строки окна для карусели: имя, страна, год, жанр, оценка, постер. Плеера и id здесь нет —
// их карточка получит позже, когда ежедневная проверка по id найдёт запись Kodik или Alloha.
// Имя сравнивается и как name, и как original_name: TMDB отвечает перевод не всегда.
export async function windowCandidates(day, keys, opts = {}) {
	const codes = clean(opts.codes);

	const answer = await windowRows(day, keys, Boolean(opts.force), codes);

	if (!answer.ok) return { ok: false, reason: netSummary('TMDB', answer), rows: [] };

	const map = await genreNames(day, Boolean(opts.force));
	const rows = [];

	for (const hit of Array.isArray(answer.data?.results) ? answer.data.results : []) {
		const name = clean(hit?.name || hit?.original_name);

		if (!name || !hit?.id) continue;

		const year = yearOf(hit.first_air_date);
		const genre = clean(map?.get(String(hit?.genre_ids?.[0] ?? '')));
		// Полный список жанров строки. Путь окна отвечает без жанра 16 (анимация), поэтому сам
		// этот источник мультипликационные сериалы не отдаёт, и правило про них работает по
		// спискам других источников. Список всё равно несём: на карточке первый жанр не решает,
		// какой тайтл перед нами (см. замер 2026-11-06 в правиле seriesSource).
		const genres = (Array.isArray(hit?.genre_ids) ? hit.genre_ids : []).map((id) => clean(map?.get(String(id)))).filter(Boolean);

		const votes = Number(hit?.vote_count) || 0;
		const rating = ratingOf(hit);

		rows.push({
			name,
			nameOrig: clean(hit?.original_name || hit?.name),
			year,
			windowDay: keyOf(hit?.first_air_date),
			// Строка окна собрана по first_air_date, значит дата премьеры внутри окна: это
			// премьера, а не шоу, которое идёт не первый сезон. Порог голосов для премьер
			// меньше (QUALITY_MIN_VOTES_FRESH в seriesSource), и здесь это видно по самой строке.
			premiere: true,
			genre,
			genres,
			rating,
			votes,
			poster: posterOf(hit),
			// Страна кодами — её читает проверка стран в seriesSource, где список собран и из
			// слов Kodik, и из этих кодов.
			country: (Array.isArray(hit?.origin_country) ? hit.origin_country : []).map((item) => clean(item)).join(', '),
			tmdbId: String(hit.id),
			sourceUrl: `https://www.themoviedb.org/tv/${hit.id}`,
			note: `TMDB ${hit.id} (${year || 'год неизвестен'})${genre ? `, ${genre}` : ', жанров нет'}${
				rating
					? `, оценка ${rating} при ${votesWord(votes)}`
					: votes
					? `: оценка ${Number(hit?.vote_average).toFixed(1)} при ${votesWord(votes)} — ниже порога ${MIN_VOTES}, не берём`
					: ', оценки нет'
			}`
		});
	}

	return { ok: true, reason: '', rows, cached: Boolean(answer.cached) };
}

// Топ популярного сейчас: tv/popular, 5 страниц по 20 — это 100 тайтлов, по одному запросу
// на сутки, ответы лежат в netCache. Список нужен для отбора, а не для постера: он отвечает
// на вопрос, почему лента была полной старых и низкорейтинговых тайтлов. Строка окна Kodik
// говорит, что у тайтла вышла серия, но не говорит, интересен ли он сегодня кому-то, кроме
// его постоянных зрителей.
//
// Имена сравниваем нормализованным (nameKeyOf), а не по external_ids: отдельный запрос
// /find или /tv/{id} на каждый тайтл — это 100 запросов на сутки, а имя уже есть в ответах
// Kodik, myshows и TMDB. Замер 2026-11-05 по топ-100 и строкам окна: ...
export async function popularRows(day, opts = {}) {
	const map = new Map();
	let requests = 0;

	for (let page = 1; page <= POPULAR_PAGES; page++) {
		const answer = await netCache(
			`tmdb:popular:${day}:${page}`,
			() => netFetch(`/api/tmdb/3/tv/popular?language=ru&page=${page}`, { timeoutMs: 10000, attempts: 2 }),
			Boolean(opts.force)
		);

		if (!answer.ok) continue;

		if (!answer.cached) requests++;

		for (const hit of Array.isArray(answer.data?.results) ? answer.data.results : []) {
			const name = clean(hit?.name || hit?.original_name);

			if (!name) continue;

			const key = nameKeyOf(name);

			if (!key || map.has(key)) continue;

			map.set(key, {
				key,
				title: name,
				nameOrig: clean(hit?.original_name || hit?.name),
				year: yearOf(hit?.first_air_date),
				country: (Array.isArray(hit?.origin_country) ? hit.origin_country : []).map((item) => clean(item)).join(', '),
				rating: ratingOf(hit),
				votes: Number(hit?.vote_count) || 0,
				tmdbId: String(hit?.id || '')
			});
		}
	}

	return { ok: map.size > 0, reason: '', map, requests };
}

export async function tmdbPoster(card, day, keys, opts = {}) {
	const key = nameKeyOf(card.nameKey || card.title);

	if (!key) return { ok: false, note: 'названия нет, искать нечем', cached: false };

	if (!keys?.back || !keys?.forward) return { ok: false, note: 'окна нет, смотреть негде', cached: false };

	const map = await genreNames(day);

	// Сначала имя ищем в ответе окна: он один на сутки, и повторный заход в сеть не ходит.
	// Ответ читается из кэса без force — иначе каждый Lookup того же дня заново спрашивал бы
	// окно, и смысл массового ответа терялся. Коды стран передаём те же, что у источника имён,
	// чтобы тот же ответ дня не спрашивался вторично.
	const windowAnswer = await windowRows(day, keys, false, clean(opts.codes));

	if (windowAnswer.ok) {
		const hit = (Array.isArray(windowAnswer.data?.results) ? windowAnswer.data.results : []).find(
			(row) => nameKeyOf(row.name) === key || nameKeyOf(row.original_name) === key
		);

		if (hit) return await episodeFromTmdb(shape(hit, map, Boolean(windowAnswer.cached), ' — имя в окне по дате премьеры'), card, day);
	}

	// Имени в окне нет — спрашиваем поиск по имени. Русский перевод TMDB в поиске не работает:
	// запрос «Наше золотое время» отвечает пусто, а то же шоу находится по оригинальному имени
	// (title_orig, other_title или title_en из строки Kodik), и его name в ответе совпадает с
	// именем карточки. Поэтому варианты, если их дал проход, тоже проверяются, но совпадение
	// по-прежнему сравнивается с именем карточки — иначе TMDB мог бы дать другое шоу.
	const variants = [clean(card.title), ...(Array.isArray(opts.variants) ? opts.variants : [])].filter(Boolean);

	const tried = [];

	for (const variant of variants) {
		// Имя читаем из кэса: на сутки один ответ на имя, повторный Lookup того же дня в сеть
		// не ходит.
		const answer = await netCache(
			`tmdb:search:${day}:${nameKeyOf(variant)}`,
			() => netFetch(searchPath(variant), { timeoutMs: 10000, attempts: 2 })
		);

		const cached = Boolean(answer.cached);

		if (!answer.ok) return { ok: false, note: netSummary('TMDB', answer), cached };

		const items = Array.isArray(answer.data?.results) ? answer.data.results : [];
		const hit = items.find((row) => nameKeyOf(row.name) === key || nameKeyOf(row.original_name) === key);

		if (hit) return await episodeFromTmdb(shape(hit, map, cached, ` — поиск по «${variant}»`), card, day);

		tried.push({ variant, total: answer.data?.total_results || 0, nearest: items[0], cached });
	}

	const first = tried[0];

	return {
		ok: false,
		note: `TMDB по «${first?.variant || ''}»: ${first?.total || 0} результатов, ни одно имя не совпало${
			first?.nearest?.name ? `, ближайшее — «${clean(first.nearest.name)}» (${yearOf(first.nearest.first_air_date) || 'год неизвестен'})` : ''
		}`,
		cached: Boolean(first?.cached)
	};
}

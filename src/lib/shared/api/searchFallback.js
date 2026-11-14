// Запасные пути текстового поиска, когда Kinopoisk не ответил.
//
// Почему это нужно: живой поиск и страница результатов спрашивают только Kinopoisk
// (src/lib/shared/api/searchFilm.js), и когда он не отвечает, список пустой. Замер
// 2026-11-09: запросы к kinopoiskapiunofficial.tech с машины дали Connect Timeout Error
// (10 секунд), а через прокси контейнера отвечали 504.
//
// Что проверяли тем же замером — 14 тайтлов разных типов (фильмы UK/FR/RU/US, сериалы,
// мультфильмы, дорамы, аниме), запросы только через прокси nginx:
//   1) Kodik search без параметра types отвечает 200 и даёт записи всех типов, то есть
//      один запрос на тайтл вместо шести по типу. Первое result не берём: по «Во все
//      тяжкие» он предложил «Во мраке» (2018), по «Маша и медведь» — «Жрица и медведь»
//      (2016). Имя проверяет nameMatch в kodik.js, здесь используем его matches.
//   2) TMDB без language=ru отвечает чужими именами, с ним — правильными: «Во все тяжкие»
//      → tv/1396, «Маша и медведь» → tv/46080, «Дюна» → movie/438631, «Идеальная работа»
//      → tv/289517. Поля type в строке поиска нет, поэтому тип — тот endpoint, которым
//      искали, год — release_date или first_air_date. Postera в строке нет, есть poster_path.
//   3) Shikimori понимает русское имя только для аниме: «Голубая шкатулка» находит, на
//      «Машу и медведя» даёт чужое. Поэтому он последний и только когда первые два ничего
//      не дали.
//   4) AniList по-русски отвечает пусто (по-английski находит), у MyDramaList API нет. Эти
//      источники не используем: для них нужна отдельная location в nginx, и тайтл, который
//      знает только MyDramaList, всё равно нечем играть — Kodik по «Баларао» отвечает пусто.
//
// Гейт прежний: карточку наружу не ведём, открываем внутри, чем можем. Ссылка есть только
// когда чем играть — числовой номер Kinopoisk или id записи Kodik. Тайтл, найденный только
// по имени, остаётся карточкой без ссылки, и в описании написано, чем именно нашли.
//
// Бюджет на один поисковый запрос: Kodik 1, TMDB 2 (movie и tv), и не больше одной
// подробности TMDB ради кода IMDb. Ответы держит netCache, неудачи — нет, поэтому повтор
// может пройти. Источник, который только что не ответил, минуту не трогаем: подсказки
// живого поиска пересчитываются на каждый символ, и без этой паузы один ввод долбил бы
// TMDB десятки раз.

import netFetch from '$lib/shared/net';
import netCache from '$lib/shared/netCache';
import { posterUrl } from '$lib/shared/doramaPoster';
import { nameKeyOf, shortNameOf } from '$lib/shared/nameKey';
import { isKodikId, isKinopoiskId, kodikSearch } from '$lib/shared/kodik';
import { shikimoriSearchByTitle } from '$lib/shared/shikimori';

const LIMIT = 5;           // подсказок и карточек на один запрос — столько же, сколько срезает searchBar
const LOOKUPS = 1;         // подробностей TMDB ради кода IMDb на один поисковый запрос
const BREAKER_MS = 60000;  // источник, который не ответил, не трогаем минуту
const POSTER_SIZE = 'w500';// тот же размер, что в src/lib/shared/tmdbPoster/index.js

const LABEL = { movie: 'фильм', tv: 'сериал' };
const KODIK_LABEL = { 'russian-movie': 'фильм', 'foreign-movie': 'фильм', 'russian-serial': 'сериал', 'foreign-serial': 'дорама', anime: 'аниме', 'anime-serial': 'аниме' };

const seen = new Map();    // нормализованное имя -> результат: живой поиск пересчитывает подсказки на каждый символ
const broken = new Map();  // источник -> время, до которого его не трогаем

function brokenFor(source) {
	return Date.now() < (broken.get(source) || 0);
}

// Запоминаем только сетевую неудачу. «Не нашёл» — это настоящий ответ источника, и по нему
// следующий символ надо спрашивать снова; отказ 4xx тоже не запоминаем, там повтор даст то
// же самое.
function markBroken(source, answer) {
	if (!answer || answer.ok || answer.label !== 'сеть') return answer;

	broken.set(source, Date.now() + BREAKER_MS);

	return answer;
}

function playerHref(card) {
	const title = card.nameRu ? `&title=${encodeURIComponent(card.nameRu)}` : '';

	if (isKinopoiskId(card.filmId)) return `/watch?kp=${card.filmId}${title}`;

	if (isKodikId(card.kodikId)) return `/watch?id=${card.kodikId}${title}`;

	return '';
}

// Тип по строке Kodik. Поле types приходит только когда спрашивали с types; без него Kodik
// его не отдаёт, поэтому смотрим на префикс id записи: movie-9129 — фильм, serial-78469 —
// сериал. Мультфильм Kodik отдельно не различает, его API отвергает значение cartoon
// (замер 2026-11-09: «Неправильный тип»), поэтому мультфильм выходит «фильмом» или
// «сериалом» — это самое точное, что можно сказать без отдельного запроса к TMDB за жанром.
function kodikLabel(item) {
	return KODIK_LABEL[item.types] || (String(item.id || '').startsWith('movie') ? 'фильм' : 'сериал');
}

function cardOf({ name, original, year, type, poster, filmId, kodikId, shikimoriId, via, note, exact }) {
	const card = {
		key: nameKeyOf(name),
		// Точное совпадение с запросом важнее просто совпадения: по короткому имени источник
		// может предложить соседний тайтл («Маша и медведь. День кино»), и в подсказках
		// такие строки идут после точных.
		exact: !!exact,
		// Числовой ключ карточки — только номер Kinopoisk. Shikimori id в него не идёт:
		// страница /watch по одному id Shikimori играет только с type=anime, а резерв имени
		// не знает, чем играть, поэтому такая карточка остаётся без ссылки (см. правило
		// «наружу не ведём, открываем внутри, чем можем»).
		filmId: isKinopoiskId(filmId) ? Number(filmId) : kodikId || '',
		kodikId: kodikId || '',
		shikimoriId: shikimoriId || '',
		nameRu: name,
		nameEn: original || '',
		year: String(year || ''),
		type,
		posterUrlPreview: poster ? posterUrl({ poster }) : '',
		// Надпись «нашли через …» наружу не показываем: карточка выглядит как обычная.
		// Источник здесь только для внутреннего журнала, и по нему resultCard не идёт
		// запрашивать описание у Kinopoisk — источник резерва именно потому, что Kinopoisk
		// не ответил, и второй запрос на каждую карточку только замедлил бы страницу.
		description: '',
		fromFallback: true,
		// Внутренний журнал: чем именно карточка найдена. На странице не показывается.
		sourceNote: note || '',
		link: playerHref({ filmId, kodikId, nameRu: name }),
		source: via
	};

	return card;
}

// Совпадение имени с ответом TMDB. Первое result не берём: по «Идеальная работа» TMDB
// назвал «Работа с призрачными перспективами», по «Маша и медведь» без language=ru — чужое.
function tmdbMatch(row, keyword) {
	const full = nameKeyOf(keyword);
	const short = shortNameOf(keyword);
	const name = nameKeyOf(row.name || row.title);

	if (!name) return '';

	if (name === full) return 'совпало полностью';

	if (short && (name === short || name.startsWith(`${short} `))) return 'совпало коротким именем';

	return '';
}

async function tmdbSearch(keyword, endpoint, force) {
	if (brokenFor('TMDB')) return { ok: false, label: 'пауза', rows: [], note: 'TMDB не ответил — минуту не трогаем' };

	const params = new URLSearchParams({ query: keyword, language: 'ru' });
	const answer = await netCache(
		`tmdb:search:${endpoint}:${nameKeyOf(keyword)}`,
		() => netFetch(`/api/tmdb/3/search/${endpoint}?${params}`, { timeoutMs: 10000, attempts: 2 }),
		force
	);

	if (!answer.ok) {
		return markBroken('TMDB', { ...answer, label: !answer.status || answer.status >= 500 ? 'сеть' : `ошибка ${answer.status}`, rows: [] });
	}

	return { ok: true, label: 'ok', rows: Array.isArray(answer.data?.results) ? answer.data.results : [], note: '' };
}

function tmdbPoster(row) {
	const path = String(row?.poster_path || '');

	return path ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${path}` : '';
}

function tmdbYear(row) {
	return String(row?.release_date || row?.first_air_date || '').slice(0, 4);
}

// Код IMDb в строке поиска TMDB отсутствует, он только в подробности тайтла. Один запрос
// на тайтл — это единственный способ уйти в Kodik для тайтлов, где Kodik не знает русского
// имени (замер 2026-11-09: «Во все тяжкие» по имени пусто, по коду tt36458668 → запись
// Kodik есть). Поэтому подробностей не больше одной на поисковый запрос.
async function tmdbImdbCode(row, endpoint, force) {
	if (brokenFor('TMDB')) return '';

	const answer = await netCache(
		`tmdb:detail:${endpoint}:${row.id}:external_ids`,
		() => netFetch(`/api/tmdb/3/${endpoint}/${row.id}?language=ru`, { timeoutMs: 10000, attempts: 2 }),
		force
	);

	if (!answer.ok) return '';

	return String(answer.data?.external_ids?.imdb_id || '');
}

/**
 * Резерв для текстового поиска. Возвращает { films, sources, notes } в той же форме, что
 * searchFilm: карточка страницы поиска читает nameRu, year, type, posterUrlPreview,
 * description и link. opts.light — только имена, без проверок плеера: так работают
 * подсказки живого поиска, где запрос на каждый символ.
 */
export async function searchFallback(keyword, opts = {}) {
	const key = nameKeyOf(keyword);

	if (!key) return { films: [], sources: [], notes: [] };

	if (!opts.force && seen.has(key)) return seen.get(key);

	const cards = [];
	const sources = [];

	// 1) Kodik: имя, год, номер Kinopoisk и чем играть — всё в одном ответе.
	if (!brokenFor('Kodik')) {
		const answer = markBroken('Kodik', await kodikSearch({ title: keyword, types: '' }, opts.force));

		if (answer.ok) {
			sources.push('Kodik');

			for (const item of answer.matches || []) {
				cards.push(
					cardOf({
						name: item.name,
						year: item.year,
						type: kodikLabel(item),
						filmId: item.numbers?.kinopoiskId,
						kodikId: item.id,
						via: 'Kodik',
						note: `чем играет Kodik (${item.id})`,
						exact: nameKeyOf(item.name) === key
					})
				);
			}
		}
	}

	// 2) TMDB movie и tv с language=ru: имя, год и постер. Плеер — если тот же тайтл
	//    есть у Kodik по имени, иначе по коду IMDb, и не больше одного такого запроса.
	//    Имя Kodik привязываем к году: одно имя носят разные работы, и плеер 1969 года
	//    не может открыть карточку фильма 2020 года с тем же названием.
	let lookups = 0;
	const kodikNames = new Map(cards.map((card) => [`${card.key}|${card.year}`, card]));

	for (const endpoint of ['movie', 'tv']) {
		const answer = await tmdbSearch(keyword, endpoint, opts.force);

		if (!answer.ok) break;

		sources.push('TMDB');

		for (const row of answer.rows) {
			const match = tmdbMatch(row, keyword);

			if (!match) continue;

			const nameKey = nameKeyOf(row.name || row.title);
			const year = tmdbYear(row);
			let known = kodikNames.get(`${nameKey}|${year}`);
			let via = 'TMDB';
			let note = match;

			if (known) {
				note = `${match}, играет Kodik (${known.kodikId || known.filmId})`;
			} else if (!opts.light && lookups < LOOKUPS) {
				lookups += 1;
				const code = await tmdbImdbCode(row, endpoint, opts.force);

				if (code) {
					const player = markBroken('Kodik', await kodikSearch({ imdbId: code, types: '' }, opts.force));

					if (player.ok) {
						via = 'TMDB + Kodik';
						note = `${match}, играет Kodik по коду IMDb (${player.id})`;
						known = { filmId: player.numbers?.kinopoiskId, kodikId: player.id };
						kodikNames.set(`${nameKey}|${year}`, known);
					} else {
						note = `${match}, Kodik по коду IMDb ${code} не играет`;
					}
				} else {
					note = `${match}, кода IMDb у TMDB нет`;
				}
			}

			cards.push(
				cardOf({
					name: row.name || row.title,
					original: row.original_name || row.original_language || '',
					year,
					type: LABEL[endpoint],
					poster: tmdbPoster(row),
					filmId: known?.filmId,
					kodikId: known?.kodikId,
					via,
					note,
					exact: match === 'совпало полностью'
				})
			);
		}
	}

	// 3) Shikimori — только аниме и только когда первые два источника ничего не дали.
	if (!cards.length && !brokenFor('Shikimori')) {
		const answer = markBroken('Shikimori', await shikimoriSearchByTitle(keyword, opts.force));

		if (answer.ok) {
			sources.push('Shikimori');

			cards.push(
				cardOf({
					name: answer.name,
					year: '',
					type: 'аниме',
					poster: answer.poster,
					shikimoriId: answer.id,
					via: 'Shikimori',
					note: answer.note,
					exact: answer.exact
				})
			);
		}
	}

	// Дедупликация по имени и году: один тайтл может прийти и из Kodik, и из TMDB — карточка
	// одна, та, где есть чем играть. Год входит в ключ, иначе одно имя сваливает в одну
	// карточку разные работы: по «Во все тяжкие» TMDB даёт сериал 2008 года и фильм 2018,
	// и это два разных тайтла, а не дубль. Отдельно смотрим на числовой номер: по нему
	// совпадение надёжнее имени (Kodik и Kinopoisk называют один и тот же фильм по-разному).
	const byKey = new Map();
	const byNumber = new Map();

	for (const card of cards) {
		const number = String(card.filmId || '');
		const existing = byKey.get(`${card.key}|${card.year}`) || (isKinopoiskId(number) ? byNumber.get(number) : null);

		if (existing) {
			if (!existing.link && card.link) existing.link = card.link;

			if (!existing.posterUrlPreview && card.posterUrlPreview) existing.posterUrlPreview = card.posterUrlPreview;

			continue;
		}

		byKey.set(`${card.key}|${card.year}`, card);

		if (isKinopoiskId(number)) byNumber.set(number, card);
	}

	// Точные совпадения идут первыми: по короткому имени источник может предложить соседний
	// тайтл, и в подсказках он не должен закрывать тот, что совпал целиком. Внутри точных —
	// сначала те, где есть чем играть.
	const list = [...byKey.values()]
		.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || (b.link ? 1 : 0) - (a.link ? 1 : 0))
		.slice(0, LIMIT);

	const result = { films: list, sources, notes: [] };

	seen.set(key, result);

	return result;
}

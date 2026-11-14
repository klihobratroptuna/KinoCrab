// Основа каруселей: для дорам — список Kodik (тайтлы и постер отт же), для аниме —
// онгоинг animevost.org: он задаёт выборку и номер серии, а постер, оценка и числовые
// ключи приходят из строки Kodik по номеру Shikimori. Список Kodik для аниме остался
// только запасным путём, когда источник онгоинга не ответил.
//
// Почему для аниме убрали сортировку created_at (замер 2026-11-05): это порядок добавления
// тайтлов в базу Kodik, а не порядок выхода серий. В снимке дня 13 карточек из 20 были
// тайтлами прошлых лет — 2012, 2016, 2021, 2022, 2025, и ни один из десяти онгоингов
// animevost в тот день в выборке не был. Параметр status=ongoing API принимает, но ничего
// не ограничивает: при sort=last_air первыми идут строки со статусом released, поэтому
// статус фильтруем у себя по полю material_data.anime_status.
//
// Покрытие pipeline по 20 онгоингам того же дня: Shikimori нашёл все 20 имён по ромадзи,
// строка Kodik по номеру Shikimori — 19 из 20, номер серии совпал 17 из 20. Поиск Kodik по
// названию в тот же день дал 6 совпадений из 10 по-русски и 1 по ромадзи, поэтому
// сопоставление идёт по номеру Shikimori, а не по имени.
// Запасной путь постера, как договорились: если у Kodik постера нет или его хост у нас
// не открывается, постер ищем по названию в том, что дали animego и kinovibe — в их
// записях в нашей базе. Вид карточки, разметка и листание не меняются: карточка без
// постера остаётся и показывает первую букву названия.
//
// Замеры 2026-11-02, живой запрос из браузера через прокси nginx (/api/kodik/):
//   дорамы: types=foreign-serial, year=2026, countries=Корея Южная, with_material_data=1
//     -> total 449; 60 строк = 20 уникальных тайтлов. Kodik отдаёт по одной строке на
//     каждую студию озвучки, поэтому дедупликация по имени обязательна;
//     постеры: st.kp.yandex.net 12 из 20 открываются, i.mydramalist.com 8 из 20 отвечают
//     403 (проверено и с referer, и с пользовательским агентом);
//   аниме: types=anime-serial, year=2026 -> total 2895; 40 строк = 16 уникальных,
//     постеры открываются все 16 (6 st.kp.yandex.net, 10 shikimori.io);
//   оценки: у строк аниме в material_data есть shikimori_rating, у дорам —
//     mydramalist_rating. Оценкой AnimeGO Kodik не делится: красное поле (Shikimori)
//     есть у всех, зелёное заполняет отдельный скрипт src/lib/shared/animegoRating —
//     он читает их список сезона и даёт оценку только там, где тайтл в этом списке
//     есть. На замере 2026-11-02 из 20 карточек имя совпало 4 раза, оценка нашлась у 3
//     (8.0, 7.9, 8.2); остальные остаются с «—».
//   Порядок Kodik — сортировка created_at: это наша выборка, а не порядок их карусели,
//   потому что публичного API «как на их сайте» у Kodik нет.
//
// Запасной путь работает только по уже сохранённым записям, и вот почему (замер
// 2026-11-02): страница поиска kinovibe отвечает 200, но пустой оболочкой — 17346 байт,
// 0 карточек, ни одной ссылки /uploads/posts (GET и POST дают то же, /search/<slug> ->
// 404, зеркало с do=search -> 403). У animego из браузера страница не читается — ответ
// без access-control-allow-origin (проверено: «No 'Access-Control-Allow-Origin'
// header»), пути поиска отвечают 0 карточек или 404, поэтому оценка AnimeGO берётся
// отдельным скриптом из их списка сезона через прокси nginx (location /api/animego/).
// Поэтому постер находится там, где тайтл уже записан этими источниками:
// на замере 8 дорам Kodik (все с постерами MyDramaList) в их записях не нашлись ни одной.

import pb from '$lib/shared/pocketbase';
import { isKodikId } from '$lib/shared/kodik';
import netCache from '$lib/shared/netCache';
import netFetch, { netSummary } from '$lib/shared/net';
import {
	animeRecordByName,
	doramaRecordByName,
	nameKeyOf,
	shortNameOf
} from '$lib/shared/nameIndex';
import { ratingFromIndex, seasonRatings } from '$lib/shared/animegoRating';
import { ongoingRows } from '$lib/shared/animevost';
import { todayKey } from '$lib/shared/moscowDate';
import { readSnapshot } from '$lib/shared/scripts/snapshotCache';
import filmCache from '$lib/shared/scripts/filmCache';
import apiGetFilm from '$lib/shared/api/getFilm';

// Ключ каждой карусели: поле для сопоставления записей дня, поле дня и вид списка Kodik.
// В season_carousel отдельного поля kodikId нет, и схему мы не меняем: id Kodik кладём
// в slug, поле animegoId остаётся для номера AnimeGO.
const FEED = {
	drama: {
		collection: 'drama_carousel',
		keyField: 'kodikId',
		dateField: 'day',
		types: 'foreign-serial',
		// Kodik хранит страну как «Корея Южная». Повторный замер 2026-11-02 с
		// with_material_data=1: countries=Корея Южная -> total 449, countries=Южная Корея
		// -> total 0. В документации AnimeParsers имя написано как «Южная Корея», но по
		// такому написанию API отвечает пустым списком, поэтому в коде держим форму Kodik.
		countries: 'Корея Южная'
	},
	anime: {
		collection: 'season_carousel',
		keyField: 'slug',
		dateField: 'refreshedAt',
		types: 'anime-serial',
		// Этот список для аниме — запасной путь: выборка идёт из онгоинга animevost.
		// last_air — ближайший выход серии, created_at для онгоинга не подходит (см. начало
		// файла). Статус ongoing фильтруем в коде: параметр status=ongoing API игнорирует.
		sort: 'last_air'
	}
};

// Хосты постеров, которые у нас в браузере не открываются (замер 2026-11-02):
// i.mydramalist.com отвечает 403 на горячую ссылку, прокси для этого хоста нет, и
// добавлять его нельзя — правила постеров мы не трогаем. Значит такой постер показывать
// нечем, и карточка остаётся с первой буквой названия.
const BLOCKED_POSTER_HOSTS = new Set([
	'i.mydramalist.com',
	'ws-my.dramalist.net',
	'm.dramalist.net'
]);

// Сколько записей читаем за один запрос — как в каруселях источников: карусель около
// 10-20 карточек, страницы с запасом достаточно.
const SNAPSHOT_PAGE = 60;
const LOOKUP_PAGE = 5;

// Сколько карточек показываем: столько, сколько отдаёт выборка Kodik после дедупликации
// на замере (20 дорам, 16 аниме).
const CARD_LIMIT = 20;

/**
 * Правила прохода дорам, оставленные после сравнения с каруселью lordserials.fan
 * (замер 2026-11-04). Прежний вариант убрали: он год не давал —
 *
 *   выборка без года: total 5941, уникальных имён 24; с годом 2026 было 453 строки и 18
 *     имён, из-за чего дорамы 2021–2025 годов до карусели не доходили;
 *   постер: тот, что Kodik отдаёт сам, иначе по номеру Кинопоиска
 *     (st.kp.yandex.net/images/film_big/<id>.jpg отвечает 200). Из 60 строк выборки постер
 *     Kodik ведёт на i.mydramalist.com (403) в 14 случаях — такие карточки были с первой
 *     буквой названия; по номеру постер есть у 15 из 20 карточек;
 *   оценка: MyDramaList из той же строки Kodik, иначе Кинопоиск по номеру через
 *     v2.2/films/<id> (отдельный путь v2.1/ratings отвечает 400).
 *
 * Для аниме правила не меняются: там выборка строится по сезону, год остаётся.
 */

function clean(value) {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

// Значение для фильтра PocketBase — то же правило, что в nameIndex.
function filterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

// Постер Kodik: берём только тот, который действительно открывается у нас в браузере.
function usablePoster(url) {
	const raw = clean(url);

	if (!/^https?:\/\//i.test(raw)) return '';

	const host = hostOf(raw);

	if (!host || BLOCKED_POSTER_HOSTS.has(host)) return '';

	return raw;
}

function firstGenre(value) {
	if (Array.isArray(value)) return clean(value[0]);

	const text = clean(value);

	return text ? clean(text.split(',')[0]) : '';
}

function normalizeLink(link) {
	if (!link) return '';

	return link.startsWith('//') ? `https:${link}` : link;
}

// Строка серий в том же виде, что пишет карусель дорам: «1-12 Серия из 21».
function episodeOf(row, data) {
	const episode = clean(row.last_episode);
	const season = clean(row.last_season);
	const total = clean(data.episodes_total || row.episodes_count);

	if (!episode) return '';

	const shown = total || episode;

	return season ? `${season}-${episode} Серия из ${shown}` : `Серия ${episode} из ${shown}`;
}

function feedPath(kind, limit, year = '') {
	const feed = FEED[kind];
	const params = new URLSearchParams({
		types: feed.types,
		limit: String(limit),
		sort: feed.sort || 'created_at',
		order: 'desc',
		with_material_data: '1'
	});

	// Года в списке нет ни для дорам, ни для аниме. Для дорам убрали его раньше: с
	// year=2026 ответ даёт 453 строки, без года — 5941, и дорамы 2021–2025 годов выпадали
	// из выборки целиком (из 17 тайтлов карусели lordserials.fan 12 были 2021–2025 годов).
	// Для аниме список теперь запасной путь, и год там тоже убрали: онгоинг может идти с
	// прошлого года (замер 2026-11-05: «Пожиратель звёзд» Kodik знает годом 2023,
	// «Расколотая битвой синева небес» — годом 2025, оба онгоинги), и с годом year=2026
	// такие тайтлы выпадали. Без года сортировка last_air ставит свежие выходы первыми.
	if (year) params.set('year', String(year));

	if (feed.countries) params.set('countries', feed.countries);

	// Токен подставляет nginx (KODIK_TOKEN): в браузере его показывать нельзя.
	return `/api/kodik/list?${params}`;
}

/**
 * Выборка карусели. Аниме — онгоинг animevost: порядок задаёт самый свежий выход русской
 * озвучки, номер серии берётся из заголовка карточки источника. Если источник не ответил,
 * запасной путь — список Kodik по свежести выхода серий, где статус ongoing фильтруем у
 * себя. Дорамы — список Kodik, как договорились.
 */
async function feedRows(kind, byName = new Map()) {
	if (kind == 'anime') {
		const ongoing = await ongoingRows(byName);

		if (ongoing.ok) return ongoing;

		const backup = await listRows(kind);

		if (!backup.ok) return { ok: false, reason: `${ongoing.reason}; запасной Kodik: ${backup.reason}`, rows: [] };

		return { ok: true, reason: ongoing.reason, rows: uniqueRows(backup.rows.filter(ongoingRow)) };
	}

	return listRows(kind);
}

// Строка онгоинга по статусу самой Kodik: параметр status=ongoing API принимает, но список
// не ограничивает (замер 2026-11-05 — первыми шли строки со статусом released), поэтому
// статус читаем из поля material_data.anime_status.
function ongoingRow(row) {
	const data = row.material_data || {};

	return (data.anime_status || data.all_status || '') == 'ongoing';
}

async function listRows(kind, year = '') {
	const path = feedPath(kind, CARD_LIMIT * 3, year);
	const answer = await netCache(`kodik:feed:${kind}:${path}`, () =>
		netFetch(path, { timeoutMs: 15000, attempts: 3 })
	);

	if (!answer.ok) return { ok: false, reason: netSummary('Kodik', answer), rows: [] };

	// Массив строк в ответе list называется results, а не items (проверено живым
	// запросом через прокси nginx: total 449, results 60).
	return { ok: true, reason: '', rows: answer.data?.results || [] };
}

// Один тайтл — одна карточка: Kodik отдаёт по строке на каждую студию озвучки.
function uniqueRows(rows) {
	const seen = new Set();
	const rowsUnique = [];

	for (const row of rows) {
		const key = nameKeyOf(row.title);

		if (!key || seen.has(key)) continue;

		seen.add(key);
		rowsUnique.push(row);

		if (rowsUnique.length >= CARD_LIMIT) break;
	}

	return rowsUnique;
}

/**
 * Запись, которую эти источники уже дали нам по названию: календарь dorama_releases /
 * anime_releases, и как запасной путь — снимок прошлых дней. Нужна для постера и для
 * числовых ключей, по которым профиль находит карточку списка.
 */
async function matchRecord(kind, title) {
	const record = kind == 'drama' ? await doramaRecordByName(title) : await animeRecordByName(title);

	if (record) return record;

	// В карусельных коллекциях поля nameKey нет, поэтому сравнение через LIKE по короткому
	// имени — то же, что делает nameIndex.
	const feed = FEED[kind];
	const short = shortNameOf(title);

	if (!short) return null;

	const hits = await pb
		.collection(feed.collection)
		.getFullList({ filter: `title~"${filterValue(short)}"`, perPage: LOOKUP_PAGE })
		.catch(() => []);

	const full = nameKeyOf(title);

	return (
		hits.find((hit) => nameKeyOf(hit.title) == full) ||
		hits.find((hit) => nameKeyOf(hit.title) == short) ||
		null
	);
}

// Оценка AnimeGO для карточки Kodik: берём её из их списка сезона, а если тайтла там
// нет — из нашей записи AnimeGO прошлых дней. Ноль в этом поле означает «оценки нет»,
// поэтому его не показываем как оценку.
function numberRating(value) {
	const number = Number(value);

	return Number.isFinite(number) && number > 0 ? number : null;
}

function numberFromSlug(slug) {
	const match = /^carousel-(\d+)$/.exec(String(slug || ''));

	return match ? match[1] : '';
}

function patchFor(kind, row, pos, day, key, poster, note, match, record, rating) {
	const data = row.material_data || {};
	const title = clean(data.title || row.title);

	if (kind == 'drama') {
		return {
			day,
			pos,
			// Номера kinovibe у тайтла Kodik нет: число появляется только там, где тайтл
			// уже знаком по записям kinovibe (slug вида carousel-39275 в dorama_releases)
			// — по нему профиль находит карточку списка.
			kinovibeId:
				numberFromSlug(match?.slug) || numberFromSlug(record?.slug) || record?.kinovibeId || '',
			title,
			episode: episodeOf(row, data),
			poster,
			sourceUrl: normalizeLink(row.link),
			doramatvId: match?.doramatvId || record?.doramatvId || '',
			kodikId: row.id,
			kinopoiskId: String(row.kinopoisk_id || record?.kinopoiskId || ''),
			imdbId: String(row.imdb_id || record?.imdbId || ''),
			year: String(data.year || row.year || ''),
			genre: firstGenre(data.drama_genres || data.all_genres || data.genres),
			// Оценка: MyDramaList из строки Kodik, иначе Кинопоиск по номеру. Поле добавили
			// миграцией 1793800000 — раньше его не было, и блок показывал только строку серий.
			rating: rating != null ? String(rating) : '',
			checkNote: note,
			checkDay: day
		};
	}

	return {
		// Ключ пишем тот же, по которому читаем: сезон из currentSeason (2026/fall).
		season: key,
		pos,
		slug: row.id,
		animegoId: record?.animegoId || '',
		title,
		originalTitle: clean(data.title_en || data.other_titles || row.title_orig || row.other_title),
		// Строка серии: номер выхода русской озвучки из заголовка карточки animevost. Номер
		// строки Kodik иногда расходится (замер 2026-11-05: 17 совпадений из 20), поэтому
		// Kodik здесь только второй путь — когда страница номер не дала.
		episode: row.animevost?.episodeText || episodeOf(row, data),
		// Зелёное поле: оценка AnimeGO. Её даёт отдельный скрипт animegoRating из их
		// списка сезона, или наша запись AnimeGO прошлых дней; у Kodik такой оценки нет.
		// Если ни там, ни там тайтла не нашли, поле остаётся пустым («—»).
		rating: rating ?? null,
		badge: '',
		shikimoriId: String(row.shikimori_id || match?.shikimoriId || record?.shikimoriId || ''),
		kinopoiskId: String(row.kinopoisk_id || match?.kinopoiskId || record?.kinopoiskId || ''),
		// Ссылка: строка Kodik, иначе то, что уже лежало в записи, иначе страница источника —
		// для тайтлов, которых Kodik не знает, выхода наружу нет.
		sourceUrl: normalizeLink(row.link) || record?.sourceUrl || row.animevost?.pageUrl || '',
		refreshedAt: day,
		poster,
		// Красное поле: Shikimori. Оценка из строки Kodik, иначе из поиска Shikimori по
		// имени (для тайтлов, которых Kodik не знает), иначе та, что уже лежала в базе.
		score:
			Number(data.shikimori_rating || 0) ||
			Number(row.animevost?.score || record?.score || match?.score || 0) ||
			0,
		year: String(data.year || row.year || record?.year || ''),
		genre: firstGenre(data.genres || data.all_genres) || record?.genre || firstGenre(row.animevost?.genres) || '',
		imdbId: String(row.imdb_id || record?.imdbId || ''),
		checkNote: note,
		checkDay: day
	};
}

function noteFor(poster, direct, blockedHost) {
	if (direct) return 'Kodik: постер Kodik';
	if (poster)
		return `Kodik: постера нет${blockedHost ? ' (хост отвечает 403)' : ''}, взят по имени из записей kinovibe/animego`;

	return `Kodik: постера нет${blockedHost ? ' (хост отвечает 403)' : ''}, в записях kinovibe/animego по имени тоже не нашли`;
}

/**
 * Снимок: записи в порядке нашей выборки Kodik. Показываем только последний день — тайтлы,
 * которые вышли из выборки, остаются в базе с более ранним днём и в показ не попадают.
 * force нужен после суточного обновления: кэш в памяти мог сохранить снимок до записи.
 */
export async function snapshotFor(kind, key, force = false) {
	return readSnapshot(`kodikFeed:${kind}:${key}`, () => newestPage(kind, key), force);
}

// Один запрос вместо списка всей коллекции: сортировка по полю дня вниз ставит самый свежий
// день первыми, порядок pos внутри него — порядок выборки Kodik.
async function newestPage(kind, key) {
	const feed = FEED[kind];
	const options = { sort: `-${feed.dateField}, pos` };

	if (key) options.filter = `season="${filterValue(key)}"`;

	const page = await pb.collection(feed.collection).getList(1, SNAPSHOT_PAGE, options);
	const items = page?.items || [];

	const newest = items.length ? items[0][feed.dateField] : '';
	const group = newest ? items.filter((record) => record[feed.dateField] == newest) : items;

	// Одна карточка на тайтл: если в группе дня остались две записи одного имени —
	// наследие проходов, которые сопоставляли записи только по id Kodik, — показываем
	// первую, самую свежую.
	const seen = new Set();
	const cards = group.filter((record) => {
		const name = nameKeyOf(record.title);

		if (!name || seen.has(name)) return false;

		seen.add(name);

		return true;
	});

	return { day: newest, cards };
}

/**
 * Один проход обновления: список Kodik, дедупликация по имени, постер (Kodik, иначе по
 * имени — то, что дали kinovibe/animego), запись снимка. Возвращает { ok, reason, added,
 * updated } — причину пишет блок, чтобы было видно, что источник не ответил и показан
 * сохранённый снимок, а не пустая вкладка.
 */
export async function refreshFor(kind, key) {
	const feed = FEED[kind];
	const day = todayKey();

	// Записи прошлых дней читаем до выборки: выборка аниме строится по онгоингу animevost,
	// и тайтл, который уже сопоставлен по прошлым дням, повторно к Shikimori и Kodik не
	// ходит (у Shikimori лимит 5 запросов в секунду).
	const options = { sort: `-${feed.dateField}`, perPage: 300 };

	// Фильтр «ключ пустой» для аниме убираем: карточка онгоинга может быть без id Kodik, и
	// тогда её не найти по имени — каждый день создавался бы второй экземпляр того же тайтла.
	if (kind != 'anime') options.filter = `${feed.keyField} != ""`;

	const existing = await pb
		.collection(feed.collection)
		.getFullList(options)
		.catch(() => []);

	const byKey = new Map(existing.map((record) => [record[feed.keyField], record]));
	const byName = new Map();

	// existing отсортирован по полю дня вниз, поэтому первое совпадение по имени — самая
	// свежая запись тайтла.
	for (const record of existing) {
		const full = nameKeyOf(record.title);
		const short = shortNameOf(record.title);

		if (full && !byName.has(full)) byName.set(full, record);

		if (short && !byName.has(short)) byName.set(short, record);
	}

	const answer = await feedRows(kind, byName);

	if (!answer.ok) return { ok: false, reason: answer.reason, added: 0, updated: 0 };

	const rows = uniqueRows(answer.rows);

	if (!rows.length)
		return { ok: false, reason: 'список пуст: тайтлов не нашли', added: 0, updated: 0 };

	// Оценка AnimeGO — из отдельного скрипта, одним запросом на день. Для дорам её нет:
	// AnimeGO — это аниме, их список сезона дорам не содержит.
	const index =
		kind == 'anime' ? await seasonRatings(key) : { ok: false, reason: '', ratings: new Map() };

	// Записи дня сопоставляем по id Kodik, а если такой записи нет — по имени. Без поиска
	// по имени проход создавал второй экземпляр того же тайтла: тот же тайтл уже мог лежать
	// в базе записью AnimeGO/kinovibe за прошлые дни, и в показ попадали две карточки
	// одного тайтла — смешение. Теперь один тайтл = одна запись: её обновляем, а не
	// создаём заново, и id Kodik дописываем в ту же запись.

	// Оценка AnimeGO по имени из нашей базы. Зелёное поле может быть заполнено только
	// записью AnimeGO, потому что Kodik оценкой AnimeGO не делится. При этом nameIndex
	// находит календарную запись (anime_releases), а в ней оценки нет, поэтому смотрим на
	// запись карусели того же имени. Замер 2026-11-02: «Свадьба светлячков» есть в базе
	// записью AnimeGO с оценкой 8.6, но в их списке сезона её нет.
	const byNameRating = new Map();

	for (const record of existing) {
		const value = numberRating(record.rating);

		if (value == null) continue;

		const name = nameKeyOf(record.title);

		if (name && !byNameRating.has(name)) byNameRating.set(name, value);
	}

	let added = 0;
	let updated = 0;

	for (const [index_, row] of rows.entries()) {
		const data = row.material_data || {};
		const title = clean(data.title || row.title);
		// Для аниме запись уже найдена выбором по имени карточки источника: имена animevost и
		// строки Kodik различаются («... (второй сезон)» против «... 2»), и без этого
		// сопоставления проход создавал бы второй экземпляр того же тайтла.
		const record =
			row.matched ??
			byKey.get(row.id) ??
			byName.get(nameKeyOf(title)) ??
			byName.get(shortNameOf(title));
		const match = await matchRecord(kind, title);

		const blockedHost = BLOCKED_POSTER_HOSTS.has(
			hostOf(data.poster_url || data.drama_poster_url || '')
		);
		const direct = usablePoster(data.poster_url) || usablePoster(data.drama_poster_url);
		const fallback = match?.poster ? usablePoster(match.poster) : '';

		// Третий путь: картинку строим из одного номера Кинопоиска, который Kodik отдаёт в
		// строке, без запроса к API. Замер 2026-11-04 по дорамам lordserials.fan: из 60 строк
		// выборки постер Kodik ведёт на i.mydramalist.com (403), то есть direct пустой, а
		// st.kp.yandex.net/images/film_big/{id}.jpg отвечает 200 по всем четырём проверенным
		// номерам (6648249, 9027270, 8261500, 4934994). Тот же путь уже есть в seriesSource.
		const byNumber = row.kinopoisk_id
			? `https://st.kp.yandex.net/images/film_big/${row.kinopoisk_id}.jpg`
			: '';

		// Последний путь для аниме — картинка из поля anime_poster_url той же строки Kodik
		// (она ведёт на shikimori.io) или постер карточки источника. Замер 2026-11-05 по 20
		// онгоингам: у строк Kodik постер есть у всех 19 найденных — 8 на st.kp.yandex.net,
		// 11 на shikimori.io.
		const poster =
			direct || fallback || usablePoster(byNumber) || usablePoster(row.animevost?.poster);

		// Для дорам добавили путь по номеру Кинопоиска из строки Kodik. Замер 2026-11-04:
		// отдельный путь v2.1/ratings отвечает 400 на любом id, поэтому оценку берём из
		// ответа v2.2/films/<id> (200), поля ratingKinopoisk и ratingImdb. Он же даёт постер.
		// Проверяли по дорамам lordserials.fan: 6648249 -> КП 8.6, IMDb 8.4; 9027270 ->
		// 7.9/7.6; 8261500 -> 8.3/7.7; 4934994 -> 8.4/8.5. MyDramaList остаётся первым,
		// потому что он в той же строке без отдельного запроса; Кинопоиск — когда его нет.
		const kpEntry =
			kind == 'drama' && row.kinopoisk_id
				? await filmCache.load(row.kinopoisk_id, apiGetFilm)
				: null;

		// Сначала оценка AnimeGO из их списка сезона, потом то, что уже лежало в нашей
		// базе по этому имени: запись AnimeGO прошлых дней. Ноль — это не оценка, а
		// «оценки нет».
		const fromPage = kind != 'anime' ? null : ratingFromIndex(index.ratings, title);
		const fromBase =
			kind != 'anime' || fromPage != null
				? null
				: (byNameRating.get(nameKeyOf(title)) ??
					byNameRating.get(shortNameOf(title)) ??
					numberRating(record?.rating) ??
					numberRating(match?.rating));

		// Для дорам порядок такой: MyDramaList из той же строки Kodik (без отдельного
		// запроса), потом Кинопоиск по номеру, и только потом то, что уже лежало в базе.
		const fromMdl = kind == 'drama' ? numberRating(data.mydramalist_rating) : null;
		const fromKinopoisk =
			kind == 'drama' && kpEntry ? numberRating(kpEntry.ratingKinopoisk ?? kpEntry.rating) : null;

		const rating = fromPage ?? fromMdl ?? fromBase ?? fromKinopoisk;

		const ratingNote =
			kind != 'anime'
				? kind == 'drama' && fromMdl == null && fromKinopoisk != null
					? `; Кинопоиск ${row.kinopoisk_id}: ${fromKinopoisk}`
					: ''
				: rating != null
					? `; AnimeGO: ${rating}${fromPage == null ? ' (из нашей записи AnimeGO по имени)' : ''}`
					: index.ok
						? '; AnimeGO: тайтла нет ни в их списке сезона, ни в нашей базе по имени'
						: `; AnimeGO: ${index.reason}`;

		// Строка источника для аниме: выборку задаёт онгоинг animevost, строку Kodik нашли по
		// номеру Shikimori. Если Kodik тайтл не знает — это видно в заметке. Здесь же видно,
		// чем собирался список: страницей или RSS, потому что RSS не даёт постер, и откуда
		// взялся номер Shikimori: из записи прошлых дней, из календаря или из запроса.
		const sourceNote =
			kind == 'anime' && row.animevost
				? `animevost: онгоинг${row.animevost.id ? ` ${row.animevost.id}` : ''}${row.animevost.listNote ? ` (${row.animevost.listNote})` : ''}, Shikimori ${row.shikimori_id || '—'}${row.animevost.idVia ? ` (${row.animevost.idVia})` : ''}${row.animevost.reason ? `, ${row.animevost.reason}` : ''}: `
				: '';

		const patch = patchFor(
			kind,
			row,
			index_ + 1,
			day,
			key,
			poster,
			sourceNote + noteFor(poster, direct, blockedHost) + ratingNote,
			match,
			record,
			rating
		);

		try {
			if (record) {
				await pb.collection(feed.collection).update(record.id, patch);
				updated++;
			} else {
				await pb.collection(feed.collection).create(patch);
				added++;
			}
		} catch (error) {
			console.error(error);
		}
	}

	// Заполняем кэш в памяти тем, что только что легло в базу: блок после обновления читает
	// снимок, и без force получил бы день до записи.
	await snapshotFor(kind, key, true);

	return { ok: true, reason: '', added, updated };
}

// Ссылка внутри проекта. Аниме — id Shikimori и рядом номер фильма, дорама — номер фильма,
// иначе id записи источника, иначе id Kodik. Наружу карточка ведёт только когда искать нечем.
export function tileHrefFor(kind, card) {
	const name = card.title || card.originalTitle || '';
	const suffix = name ? `&title=${encodeURIComponent(name)}` : '';

	if (kind == 'drama') {
		if (card.kinopoiskId) return `/watch?kp=${card.kinopoiskId}&type=dorama${suffix}`;
		if (card.doramatvId) return `/watch?id=${card.doramatvId}&type=dorama${suffix}`;
		if (card.kodikId) return `/watch?id=${card.kodikId}&type=dorama${suffix}`;

		return name ? `/watch?title=${encodeURIComponent(name)}&type=dorama` : card.sourceUrl || '';
	}

	if (card.shikimoriId) {
		// Номер фильма держим в адресе рядом с id Shikimori. По id Shikimori Kodik привязывает
		// ответ к одной записи сезона, по номеру — к записи франшизы, и там серий больше: замер
		// 2026-11-11 по карточке онгоинга «Пожиратель звёзд» — Shikimori 44218 даёт 26 серий,
		// номер 4519776 даёт 223; по 10 карточкам онгоинга пути разошлись в четырёх. Страница читает
		// номер первым, id Shikimori остаётся запасным путем.
		const number = card.kinopoiskId ? `&kp=${card.kinopoiskId}` : '';

		return `/watch?id=${card.shikimoriId}${number}&type=anime${suffix}`;
	}

	if (card.kinopoiskId) return `/watch?id=${card.kinopoiskId}&type=anime${suffix}`;

	if (isKodikId(card.slug)) return `/watch?id=${card.slug}&type=anime${suffix}`;

	return card.sourceUrl || '';
}

// Открываем ли карточку внутри проекта: нужен числовой ключ или id Kodik, по которому
// страница /watch может искать материал.
export function canOpenInternal(kind, card) {
	if (kind == 'drama') return Boolean(card.kinopoiskId || card.doramatvId || card.kodikId);

	return Boolean(card.shikimoriId || card.kinopoiskId || isKodikId(card.slug));
}

/** Карточка снимка по названию — для страницы /watch, куда карусель ведёт без id записи. */
export async function cardByTitleFor(kind, key, title, force = false) {
	const snapshot = await snapshotFor(kind, key, force);
	const name = nameKeyOf(title);

	if (!name) return null;

	return snapshot.cards.find((card) => nameKeyOf(card.title) == name) || null;
}

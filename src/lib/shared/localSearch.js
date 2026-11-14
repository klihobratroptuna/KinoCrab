// Поиск по своим данным: четыре снимка каруселей (аниме, дорамы, фильмы, сериалы).
//
// Причина, почему это нужно: основной поиск сайта спрашивает только Kinopoisk
// (search-by-keyword), а там есть только те названия, которые знает Kinopoisk.
// Названия в каруселях — имена источника (AnimeGO и kinovibe), и по ним Kinopoisk
// часто ничего не находит. Замер 2026-10-31 по десяти тайтлам карусели аниме:
// три названия не дали ничего, в семи случаях первым результатом был не тот сезон
// («Голубая шкатулка 2» → «Голубая шкатулка»). Здесь сопоставляем запрос с названиями
// своих записей, поэтому карточка находится, пока тайтл лежит в снимке, и ссылка ведёт
// туда же, куда ведёт карточка карусели (tileHref), а не на /watch по номеру Kinopoisk.
//
// Снимок «Сериалов» участвует по той же причине. Замер 2026-11-03 по живой выборке окна:
// из 20 записей 14 без номера в Kinopoisk, и по этим именам поиск Kinopoisk в проходах
// карусели отвечал 0 результатов — карточка найдётся только здесь. Имена китайские и
// тайские, и Kinopoisk знает их по-русски редко: «Ао и Мидори», «Счастье в белом платье»,
// «Химия: Джаб и Джейн».
//
// PocketBase читает браузер, как и карусели: на prerender запроса нет. Снимок берём
// из кэша в памяти, если карусель уже читала его, — иначе это четыре коротких запроса
// к PocketBase (замер: около 10 мс на коллекцию).

import pb from '$lib/shared/pocketbase';
import { currentSeason, loadSnapshot as loadAnime, tileHref as animeHref } from '$lib/shared/kodikFeed/anime';
import { loadSnapshot as loadDrama, tileHref as dramaHref } from '$lib/shared/kodikFeed/drama';
import { loadMovieSnapshot, movieTileHref } from '$lib/shared/movieSource';
import { loadSeriesSnapshot, tileHref as seriesHref } from '$lib/shared/seriesSource';
import { nameKeyOf } from '$lib/shared/nameIndex';
import { isKinopoiskId } from '$lib/shared/kodik.js';

const TYPE = { anime: 'аниме', drama: 'дорама', movie: 'фильм', series: 'сериал' };

// Одно правило нормализации имени на весь проект: то же, что пишет поле nameKey
// ($lib/shared/nameIndex.js и scripts/scrape-doramas.mjs), иначе поиск по снимку и
// запрос по индексу могли бы считать одним и тем же именем разные строки.
export function normTitle(value) {
	return nameKeyOf(value);
}

const norm = normTitle;

// Год в каруселях дорам и аниме живёт внутри названия («Плетёный муж (2026)»), у аниме
// его нет — берём из скобок. В карусели фильмов год отдельным полем, потому что строку
// пишет подборка Kinopoisk, и название без скобок.
function yearOf(title) {
	const match = String(title || '').match(/\((\d{4})\)/);
	return match ? match[1] : '';
}

// Все слова запроса должны встречаться в названии: так «шкатулка» находит
// «Голубая шкатулка 2», а цифра сезона не мешает. Регистр кириллицы PocketBase
// не обезличивает, поэтому проверяем в коде, как делает kinovibe.
//
// Имя источника лежит в разных полях снимков: в каруселях дорам и аниме — originalTitle,
// в снимке «Сериалов» — titleOrig (строка Kodik называет тайтл по-русски и по-английски
// одновременно). Проверяем оба, чтобы поиск по оригинальному имени работал одинаково.
function originalOf(record) {
	return record.originalTitle || record.titleOrig || '';
}

function wordsMatch(title, originalTitle, words) {
	const t = norm(title);
	const o = norm(originalTitle);

	return words.every((word) => t.includes(word) || o.includes(word));
}

export function card(record, kind, href) {
	const note = [record.genre, record.episode].filter(Boolean).join(' · ');

	return {
		id: record.id,
		// id для карточки: номер Kinopoisk, иначе id Shikimori/Kodik, иначе id записи.
		filmId: record.kinopoiskId || record.shikimoriId || record.kodikId || record.id,
		nameRu: record.title,
		year: yearOf(record.title) || String(record.year || ''),
		type: TYPE[kind],
		rating: Number(record.rating || record.score || 0) || 0,
		posterUrlPreview: record.poster,
		// Описание есть сразу, поэтому запрос к Kinopoisk за карточкой не нужен.
		description: `нашли в карусели (${TYPE[kind]})${note ? ` · ${note}` : ''}`,
		// Ссылка — та же, что у карточки карусели.
		link: href(record),
		key: norm(record.title)
	};
}

/**
 * Совпадения по своим снимкам. Возвращает { items, failed, reason }: точные совпадения
 * первыми, дальше частичные, порядок внутри — порядок карусели.
 */
export async function searchLocal(query, force = false) {
	const q = norm(query);

	if (!q) return { items: [], failed: false, reason: '' };

	const words = q.split(' ').filter(Boolean);

	let snapshots;

	try {
		snapshots = [
			{ kind: 'anime', cards: (await loadAnime(currentSeason(), force)).cards, href: animeHref },
			{ kind: 'drama', cards: (await loadDrama(force)).cards, href: dramaHref },
			{ kind: 'movie', cards: (await loadMovieSnapshot(force)).cards, href: movieTileHref },
			{ kind: 'series', cards: (await loadSeriesSnapshot(force)).cards, href: seriesHref }
		];
	} catch (error) {
		// База могла не подняться: это не ошибка поиска, просто свои данные не проверить.
		return { items: [], failed: true, reason: error?.message || error?.name || 'не ответила' };
	}

	const found = snapshots.flatMap(({ kind, cards, href }) =>
		cards.filter((record) => wordsMatch(record.title, originalOf(record), words)).map((record) => card(record, kind, href))
	);

	return {
		items: [...found.filter((item) => item.key == q), ...found.filter((item) => item.key != q)],
		failed: false,
		reason: ''
	};
}

/**
 * Номер материала в Kinopoisk для id из адреса /watch.
 *
 * Адрес даёт не только номер: карточка карусели ведёт по id Shikimori (аниме), по id
 * Kodik, по id записи календаря или по номеру в параметре kp. Endpoint связей понимает
 * только номер фильма, поэтому для id источника номер ищем в своих коллекциях.
 *
 * type из адреса важен: он говорит, чем открыта страница, и меняет смысл числа. Для
 * аниме число в адресе — id Shikimori, для дорамы — id источника, и только без type
 * адрес держит номер материала в Kinopoisk. Замер 2026-11-10 по адресу
 * /watch?id=61153&type=anime: число 61153 — это id Shikimori («Переродившаяся великая
 * святая скрывает, что она святая»), номер у неё 14214094; без type endpoint вызывался
 * по числу 61153 и блок оставался пустым.
 *
 * Ищем одним коротким запросом по коллекции того вида, которым открыта страница, а не по
 * снимку карусели: снимок показывает только последний день выборки, а запись могла остаться
 * в базе с более ранним днём. Замер 2026-11-10: запись Shikimori 61153 лежит в
 * season_carousel с refreshedAt 2026-11-08, свежий день — 2026-11-10, по снимку её нет.
 *
 * Возвращает { number, via, failed, reason }. Пустой number — это не ошибка, это значит,
 * что по адресу проверить номер нечем.
 *
 * В fields только те поля, которые есть в коллекции. У drama_carousel, movie_carousel и
 * series_carousel поля slug нет, и фильтр с ним отвечает 400: из-за этого блок писал
 * «Something went wrong» вместо честного «по адресу номера нет» (замер 2026-11-10 по всем
 * четырём коллекциям).
 */
const NUMBER_LOOKUPS = [
	{ type: 'anime', kind: 'аниме', collection: 'season_carousel', fields: ['shikimoriId', 'slug', 'id', 'kinopoiskId'] },
	{ type: 'dorama', kind: 'дорама', collection: 'drama_carousel', fields: ['kodikId', 'doramatvId', 'kinovibeId', 'id', 'kinopoiskId'] },
	{ type: '', kind: 'фильм', collection: 'movie_carousel', fields: ['kodikId', 'id', 'kinopoiskId'] },
	{ type: '', kind: 'сериал', collection: 'series_carousel', fields: ['kodikId', 'id', 'kinopoiskId'] }
];

export async function numberFromAddress(id, type = '') {
	const key = String(id ?? '').trim();

	if (!key) return { number: '', via: '', failed: false, reason: '' };

	// Число без type — это и есть номер: так ведут карточки «Фильмы» и «Сериалы».
	if (!type && isKinopoiskId(key)) return { number: key, via: 'номер в адресе', failed: false, reason: '' };

	const order = [
		...NUMBER_LOOKUPS.filter((lookup) => lookup.type === type),
		...NUMBER_LOOKUPS.filter((lookup) => lookup.type !== type)
	];

	let reason = '';

	for (const lookup of order) {
		// Ищем по любому id, который мог попасть в адрес: собственный id записи, id
		// источника (Shikimori, Kodik, doramatv, kinovibe) и номер. Имена не сравниваем —
		// по имени блок не должен находить чужой тайтл, как это делает текстовый поиск.
		const filter = lookup.fields.map((field) => `${field}="${key.replace(/"/g, '')}"`).join(' || ');

		try {
			const page = await pb.collection(lookup.collection).getList(1, 1, { filter });
			const record = page?.items?.[0];

			if (isKinopoiskId(record?.kinopoiskId)) {
				return { number: String(record.kinopoiskId), via: `номер из ${lookup.kind}`, failed: false, reason: '' };
			}
		} catch (error) {
			// Коллекция могла не ответить: это не ошибка номера, просто там проверить нечем.
			reason = reason || error?.message || error?.name || 'не ответила';
		}
	}

	return { number: '', via: '', failed: Boolean(reason), reason };
}

// Разрешение записей списка профиля («Смотрю» / «Буду смотреть») — без новой таблицы.
//
// Поле film_id в коллекции lists числовое, поэтому в нём держится только номер: строковый id
// источника (serial-78450) PocketBase отвергает — замер HTTP 400. Значит в список можно
// сохранить тайтл, у которого есть числовой ключ: номер фильма в Kinopoisk или числовой id
// Shikimori у аниме. Дорама без номера в Kinopoisk (например Любовь среди гор и морей,
// id источника serial-78450) в lists не помещается — её сохранить нельзя, пока поле film_id
// остаётся числовым. Если у дorama-записи есть числовой id источника (doramatvId, kinovibeId),
// он и есть ключ: профиль читает lists только по числу, поэтому строковый id Kodik
// (serial-78450, serial-79357) сохранить нельзя. У аниме ключ — номер Kinopoisk или числовой
// id Shikimori, как в адресе карточки; id AnimeGO в адрес не попадает, поэтому по нему блок
// не появляется.
//
// Карточку собираем из своих коллекций теми же полями, что и карточки каруселей, и ссылка
// ведёт на нашу страницу (tileHref), как у карточки карусели. Дизайн карточки в профиле
// тот же, что у фильма, и запрос к Kinopoisk не нужен: описание есть сразу. Если тайтла в
// своих коллекциях нет, работает старый метод — номер читают как номер Kinopoisk через
// filmCache. Фильмы здесь не участвуют: у фильма остаётся только старый метод, он и раньше
// так работал (замер: карточка 7378605 идёт через Kinopoisk).
const PROFILE_LOOKUPS = [
	{ collection: 'drama_carousel', kind: 'drama', href: dramaHref, fields: ['kinopoiskId', 'doramatvId', 'kinovibeId'] },
	{ collection: 'season_carousel', kind: 'anime', href: animeHref, fields: ['kinopoiskId', 'shikimoriId'] },
	// Релизы читаем, если номера нет в снимке карусели: у drama_carousel номер не у всех
	// записей (6 из 23 сегодня), у anime_releases — 17 из 30 выборки. Без этой пары карточка
	// уходит в Kinopoisk и ссылка теряла type=dorama. В dorama_releases поля kinovibeId нет,
	// поэтому ключ kinovibeId находится только там, где запись снимка (drama_carousel).
	{ collection: 'dorama_releases', kind: 'drama', href: dramaHref, fields: ['kinopoiskId', 'doramatvId'] },
	{ collection: 'anime_releases', kind: 'anime', href: animeHref, fields: ['kinopoiskId', 'shikimoriId'] },
	// Снимок «Сериалы»: ключ только номер в Kinopoisk, потому что film_id в lists числовое и
	// строковый id Kodik (serial-78450) PocketBase отвергает. Замер 2026-11-03 по живым
	// спискам профиля: 10 записей, 8 чисел, 6 находятся в своих коллекциях, в series_carousel
	// — ни одного, то есть сегодня этот lookup ничего не меняет. Он нужен на будущее: номер у
	// карточки появляется, когда проход находит тайтл в Kinopoisk, и тогда карточка профиля
	// остаётся у нас (type «сериал», ссылка та же, что у карточки карусели), а не уходит
	// в Kinopoisk через filmCache. Улучшение даёт поиск по имени: там снимок участвует сразу,
	// 14 имён окна Kinopoisk не находит вообще.
	{ collection: 'series_carousel', kind: 'series', href: seriesHref, fields: ['kinopoiskId'] }
];

const profileCardCache = new Map();

// Один запрос на поле. Запросы к одной коллекции не должны пересекаться: SDK отменяет
// второй запрос к тому же пути, пока первый не закончен (замер на профиле: карточка
// 14328310 и карточка 63293 запросили drama_carousel одновременно, и оба ответа были
// отменены). Поэтому очередь — один запрос за раз, плюс один повтор при отмене.
let lookupQueue = Promise.resolve();

async function profileLookup(collection, filter) {
	const run = async () => {
		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				return await pb.collection(collection).getFullList({ filter });
			} catch (error) {
				if (!error?.isAbort || attempt === 2) return null;
			}
		}

		return null;
	};

	lookupQueue = lookupQueue.then(run);

	return lookupQueue;
}

export async function profileCard(number) {
	const key = String(number ?? '');

	if (!/^\d+$/.test(key)) return null;
	if (profileCardCache.has(key)) return profileCardCache.get(key);

	let found = null;

	for (const lookup of PROFILE_LOOKUPS) {
		for (const field of lookup.fields) {
			const records = await profileLookup(lookup.collection, `${field} = "${key}"`);

			if (records === null) {
				// База могла не подняться: это не «не нашли». Ничего не кэшируем, чтобы
				// неудачный ответ не закрепился, и уходим в обычный путь через Kinopoisk.
				return null;
			}

			if (records[0]) {
				found = card(records[0], lookup.kind, lookup.href);
				break;
			}
		}

		if (found) break;
	}

	profileCardCache.set(key, found);

	return found;
}

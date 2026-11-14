// Снимок карусели AnimeGO для вкладки «Аниме» на главной.
//
// Почему снимок нужен: порядок и оценка в их карусели — это голоса посетителей AnimeGO,
// их нельзя получить публичным API (никакая сортировка этот порядок не воспроизводит),
// поэтому страницу читаем и сохраняем как есть. Сохраняем и постер — ссылкой, не файлом:
// их CDN отвечает 200 и без нашего referer, так что на диске ничего не появляется.
//
// Обновление одно на сутки: блок при открытии смотрит, каким днём записан снимок, и если
// это не сегодня (по московскому времени, как и везде в проекте), читает страницу и
// обновляет записи. Если источник не ответил, показываем последний снимок — он уже лежит
// в базе, и пустая вкладка из-за одной неудачной попытки не появляется.
//
// Shikimori-оценку (красную) берём из уже сохранённой карточки, если тайтл есть в нашей
// базе; иначе один запрос через прокси /api/shikimori/ — там держится пауза 1.2 секунды,
// и лимит 5rps/90rpm не нарушается. Прокси нужен, потому что из браузера нельзя поставить
// пользовательский агент с именем приложения, который требуют правила Shikimori.
//
// Клик по плитке: наш путь — /watch. Если тайтл найден в Shikimori, id уже подходит
// плееру Kodik; если не найден, берём первое, что дал поиск сайта (по условию сезон не
// важен — пользователь выбирает его в плеере), и открываем материал по номеру в Kinopoisk.

import pb from '$lib/shared/pocketbase';
import { apiSearchFilm } from '$lib/shared/api';
import { ANIME_KINDS, shikimoriSearchByTitle } from '$lib/shared/shikimori';
import { todayKey } from '$lib/shared/moscowDate';
import { readSnapshot } from '$lib/shared/scripts/snapshotCache';
import { parseCarousel, seasonKeyByMonth, seasonName } from './parse.js';

const ORIGIN = 'https://animego.me';
const COLLECTION = 'season_carousel';
const TIMEOUT_MS = 12000;

// Сколько записей читаем за один запрос: раньше getFullList поднимал по 500 записей
// (значение по умолчанию в SDK 0.21.5), то есть всю историю дней сезона. Карусели
// источника — около 10 карточек, поэтому страницы с запасом достаточно.
const SNAPSHOT_PAGE = 60;

// Заголовки ответа проверены живым запросом: HTML отдаётся с разрешающим CORS, поэтому
// браузер может читать страницу сам. Ограничение — агент: его поставить нельзя, и защита
// источника иногда проверяет автоматический запрос. Поэтому разбор в браузере — попытка,
// а показывается всегда либо свежий снимок, либо последний сохранённый.
export { seasonKeyByMonth, seasonName };

export function currentSeason(now = new Date()) {
	const key = todayKey(now);
	const month = Number(key.split('-')[1]);

	return `${key.split('-')[0]}/${seasonKeyByMonth(month)}`;
}

export function seasonUrl(season) {
	return `${ORIGIN}/anime/season/${season}`;
}

/** Снимок сезона: записи в порядке их карусели. */
export async function loadSnapshot(season, force = false) {
	return readSnapshot(`animego:${season}`, () => newestPage(season), force);
}

// Один запрос вместо списка всей коллекции: сортировка '-refreshedAt, pos' (проверено
// живым запросом на season_carousel) ставит самый свежий день первыми, порядок pos
// внутри него — порядок карусели источника. Показываем только последний снимок: тайтлы,
// которые исчезли из их карусели, остаются в базе с более ранним днём и в показ не
// попадают.
async function newestPage(season) {
	const page = await pb
		.collection(COLLECTION)
		.getList(1, SNAPSHOT_PAGE, { filter: `season="${season}"`, sort: '-refreshedAt, pos' });

	const items = page?.items || [];

	const newest = items.length ? items[0].refreshedAt : '';

	return {
		day: newest,
		cards: newest ? items.filter((record) => record.refreshedAt == newest) : items
	};
}

async function fetchPage(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) return { ok: false, html: '', reason: `HTTP ${response.status}` };

		return { ok: true, html: await response.text(), reason: '' };
	} catch {
		return { ok: false, html: '', reason: `не ответил за ${TIMEOUT_MS / 1000} секунд` };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Один проход обновления: страница, разбор, сопоставление с Shikimori, запись снимка.
 * Возвращает { ok, reason, added, updated } — причину пишем в блоке, чтобы было видно,
 * что источник не ответил и показан сохранённый снимок, а не пустая вкладка.
 */
export async function refreshSnapshot(season) {
	const page = await fetchPage(`${ORIGIN}/`);
	let parsed = parseCarousel(page.html);

	// Карусель на главной — их собственная выборка. Если раздела нет (например, страница
	// пришла с проверкой), читаем страницу сезона — тот же разбор, порядок по странице.
	if (!parsed.cards.length) {
		const seasonPage = await fetchPage(seasonUrl(season));
		parsed = parseCarousel(seasonPage.html);

		if (!parsed.cards.length) {
			return {
				ok: false,
				reason: page.reason || seasonPage.reason || 'ничего не разобрал',
				added: 0,
				updated: 0
			};
		}
	}

	const day = todayKey();
	const known = await loadSnapshot(season);
	const bySlug = new Map(known.cards.map((record) => [record.slug, record]));

	let added = 0;
	let updated = 0;

	for (const card of parsed.cards) {
		const record = bySlug.get(card.slug);
		const patch = {
			// Ключ пишем тот же, по которому читаем: сезон из currentSeason (2026/fall).
			// Их адрес отдаёт только имя сезона (fall), и при сохранении этого имени чтение
			// по ключу с годом не находило снимок — вкладка оставалась пустой.
			season: season,
			pos: card.pos,
			slug: card.slug,
			animegoId: card.animegoId,
			title: card.title,
			originalTitle: card.originalTitle,
			rating: card.rating,
			badge: card.badge,
			poster: card.poster,
			sourceUrl: card.sourceUrl,
			refreshedAt: day
		};

		// Тайтл уже сопоставлен — второй раз к источнику не ходим: у Shikimori лимит
		// запросов, и за один день должен быть не больше одного прохода по карусели.
		if (!record?.shikimoriId && !record?.kinopoiskId) {
			const match = await shikimoriSearchByTitle({
				title: card.title,
				originalTitle: card.originalTitle
			});

			// Совпадение точное — берём. Если Shikimori предложил близкое, но запись
			// аниме-вида, тоже берём: по условию карусель открывает то, что нашёл поиск.
			// Мангу или манхву не берём — по такому id Kodik ничего не покажет.
			if (match?.id && (match.ok || ANIME_KINDS.includes(match.kind))) {
				patch.shikimoriId = match.id;
				patch.score = match.score ?? 0;
				if (!patch.poster && match.poster) patch.poster = match.poster;
			} else {
				// Поиск сайта — второй вариант по условию: открываем то, что нашлось.
				const found = await apiSearchFilm(card.title, 1);
				const film = found.films?.[0];

				if (film) {
					patch.kinopoiskId = String(film.kinopoiskId);
					if (!patch.poster && film.imageInfos?.length)
						patch.poster = `https://image.kinopoisk.ru/${film.imageInfos[0]}`;
				}
			}
		} else {
			patch.shikimoriId = record?.shikimoriId || '';
			patch.kinopoiskId = record?.kinopoiskId || '';
			patch.score = record?.score ?? 0;
		}

		try {
			if (record) {
				await pb.collection(COLLECTION).update(record.id, patch);
				updated++;
			} else {
				await pb.collection(COLLECTION).create(patch);
				added++;
			}
		} catch (error) {
			console.error(error);
		}
	}

	// Заполняем кэш в памяти снимком, который только что легло в базу: блок после
	// обновления читает снимок, и без force получил бы день до записи.
	await loadSnapshot(season, true);

	return { ok: true, reason: '', added, updated };
}

/** Ссылка внутри проекта: плеер ищет материал по номеру фильма, аниме — по номеру с id Shikimori рядом. */
export function tileHref(card) {
	if (card.shikimoriId) {
		// Название держим в адресе: на странице плеера нечего искать по id Shikimori,
		// когда записи в календаре нет, а по названию Kodik находит чаще.
		const name = card.title || card.originalTitle || '';
		// Рядом пишем номер фильма: по нему Kodik отвечает записью франшизы, по id Shikimori —
		// записью одного сезона (замер 2026-11-11: «Пожиратель звёзд», 26 серий против 223).
		const number = card.kinopoiskId ? `&kp=${card.kinopoiskId}` : '';

		return `/watch?id=${card.shikimoriId}${number}&type=anime${name ? `&title=${encodeURIComponent(name)}` : ''}`;
	}

	if (card.kinopoiskId) return `/watch?id=${card.kinopoiskId}`;

	return card.sourceUrl || '';
}

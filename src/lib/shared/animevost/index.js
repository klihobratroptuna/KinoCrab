// Выборка карусели аниме: онгоинг animevost.org — там список тайтлов с самой быстрой
// русской озвучкой, и в заголовке каждой карточки уже стоит номер вышедшей серии
// («[1-5 из 12+]» или «[6 серия - 11 ноября]»). Kodik-список для этого не годился:
// сортировка created_at — порядок добавления в базу Kodik, а не порядок выхода серий.
// Замер 2026-11-05: в снимке дня 13 карточек из 20 были тайтлами прошлых лет
// (2012, 2016, 2021, 2022, 2025), и ни один из десяти онгоингов animevost в тот день
// в выборке не был.
//
// Почему читаем страницу, а не API: JSON API у источника нет —
// api.animevost.org/.../GetList/?filter=onair отвечает 404 с путей сайта, а страница
// /ongoing/ отдаёт HTML DataLife Engine (10 карточек на страницу). Из браузера её
// прочитать нельзя: ответ без access-control-allow-origin, поэтому читаем через прокси
// nginx location /api/animevost/. Зеркало v14.vost.pw отдаёт ту же разметку.
//
// GitHub подтверждает такой путь: репозиторий Zavhorodnii/Animevost-ongoing
// (CheckRss.py) опрашивает rss.xml источника раз в 300 секунд. Проверено живым запросом
// 2026-11-05: RSS отвечает 200 через прокси, в нём 100 записей, тот же состав и тот же
// номер серии в заголовке, но нет постера — поэтому главной держим страницу /ongoing/,
// а RSS стал резервом на случай, когда страница не ответит.
//
// Неофициальный JSON API источника (api.animetop.info/v1/, его используют чужие клиенты)
// для выборки не годится: проверено POST-запросами 2026-11-05 — /search игнорирует
// параметры фильтра и выдаёт один и тот же тайтл, /last отдаёт по одному элементу на
// запрос, фильтра онгоинга там нет.
//
// Постер, оценка и id для карточки — из Kodik по номеру Shikimori: поиск Kodik по имени
// эти тайтлы находит плохо (замер 2026-11-05: 6 совпадений из 10 по-русски, 1 по
// ромадзи), а поиск по номеру Shikimori отвечает своей строкой — 20 из 20 онгоингов,
// 19 из них со строкой Kodik. Штраф за это — пауза: у Shikimori лимит 5 запросов в
// секунду, и он уже держит 1.2 секунды между запросами в $lib/shared/shikimori.
//
// Записи прошлых дней повторных запросов не вызывают: имя, которое уже сопоставлено,
// к источникам больше не ходит. С 2026-11-05 перед Shikimori смотрим ещё и календарь
// anime_releases — там номер уже лежит, и это запрос в PocketBase, не к источнику.
// Замер на записях дня: из 20 онгоингов внешнему источнику осталось 2 запроса вместо 20.

import { isKodikId } from '$lib/shared/kodik';
import netFetch, { netSummary } from '$lib/shared/net';
import netCache from '$lib/shared/netCache';
import { animeRecordByName, nameKeyOf, shortNameOf } from '$lib/shared/nameIndex';
import { ANIME_KINDS, shikimoriSearchByTitle } from '$lib/shared/shikimori';
import { todayKey } from '$lib/shared/moscowDate';
import { parseOngoing, parseRss } from './parse.js';

const ORIGIN = 'https://animevost.org';

// Зеркало v14.vost.pw — та же разметка и тот же RSS: оно вторым стоит в списке путей
// proxyPath, поэтому netFetch идёт к нему, когда основной адрес не ответил.

// 10 карточек на странице, берём две страницы — это 20 карточек, как лимит карусели.
const PAGES = 2;

function proxyPath(path) {
	return [`/api/animevost/${path}`, `/api/animevost-mirror/${path}`];
}

// Пауза между запросами к Kodik: выборка делается один раз в сутки, и 20 запросов
// подряд источник не должен получать.
const PAUSE_MS = 600;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeLink(link) {
	if (!link) return '';

	return link.startsWith('//') ? `https:${link}` : link;
}

// Постер со страницы источника — относительный путь /uploads/posts/... Без origin
// браузер его не покажет.
function absolutePoster(path) {
	const raw = clean(path);

	if (!raw) return '';

	return /^https?:\/\//i.test(raw) ? raw : `${ORIGIN}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

// Строка серии в том же виде, что пишет карусель дорам: «Серия 5 из 12+».
function episodeText(episode) {
	if (!episode?.current) return '';

	const total = episode.total ? `${episode.total}${episode.openEnded ? '+' : ''}` : '';

	return total ? `Серия ${episode.current} из ${total}` : `Серия ${episode.current}`;
}

async function readPages() {
	const cards = [];
	const notes = [];

	for (let page = 1; page <= PAGES && cards.length < PAGES * 10; page++) {
		// Прямого пути из браузера здесь нет: источник не отдаёт CORS-заголовки,
		// поэтому только прокси nginx — основной адрес и зеркало вторым.
		const answer = await netFetch(proxyPath(page == 1 ? 'ongoing/' : `ongoing/page/${page}/`), {
			timeoutMs: 12000,
			attempts: 3
		});

		if (!answer.ok) {
			notes.push(`страница ${page}: ${netSummary('animevost', answer)}`);
			break;
		}

		cards.push(...parseOngoing(answer.text));
	}

	if (cards.length) return { ok: true, reason: '', via: 'страница /ongoing/', cards, notes };

	// RSS — резерв: тот же состав онгоингов и тот же номер серии в заголовке, но без
	// постера. Его берут, когда страница не ответила или оказалась пустой.
	const answer = await netFetch(proxyPath('rss.xml'), { timeoutMs: 12000, attempts: 3 });

	if (!answer.ok) {
		return { ok: false, reason: `${notes.join('; ') || 'страница пустая'}; RSS: ${netSummary('animevost', answer)}`, cards: [] };
	}

	const rss = parseRss(answer.text, ORIGIN).slice(0, PAGES * 10);

	if (!rss.length) {
		return { ok: false, reason: `${notes.join('; ') || 'страница пустая'}; RSS: ни одной записи онгоинга не разобрал`, cards: [] };
	}

	return { ok: true, reason: '', via: 'RSS (страница не ответила)', cards: rss, notes };
}

/** Список онгоинга: один запрос на сутки, ключ кэша — день. */
export async function ongoingCards(force = false) {
	return netCache(`animevost:ongoing:${todayKey()}`, () => readPages(), force);
}

// Строка Kodik по номеру Shikimori. Параметр with_material_data=1 обязателен: без него
// search отвечает строку без material_data, то есть без постера и оценки (проверено
// живым запросом 2026-11-05).
async function kodikRowByShikimori(shikimoriId) {
	return netCache(`kodik:animevost:${shikimoriId}`, async () => {
		const answer = await netFetch(
			[`/api/kodik/search?limit=3&types=anime-serial&shikimori_id=${shikimoriId}&with_material_data=1`],
			{ timeoutMs: 15000, attempts: 2 }
		);

		if (!answer.ok) return { ok: false, reason: netSummary('Kodik', answer), row: null };

		const rows = answer.data?.results || [];

		return {
			ok: true,
			reason: '',
			row: rows.find((row) => String(row.shikimori_id) == String(shikimoriId)) || rows[0] || null
		};
	});
}

/**
 * Выборка карусели: онгоинг animevost, по одному тайтлу на имя. byName — уже сохранённые
 * записи карусели; тайтл, который знаком по прошлым дням, повторно к источникам не
 * запрашиваем.
 *
 * rows — в том же виде, что строка Kodik, чтобы разбор карусели не изменился: id, link,
 * material_data, номера imdb/kinopoisk/Shikimori. Плюс поле animevost: номер серии со
 * страницы, дата публикации, постер страницы и дата следующей серии.
 */
export async function ongoingRows(byName = new Map()) {
	const page = await ongoingCards();

	if (!page.ok) return { ok: false, reason: page.reason, rows: [] };

	const rows = [];
	const seen = new Set();

	for (const card of page.cards) {
		const key = nameKeyOf(card.title);

		if (!key || seen.has(key)) continue;

		seen.add(key);

		const record = byName.get(key) || byName.get(shortNameOf(card.title));

		// Номер Shikimori: по нему Kodik отвечает свою строку. Сначала смотрим нашу базу —
		// имя, которое уже сопоставлено по прошлым дням, и календарь anime_releases, где
		// номер лежит. Romaji из заголовка страницы — то, по чему Shikimori находит чаще
		// всего (замер: 20 из 20), но к API ходим только для того, чего нет в базе.
		// Замер 2026-11-05 на записях дня: из 20 онгоингов 17 находятся по имени (12 по
		// полному, 5 по имени без сезона словами), ещё 1 по календарю, запрос к Shikimori
		// остался для 2 тайтлов.
		let shikimoriId = record?.shikimoriId || '';
		let score = Number(record?.score || 0) || 0;
		// Откуда номер: из сохранённой записи, из календаря или из ответа API. В заметке
		// показываем только второе и третье — по ним видно, что внешнего запроса не было.
		let idVia = '';

		if (!shikimoriId) {
			// Календарь — это PocketBase, внешнего запроса здесь нет. Вид проверяем: тот же
			// тайтл в базе Shikimori бывает мангой или манхвой, и по такому id Kodik ничего
			// не покажет. Замер 2026-11-05: 10 онгоингов из 20 были в календаре с id, все
			// kind=tv.
			const calendar = await animeRecordByName(card.title);

			if (calendar?.shikimoriId && ANIME_KINDS.includes(calendar.kind)) {
				shikimoriId = String(calendar.shikimoriId);
				score = Number(calendar.score || 0) || score;
				idVia = 'календарь';
			}
		}

		if (!shikimoriId) {
			const match = await shikimoriSearchByTitle({
				title: card.originalTitle || card.title,
				originalTitle: card.title
			});

			if (match?.id) {
				shikimoriId = String(match.id);
				idVia = 'запрос';
			}

			score = Number(match?.score || 0) || score;
		}

		let row = null;
		let reason = '';

		if (shikimoriId) {
			// Строку Kodik не спрашиваем, если тайтл уже сопоставлен по прошлым дням:
			// номер серии приходит со страницы animevost, а постер и оценка уже лежат
			// в сохранённой записи.
			if (!isKodikId(record?.slug)) {
				const found = await kodikRowByShikimori(shikimoriId);

				row = found.row;
				reason = found.reason;

				await sleep(PAUSE_MS);
			}
		}

		if (!reason && !row && shikimoriId) reason = 'Kodik: строки нет по этому номеру Shikimori';

		const data = row?.material_data || {};

		if (Number(data.shikimori_rating || 0) > score) score = Number(data.shikimori_rating);

		rows.push({
			id: row?.id || (isKodikId(record?.slug) ? record.slug : ''),
			title: row?.title || card.title,
			title_orig: row?.title_orig || card.originalTitle,
			other_title: row?.other_title || '',
			year: row?.year || record?.year || card.year || '',
			kinopoisk_id: row?.kinopoisk_id || record?.kinopoiskId || '',
			imdb_id: row?.imdb_id || record?.imdbId || '',
			shikimori_id: String(shikimoriId || row?.shikimori_id || ''),
			// Номер серии со страницы — именно то, что просил пользователь: самая быстрая
			// русская озвучка. Если страница его не дала, берём номер строки Kodik.
			last_episode: card.episode?.current || row?.last_episode || 0,
			last_season: row?.last_season || '',
			episodes_count: card.episode?.total || row?.episodes_count || 0,
			link: normalizeLink(row?.link) || card.sourceUrl,
			material_data: data,
			// Запись, по которой тайтл уже знаком: имя карточки источника и имя строки Kodik
			// часто различаются («... (второй сезон)» против «... 2»), поэтому сопоставление
			// по имени карточки надёжнее, чем поиск по имени строки Kodik.
			matched: record || null,
			animevost: {
				id: card.id,
				slug: card.slug,
				pageUrl: card.sourceUrl,
				publishDate: card.publishDate,
				nextDate: card.episode?.nextDate || '',
				episodeText: episodeText(card.episode),
				poster: absolutePoster(card.poster) || absolutePoster(data.anime_poster_url),
				year: card.year || '',
				genres: card.genres || [],
				// Чем собран список: страница /ongoing/ или RSS, когда страница не ответила.
				// Это видно в заметке карточки, потому что RSS не даёт постер.
				listNote: page.via || '',
				// Пусто — номер был в сохранённой записи прошлых дней, то есть внешнего
				// запроса к Shikimori не было. «календарь» — нашли в anime_releases,
				// «запрос» — тайтл в базе новый, и мы спросили API.
				idVia,
				score,
				reason
			}
		});
	}

	if (!rows.length) return { ok: false, reason: 'список пуст: тайтлов не нашли', rows: [] };

	return { ok: true, reason: '', rows };
}

// Отдельный скрипт оценки AnimeGO. Он не трогает вид карточки, постер и листание:
// только заполняет поле rating у карточки аниме-карусели, когда тайтл есть в их списке
// сезона. Всё остальное по-прежнему приходит из Kodik.
//
// Почему через прокси, а не из браузера (замер 2026-11-02): страница animego.me отвечает
// без access-control-allow-origin, fetch из браузера падает с «Failed to fetch». Через
// контейнер тот же адрес отвечает 200, поэтому чтение идёт по location /api/animego/
// в nginx.conf.template — так же, как карусель дорам читает kinovibe.
//
// Почему только список сезона (замер 2026-11-02):
//   /anime/season/2026/fall -> 200, 21 карточка списка, 14 из них с оценкой;
//   /search/all?query=Tokyo+Revengers -> 200, но 0 карточек (оболочка, результаты
//   приходят скриптом); тот же запрос по-русски («Токийские мстители») — 0 карточек;
//   /search?query=, /search/anime?query=, /anime/search?query= -> 404.
// Значит по имени найти тайтл нечем: оценка possible только там, где тайтл уже лежит в
// их списке сезона, или в нашей базе как запись AnimeGO прошлых дней.
//
// Покрытие на живом замере 2026-11-02 (список Kodik за год против их страницы сезона):
//   20 карточек карусели, 20 карточек на их странице, имя совпало 4 раза, оценка
//   нашлась у 3 (8.0, 7.9, 8.2), ещё одно совпадение без оценки. Остальные карточки
//   остаются с «—» в зелёном поле — это честно: оценки AnimeGO у них нет ни у Kodik,
//   ни у нас в базе.
//
// Селекторы разметки те же, что в src/lib/shared/animego/parse.js (проверены живым
// запросом): карточка списка — class="ani-list__item ", оценка —
// class="rating-badge positive|neutral|negative">8.6, имя — alt у картинки.

import netCache from '$lib/shared/netCache';
import netFetch, { netSummary } from '$lib/shared/net';
import { nameKeyOf, shortNameOf } from '$lib/shared/nameIndex';
import { todayKey } from '$lib/shared/moscowDate';
import { parseCarousel } from '$lib/shared/animego/parse';

// Ключ сезона у нас бывает в двух видах: с годом (2026/fall, как его считает
// currentSeason) и без года (fall). Для адреса нужен год, поэтому без года берём
// текущий — тот же порядок, что в parse.js.
function seasonAddress(season) {
	const parts = String(season || '').split('/');

	if (parts.length < 2) return '';

	return parts.length > 1 ? parts.join('/') : `${parts[0]}`;
}

function seasonPath(season) {
	const key = seasonAddress(season);

	if (!key) return '';

	const address = `anime/season/${key}`;

	// Сначала прокси nginx (из браузера их страница не читается), потом прямая попытка —
	// на случай, если источник начнёт отдавать CORS-заголовки.
	return [`/api/animego/${address}`, `https://animego.me/${address}`];
}

/**
 * Имя -> оценка AnimeGO по их списку сезона. Один запрос в день: ключ кэша — день,
 * поэтому в тот же день повторный проход страницы не обращается к источнику.
 * Возвращает { ok, reason, ratings, parsed, withRating }.
 */
export async function seasonRatings(season, force = false) {
	const path = seasonPath(season);

	if (!path) return { ok: false, reason: 'не знаем имя сезона для адреса AnimeGO', ratings: new Map(), parsed: 0, withRating: 0 };

	const key = `animegoRating:${season}:${todayKey()}`;
	const answer = await netCache(key, () => netFetch(path, { timeoutMs: 15000, attempts: 3 }));

	if (!answer.ok) return { ok: false, reason: netSummary('AnimeGO', answer), ratings: new Map(), parsed: 0, withRating: 0 };

	const parsed = parseCarousel(answer.text);
	const ratings = new Map();

	for (const card of parsed.cards) {
		if (card.rating == null) continue;

		const full = nameKeyOf(card.title);
		const short = shortNameOf(card.title);

		if (full && !ratings.has(full)) ratings.set(full, card.rating);
		if (short && !ratings.has(short)) ratings.set(short, card.rating);

		const original = nameKeyOf(card.originalTitle);

		if (original && !ratings.has(original)) ratings.set(original, card.rating);
	}

	return {
		ok: true,
		reason: '',
		ratings,
		parsed: parsed.cards.length,
		withRating: parsed.cards.filter((card) => card.rating != null).length
	};
}

/** Оценка по имени: сначала точное сравнение, потом имя без суффикса сезона. */
export function ratingFromIndex(ratings, title) {
	if (!ratings || !ratings.size) return null;

	const full = nameKeyOf(title);

	if (!full) return null;

	return ratings.get(full) ?? ratings.get(shortNameOf(title)) ?? null;
}

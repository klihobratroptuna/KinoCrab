// Лента трейлеров для главной страницы: Atom feed Reddit r/trailers.
//
// Почему через прокси nginx: у Reddit для этой ленты нет JSON API, и из браузера её
// прочитать нельзя (ответ без access-control-allow-origin). Плюс источник отвечает 429 на
// не браузерный User-Agent — проверено живым запросом 2026-11-13: из контейнера через
// прокси с Chrome UA тот же адрес отвечает 200, с «curl/8.5.0» и «FeedReader» — 429, а с
// машины разработчика в этот же момент оба адреса дали 403/429. Поэтому главная путь —
// location /api/reddit/, где nginx подставляет браузерный User-Agent.
//
// Резервы: прямой запрос из браузера (CORS его не пропускает, но путь ничего не стоит)
// и CORS-прокси. Замер 2026-11-13: api.allorigins.win, corsproxy.io и api.rss2json.com
// с этой сети тоже не ответили — они работают только когда прокси nginx недоступен.

import netFetch, { netSummary } from '$lib/shared/net';
import netCache from '$lib/shared/netCache';
import { todayKey } from '$lib/shared/moscowDate';
import { parseFeed } from './parse.js';

const FEED = 'r/trailers/.rss';
const ORIGIN = 'https://www.reddit.com';

// При force (периодическое обновление) к пути добавляется метка времени: nginx отвечает
// Cache-Control max-age, поэтому без бустера fetch каждый раз берёт тот же ответ из
// HTTP-кэша браузера, и свежие записи в ленте не появляются. Reddit лишних параметров
// в этой ленте игнорирует — проверено на прокси.
function feedPaths(force = false) {
	const bust = force ? `?v=${Date.now()}` : '';

	return [
		`/api/reddit/${FEED}${bust}`,
		`${ORIGIN}/${FEED}${bust}`,
		`https://api.allorigins.win/raw?url=${encodeURIComponent(`${ORIGIN}/${FEED}${bust}`)}`
	];
}

/** Лента: ключ кэша — день, поэтому первый визит на страницу читает её один раз;
 *  периодическое обновление на странице идёт с force, то есть мимо кэша. */
export async function trailerFeed(force = false) {
	return netCache(`trailers:${FEED}:${todayKey()}`, async () => {
		const answer = await netFetch(feedPaths(force), { timeoutMs: 12000, attempts: 3 });

		if (!answer.ok) return { ok: false, reason: netSummary('Reddit', answer), cards: [], via: '' };

		const cards = parseFeed(answer.text);

		if (!cards.length) {
			return { ok: false, reason: 'лента пуста: ни одной записи со ссылкой на YouTube', cards: [], via: answer.via };
		}

		return { ok: true, reason: '', via: answer.via, cards };
	}, force);
}

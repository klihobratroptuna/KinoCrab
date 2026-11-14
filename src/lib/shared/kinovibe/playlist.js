// kinovibe как четвёртый источник на странице плеера. Строка появляется только когда
// Alloha, Collaps и Kodik ничего не нашли — так просил пользователь, и рабочие карточки
// из-за этого не меняются.
//
// Кадром этот источник показать нельзя: каждый embed-адрес отвечает 404. Замер
// 2026-11-01 по восьми тайтлам снимка карусели (id 39042, 39112, 39225, 39114, 39017,
// 39238, 39169, 39028) — все ответы 404, и браузерного игрока из такого адреса нет.
//
// Работает только файл плейлиста, который страница тайтла подставляет в Playerjs:
//   Playerjs({id:"playerjshd", file:"https://kinovibe.cc/player/pl/Balaraw.txt", ...})
// Страницу и плейлист читаем через прокси nginx (/api/kinovibe/): источник не отдаёт
// CORS-заголовки, из браузера его прочитать нельзя. Проверено 2026-11-01: страница
// 39296-balarao-1-sezon-2026.html — HTTP 200, на ней есть file:...Balaraw.txt, сам
// плейлист — HTTP 200 (text/plain) с 6 сериями.
//
// Сами видео лежат на их CDN (svd8.kvb.cool). nginx не может проксировать произвольный
// хост: на одну location настроен один хост, поэтому файл играет напрямую с их CDN.
// Проверено 2026-11-01: первый файл плейлиста (s01e01.mp4) открывается в <video> без
// referer — готовность 4, длительность 47 мин 37 с, ширина кадра 722.
//
// Запрос к странице источника делаем только в этом запасном случае: если у тайтла есть
// другой плеер, лишнего обращения к kinovibe нет.

import netCache from '$lib/shared/netCache';
import { proxyPath } from '$lib/shared/kinovibe/index.js';

const TIMEOUT_MS = 12000;

// Имя серии в плейлисте — HTML-строка вида «1 Серия<br>[AniDub]»: теги убираем,
// показывает то, что написано в самом плейлисте.
function episodeName(comment, index) {
	const clean = String(comment || '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	return clean || `серия ${index + 1}`;
}

async function proxyGet(path) {
	// proxyPath() даёт '/api/kinovibe/' с косой чертой на конце: location в nginx
	// совпадает только с путём, который начинается с неё.
	const clean = String(path || '').replace(/^\/+/, '');

	if (!clean) {
		return { ok: false, note: ' пути нет — читать нечего' };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(`${proxyPath()}${clean}`, { signal: controller.signal });

		if (!response.ok) {
			return {
				ok: false,
				note: `HTTP ${response.status}`,
				retry: !response.status || response.status >= 500
			};
		}

		return { ok: true, status: response.status, text: await response.text() };
	} catch {
		return {
			ok: false,
			note: `не ответил за ${TIMEOUT_MS / 1000} секунд`,
			retry: true
		};
	} finally {
		clearTimeout(timer);
	}
}

// Путь плейлиста на странице тайтла. Кэшируем только найденный путь, не всю страницу:
// страница — десятки килобайт, а повторяем мы именно этот поиск.
async function playlistPathForCard(card, force = false) {
	const url = String(card?.sourceUrl || '');
	const path = url.replace(/^https?:\/\/[^/]+\/?/, '').replace(/^\/+/, '');

	if (!path) {
		return { ok: false, note: 'адрес страницы источника пустой: читать нечего' };
	}

	return netCache(`kinovibe-playlist:${path}`, async () => {
		const page = await proxyGet(path);

		if (!page.ok) {
			return { ok: false, note: `страница источника ${page.note}`, retry: page.retry };
		}

		const file = (page.text.match(/file:\s*"([^"]+\.txt)"/) || [])[1] || '';

		if (!file) {
			return { ok: false, note: `на странице источника нет плейлиста Playerjs (HTTP ${page.status})` };
		}

		return { ok: true, path: file.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, ''), note: '' };
	}, force);
}

/**
 * Проверка источника: страница тайтла → путь плейлиста → список серий.
 * ok=true только когда плейлист действительно ответил и в нём есть серии; неудачу не
 * прикидываем успехом. Возвращает { ok, label, note, playlist, retry }.
 */
export async function playlistForCard(card, force = false) {
	const found = await playlistPathForCard(card, force);

	if (!found.ok) {
		return { ok: false, label: found.retry ? 'сеть' : 'пусто', note: found.note, retry: Boolean(found.retry) };
	}

	const answer = await netCache(`kinovibe-playlist-file:${found.path}`, () => proxyGet(found.path), force);

	if (!answer.ok) {
		return {
			ok: false,
			label: answer.retry ? 'сеть' : 'пусто',
			note: `плейлист ${answer.note}`,
			retry: Boolean(answer.retry)
		};
	}

	let playlist = [];

	try {
		const data = JSON.parse(answer.text);
		playlist = (Array.isArray(data?.playlist) ? data.playlist : []).map((item, index) => ({
			name: episodeName(item?.comment, index),
			file: String(item?.file || '')
		}));
	} catch {
		return { ok: false, label: 'пусто', note: `плейлист ${found.path} — ответ не разобрать (JSON)` };
	}

	playlist = playlist.filter((item) => item.file);

	if (!playlist.length) {
		return { ok: false, label: 'пусто', note: `плейлист ${found.path} ответил, серий в нём нет` };
	}

	return {
		ok: true,
		label: `${playlist.length} серий`,
		note: `плейлист источника: ${playlist.length} серий, файл ${found.path}`,
		playlist
	};
}

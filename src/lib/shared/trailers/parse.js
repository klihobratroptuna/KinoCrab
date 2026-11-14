// Разбор ленты трейлеров Reddit — Atom feed r/trailers. JSON API для этой ленты нет,
// а из браузера её прочитать нельзя: ответ без access-control-allow-origin, поэтому
// читаем через прокси nginx (location /api/reddit/). Проверено живым запросом
// 2026-11-13: .rss отвечает 200 только с браузерным User-Agent — с curl-подобным или
// «фид-ридером» тот же адрес отвечает 429.
//
// Запись ленты — <entry>: в <title> имя трейлера, в media:thumbnail url — превью,
// в <content type="html"> HTML-таблица, где [link] ведёт на само видео. Замер на ленте
// дня: 25 записей, у всех 25 есть превью и ссылка на YouTube. Разбор строками, как в
// animevost: RSS приходит текстом, DOMParser здесь не нужен.
//
// В карточку попадают только записи со ссылкой на youtube.com или youtu.be: лента постит
// и трекеры, и посты без видео. Карточка без видео не открывается — такой трейлер
// просто пропускаем.

const ENTITY = {
	'&amp;': '&',
	'&quot;': '"',
	'&#39;': "'",
	'&lt;': '<',
	'&gt;': '>',
	'&#32;': ' ',
	'&laquo;': '«',
	'&raquo;': '»',
	'&mdash;': '—',
	'&nbsp;': ' '
};

function text(value) {
	return String(value || '')
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&[a-z]+;/gi, (match) => ENTITY[match.toLowerCase()] || match)
		.replace(/\s+/g, ' ')
		.trim();
}

function first(pattern, value) {
	return pattern.exec(String(value || ''))[1] || '';
}

// Ссылка на видео из [link] в HTML-содержимом записи. Разбираем её после разбора
// сущностей: в RSS разметка content экранирована («&lt;a href=...&gt;»), и без этого
// регулярка не увидит тег. Если [link] нет — берём первую ссылку на YouTube: у части
// записей текст ссылки отличается, а адрес тот же.
function linkOf(content) {
	const named = /<a href="([^"]+)">\s*\[link\]\s*<\/a>/i.exec(content);
	return named ? named[1] : first(/<a href="(https?:\/\/[^"]*(?:youtube\.com|youtu\.be)[^"]*)"/i, content);
}

// Номер видео: 11 символов, форма адреса зависит от того, как постят ссылку —
// watch?v=, youtu.be/, embed/ или shorts/. Хост проверяем, чтобы не брать чужие
// ссылки (на ленте бывают и посты на трекеры).
const YT = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
const VIDEO = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

export function parseFeed(xml) {
	const cards = [];

	for (const entry of String(xml || '').split('<entry>').slice(1)) {
		const title = text(first(/<title>([\s\S]*?)<\/title>/, entry));
		const thumb = text(first(/<media:thumbnail[^>]*url="([^"]+)"/, entry));
		const content = text(first(/<content[^>]*>([\s\S]*?)<\/content>/, entry));

		if (!title) continue;

		const url = linkOf(content);
		const videoId = YT.test(url) ? (VIDEO.exec(url) || [])[1] || '' : '';

		if (!videoId) continue;

		cards.push({
			id: first(/<id>([\s\S]*?)<\/id>/, entry) || url,
			title,
			thumb,
			url,
			videoId,
			// Дата публикации записи — ISO («2026-11-13T04:12:27+00:00»). Как строку её
			// не показываем: в карточке дата по Москве, её считает страница из UTC-метки.
			published: first(/<published>([\s\S]*?)<\/published>/, entry) || first(/<updated>([\s\S]*?)<\/updated>/, entry)
		});
	}

	return cards;
}

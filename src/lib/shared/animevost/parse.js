// Разбор страницы animevost.org/ongoing/ — DataLife Engine, JSON API у источника нет
// (проверено: api.animevost.org/.../GetList/?filter=onair отвечает 404 с путей сайта,
// из браузера страницу читать нельзя — ответ без access-control-allow-origin, поэтому
// читаем её через прокси nginx /api/animevost/).
//
// Карточка списка — блок class="shortstory", на странице их 10, дальше идёт page/2/.
// Заголовок блока даёт имя и номер серии:
//   «Магия вернувшегося должна быть особенной (второй сезон) / Kikansha no Mahou wa
//    Tokubetsu desu 2nd Season [1-5 из 12+]»
//   «... / Romaji [6 серия - 11 ноября]»
// Плюс: дата публикации (staticInfoLeftData), постер (imgRadius), номер записи в адресе
// /tip/tv/<id>-<slug>.html.
//
// Резервный путь — RSS источника (parseRss ниже): он отвечает 200 и даёт тот же состав
// онгоингов с тем же номером серии в заголовке, но без постера. Практика подтверждена
// GitHub — репозиторий Zavhorodnii/Animevost-ongoing (CheckRss.py) опрашивает этот RSS
// раз в 300 секунд. Страницу берём главной, потому что она даёт постер; RSS — когда
// страница не ответила.

const ENTITY = {
	'&amp;': '&',
	'&quot;': '"',
	'&#39;': "'",
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

// «1-5 из 12+» — диапазон вышедших серий; «6 серия - 11 ноября» — последняя серия и дата
// следующей. Число с плюсом («12+») — общее количество серий ещё не объявлено.
function progressOf(head) {
	const range = /\[(\d+)(?:\s*-\s*(\d+))?\s+из\s+(\d+)(\+?)\]/.exec(head);

	if (range) {
		return {
			current: Number(range[2] || range[1]),
			total: Number(range[3]),
			openEnded: range[4] == '+',
			nextDate: ''
		};
	}

	const single = /\[(\d+)\s+серия\s*[-–]\s*([^\]]+)\]/i.exec(head);

	if (single) {
		return { current: Number(single[1]), total: 0, openEnded: false, nextDate: text(single[2]) };
	}

	return { current: 0, total: 0, openEnded: false, nextDate: '' };
}

// Имя без скобки с номером серии: «Русское имя / Romaji» — первое поле по-русски,
// второе — ромадзи, по нему Shikimori находит тайтл чаще всего.
function nameOf(head) {
	return head
		.replace(/\s*\[\d[\d\s,-]*\s+из\s+\d+\+?\]/g, '')
		.replace(/\s*\[\d+\s+серия[^]]*\]/g, '')
		.trim();
}

function stripCdata(value) {
	return String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '');
}

// Дата публикации в RSS — «Wed, 04 Nov 2026 21:20:57 +0300». Приводим к виду страницы
// источника («04.11.2026»), чтобы обе ветки писали дату одинаково.
const MONTHS = {
	jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
	jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function rssDate(value) {
	const match = /^\w+,\s+(\d{1,2})\s+([a-z]{3})\s+(\d{4})/i.exec(String(value || '').trim());

	if (!match) return text(value);

	return `${match[1].padStart(2, '0')}.${MONTHS[match[2].toLowerCase()]}.${match[3]}`;
}

export function parseOngoing(html) {
	const blocks = String(html || '').split('class="shortstory"').slice(1);
	const cards = [];

	for (const [index, block] of blocks.entries()) {
		const head = text((/class="shortstoryHead"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(block) || [])[1]);
		const link = (/class="shortstoryHead"[\s\S]*?<a[^>]*href="([^"]+)"/.exec(block) || [])[1] || '';

		if (!head) continue;

		const name = nameOf(head);

		if (!name) continue;

		const [ru, romanji] = name.split('/').map((part) => part.trim());
		const id = (/\/tip\/tv\/(\d+)/.exec(link) || [])[1] || '';
		const slug = (/\/tip\/tv\/\d+-([^.]+)\.html/.exec(link) || [])[1] || '';

		cards.push({
			pos: index + 1,
			id,
			slug,
			title: ru || name,
			originalTitle: romanji || '',
			episode: progressOf(head),
			publishDate: text((/class="staticInfoLeftData">([^<]+)</.exec(block) || [])[1]),
			poster: (/class="imgRadius"[^>]*src="([^"]+)"/.exec(block) || [])[1] || '',
			year: '',
			genres: [],
			via: 'page',
			sourceUrl: link
		});
	}

	return cards;
}

/**
 * RSS источника — резервный путь, когда страница /ongoing/ не ответила. Замер
 * 2026-11-05: /rss.xml отвечает 200 через прокси nginx, в нём 100 записей и тот же
 * порядок онгоингов, что на первой странице; заголовок записи несёт тот же номер серии.
 * Чего в RSS нет: постера (его даёт Kodik или Shikimori) и года в самой карточке — год
 * лежит в категории, из неё же берутся жанры.
 *
 * Берём только записи с категорией «Онгоинги»: RSS отдаёт и обычные публикации сайта.
 */
export function parseRss(xml, origin = 'https://animevost.org') {
	const cards = [];

	for (const item of String(xml || '').split('<item>').slice(1)) {
		const head = text(stripCdata((/<title>([\s\S]*?)<\/title>/.exec(item) || [])[1]));
		const category = text(stripCdata((/<category>([\s\S]*?)<\/category>/.exec(item) || [])[1]));

		if (!head || !/онгоинг/i.test(category)) continue;

		const link =
			text((/<link>([\s\S]*?)<\/link>/.exec(item) || [])[1]) ||
			text((/<guid[^>]*>([\s\S]*?)<\/guid>/.exec(item) || [])[1]);
		const path = (/\/tip\/tv\/\d+[^"]*\.html/.exec(link) || [])[0] || '';

		if (!path) continue;

		const name = nameOf(head);

		if (!name) continue;

		const [ru, romanji] = name.split('/').map((part) => part.trim());
		const parts = category.split(',').map((part) => part.trim());

		cards.push({
			pos: cards.length + 1,
			id: (/\/tip\/tv\/(\d+)/.exec(link) || [])[1] || '',
			slug: (/\/tip\/tv\/\d+-([^.]+)\.html/.exec(link) || [])[1] || '',
			title: ru || name,
			originalTitle: romanji || '',
			episode: progressOf(head),
			publishDate: rssDate((/<pubDate>([\s\S]*?)<\/pubDate>/.exec(item) || [])[1]),
			poster: '',
			year: parts.find((part) => /^\d{4}$/.test(part)) || '',
			genres: parts.filter((part) => part && part != 'ТВ' && part != 'Онгоинги' && !/^\d{4}$/.test(part)),
			via: 'rss',
			sourceUrl: `${origin}${path}`
		});
	}

	return cards;
}

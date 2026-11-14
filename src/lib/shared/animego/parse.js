// Разбор страницы AnimeGO по разметке. Парсим HTML, потому что их порядок карусели
// нельзя получить ни одной сортировкой публичного API: это их собственная выборка
// голосов посетителей, и порядок меняется в течение дня. Поэтому порядок — как он
// стоит в ответе, и сохраняется снимком.
//
// Селекторы проверены живым запросом (2026-10-29):
//   карусель на главной:   <div class="scroll-snap-slide ..."> внутри
//                          <div class="scroll-snap-slider ..."> раздела
//                          <section class="carousel-section season-section">
//   страница сезона:       <div class="ani-list__item ...">
//   оценка:                <div class="rating-badge positive|neutral|negative">8.6</div>
//   постер:                <img class="image__img rounded" src="https://img.cdngos.com/v/250x350/...">
//   имя:                   alt у картинки и title у ссылки — русское название;
//                          отдельный блок fw-lighter small — оригинальное (романизированное).
//   ссылка на карточку:    href="/anime/<slug>-<id>", где id — номер AnimeGO,
//                          НЕ id Shikimori (проверено: 3815 против 63293).
//
// Оценку и тон берём только если блок оценки есть: без него card.rating = null,
// и красная строка (Shikimori) остаётся единственной.

// С пробелом на конце: без него подстроку ловит и контейнер slideR —
// class="scroll-snap-slider", который не карточка.
const SLIDE_START = 'class="scroll-snap-slide ';
const ITEM_START = 'class="ani-list__item ';

// Имя сезона в их адресе: /anime/season/2026/fall. Русское название — для заголовка.
const SEASON_RU = {
	winter: 'зимнего сезона',
	spring: 'весеннего сезона',
	summer: 'летнего сезона',
	fall: 'осеннего сезона'
};

// Месяц -> сезон. Проверено по их заголовку: 29 октября — «Аниме осеннего сезона»
// и ссылка /anime/season/2026/fall.
export function seasonKeyByMonth(month) {
	if (month <= 3) return 'winter';
	if (month <= 6) return 'spring';
	if (month <= 9) return 'summer';

	return 'fall';
}

export function seasonName(season) {
	// Ключ сезона бывает в двух видах: их имя из адреса (fall) и с годом (2026/fall),
	// как его считает currentSeason. Берём последнее значение.
	const name =
		SEASON_RU[
			String(season || '')
				.split('/')
				.pop()
		];

	return name ? name : 'текущего сезона';
}

function text(value) {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function firstMatch(chunk, pattern) {
	const match = pattern.exec(chunk);

	return match ? match[1] : '';
}

/** Один тайтл из одного блока карусели (или списка сезона). */
function cardFromChunk(chunk, index) {
	const rating = firstMatch(chunk, /class="rating-badge(?:\s+([a-z-]+))?"/);
	const value = firstMatch(chunk, /class="rating-badge[^"]*"[^>]*>\s*([\d.]+)/);
	const href = firstMatch(chunk, /href="(\/anime\/[^"]+)"/);
	const poster = firstMatch(chunk, /<img[^>]*\ssrc="([^"]+)"/);
	const title = firstMatch(chunk, /alt="([^"]*)"/) || firstMatch(chunk, /title="([^"]*)"/);
	const original = firstMatch(chunk, /class="fw-lighter small[^"]*"[^>]*>\s*([^<]+)/);

	if (!title || !href) return null;

	// Их номер — последние цифры в адресе карточки. Он нужен только для ссылки наружу.
	const animegoId = (href.match(/-(\d+)$/) || [])[1] || '';

	return {
		pos: index,
		slug: href,
		animegoId,
		title,
		originalTitle: text(original),
		rating: value ? Number(value) : null,
		badge: rating || '',
		poster: poster || '',
		sourceUrl: `https://animego.me${href}`
	};
}

/**
 * Возвращает { season, url, cards }. section — имя сезона из их адреса, если он есть
 * в заголовке; cards — тайтлы в том порядке, в каком их отдаёт страница.
 */
export function parseCarousel(html) {
	const source = String(html || '');
	const seasonMatch = /(\/anime\/season\/\d+\/[a-z]+)/.exec(source);
	const season = seasonMatch ? seasonMatch[1].split('/').pop() : '';

	const start = source.indexOf(SLIDE_START) >= 0 ? SLIDE_START : ITEM_START;
	if (source.indexOf(start) < 0) return { season, url: '', cards: [] };

	// Порядок — как в ответе страницы: его нельзя восстановить сортировкой API,
	// поэтому позиции считаются по фактическим карточкам, а не по месту в разметке.
	const cards = [];

	for (const chunk of source.split(start).slice(1)) {
		const card = cardFromChunk(chunk, cards.length + 1);
		if (card) cards.push(card);
	}

	return {
		season,
		url: seasonMatch ? `https://animego.me${seasonMatch[1]}` : '',
		cards
	};
}

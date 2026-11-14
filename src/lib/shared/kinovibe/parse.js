// Разбор блока «Дорамы» на главной странице kinovibe по разметке. Карусель фильмов больше
// тут не разбирается: она читает свою коллекцию movie_carousel, которую наполняет Kinopoisk
// ($lib/shared/movieSource.js), и к чужой разметке не обращается.
//
// Порядок карусели — их собственная выборка, публичного API у источника нет, поэтому
// страницу читаем и сохраняем как есть: порядок — как он стоит в ответе.
//
// Селекторы проверены живым запросом (2026-10-29):
//   блок дорам:  <div class="section"> ... <h2>...Дорамы</h2> ...
//                <div class="section-content clearfix owl-movies">
//   карточка:    <div class="custom1-item">
//   ссылка:      <a class="custom1-img" href="/39042-yagodnaya-lyubov-1-sezon-2026.html">
//   постер:      <img ... src="/uploads/posts/...">
//   название:    <div class="custom1-title">Ягодная любовь 1 Сезон (2026)</div>
//   строка серий: <div class="ShortStorySerias">1-4 Серия из 10</div>
//
// Оценки в разметке нет: блок custom1-rate пустой, оценку сайт догружает отдельным
// запросом. В карусели дорам показываем название и строку серий; оценка приходит из
// Kinopoisk отдельной проверкой тайтла.
//
// Слово «Дорамы» встречается и в шапке меню, и в соседних блоках, поэтому разбор
// ограничен одним блоком section, а не всем документом. На проверенной странице в нём
// ровно 10 карточек.
//
// Карточки обоих блоков собраны из одной разметки; в блоке «Премьеры» ссылка абсолютная
// (https://kinovibe.cc/...), в «Дорамы» относительная — поэтому адрес приводим к
// абсолютному в обоих случаях. Строки серий в блоке «Премьеры» нет: это фильмы.

const KINOVIBE = 'https://kinovibe.cc';
const SECTION_START = '<div class="section">';
const CARD_START = 'class="custom1-item"';

function text(value) {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function firstMatch(chunk, pattern) {
	const match = pattern.exec(chunk);

	return match ? match[1] : '';
}

// Короткое имя для поиска: «Ягодная любовь 1 Сезон (2026)» → «Ягодная любовь».
// Проверяли на живых данных: PocketBase находит запись календаря только коротким именем
// (фильтр ~ означает «поле содержит», а поле в календаре короче, чем название плитки),
// и Kodik по полному имени с «1 Сезон (2026)» ничего не даёт, а по короткому находит.
// Регистр сохраняем: PocketBase сравнивает ~ как LIKE, и для кириллицы он регистр не
// обезличивает (проверено: lowercase-фильтр не нашёл «Безмолвные»).
export function shortTitle(value) {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\s*\d{1,3}\s+Сезон\s*\(\d{4}\)$/i, '')
		.replace(/\s*\(\d{4}\)$/i, '')
		.trim();
}

/** Одна карточка из блока дорам (поле id — номер в их адресе, он нужен только для ссылки). */
function cardFromChunk(chunk, index) {
	const href = firstMatch(chunk, /<a class="custom1-img" href="([^"]+)"/);
	const poster = firstMatch(chunk, /<img[^>]*\ssrc="([^"]+)"/);
	const title = firstMatch(chunk, /class="custom1-title">\s*([^<]+)</);
	const episode = firstMatch(chunk, /class="ShortStorySerias">\s*([^<]+)</);

	if (!title || !href) return null;

	return {
		pos: index,
		kinovibeId: (href.match(/\/(\d+)-/) || [])[1] || '',
		title: text(title),
		episode: text(episode),
		// Постер сохраняем ссылкой: их CDN отвечает 200 и без нашего referer (проверено),
		// поэтому файл на диске не появляется и прокси для картинки не нужен.
		poster: poster.startsWith('http') ? poster : `${KINOVIBE}${poster}`,
		sourceUrl: href.startsWith('http') ? href : `${KINOVIBE}${href}`
	};
}

/**
 * Карточки блока «Дорамы» в том порядке, в каком их отдаёт страница.
 * Возвращает [] — если блока нет (страница пришла с проверкой или разметка изменилась),
 * и блок тогда показывает последний сохранённый снимок.
 */
export function parseDramaCarousel(html) {
	return parseSection(html, 'Дорамы');
}

function parseSection(html, heading) {
	const cards = [];

	for (const block of String(html || '').split(SECTION_START).slice(1)) {
		if (!new RegExp(`>${heading}<\\/h2>`).test(block.slice(0, 1200))) continue;

		for (const chunk of block.split(CARD_START).slice(1)) {
			const card = cardFromChunk(chunk.slice(0, 900), cards.length + 1);
			if (card) cards.push(card);
		}

		break;
	}

	return cards;
}

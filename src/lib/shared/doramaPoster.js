// Постеры дорам. Часть хостов требует referer источника: dr.one-way.work без него
// отвечает 403, поэтому там работает прокси nginx с подставленным referer. Хост kinovibe.cc
// отвечает 200 и без referer (проверено живым запросом), но картинку тоже ведём через
// прокси: так запрос идёт с нашего адреса, и карточка не зависит ни от правил источника,
// ни от блокировщика, который отсеивает посторонние домены. В PocketBase храним
// исходный адрес постера, здесь из него строится путь прокси. Вид карточки не меняется:
// тот же img, только адрес.

// Хосты и их прокси-префиксы в nginx.conf.template. Если зеркало или CDN поменяются,
// нужно поменять список здесь и апстрим в nginx.
const PROXY_PREFIX = {
	'kinovibe.cc': '/api/kinovibe',
	'dr.one-way.work': '/api/dorama-poster',
	// Постеры TMDB (последний запасной путь postera в карусели «Сериалы»,
	// src/lib/shared/tmdbPoster/index.js) — по тому же правилу: картинка идёт с нашего
	// адреса, поэтому карточка не зависит от блокировщика посторонних доменов.
	'image.tmdb.org': '/api/tmdb-poster',
	// Постер по номеру Кинопоиска (src/lib/shared/kodikFeed/index.js, путь film_big).
	// Картинка отвечает 200 без referer, но ведём её через прокси по тому же правилу.
	'st.kp.yandex.net': '/api/kp-poster'
};

export function posterUrl(record) {
	const raw = String(record?.poster || '');

	if (!raw) return '';

	if (!/^https?:\/\//i.test(raw)) return raw;

	try {
		const url = new URL(raw);
		const prefix = PROXY_PREFIX[url.hostname];

		if (!prefix) return raw;

		return `${prefix}${url.pathname}`;
	} catch (error) {
		return raw;
	}
}

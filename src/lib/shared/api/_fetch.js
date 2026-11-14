import options from './_options';
import netFetch from '../net';

// Один и тот же адрес в двух вариантах: путь прокси nginx и прямой адрес браузера.
// Прокси идёт первым, потому что браузеру нужен только localhost:3000 — маршрут
// браузера до kinopoiskapiunofficial.tech на холодном старте падает, а маршрут
// контейнера к нему работает (проверено: 379 мс из контейнера против 12 секунд и
// обрыва из браузера в тот же момент). Прямой запрос оставлен как запасной путь:
// если KINOPOISK_API_KEY пустой, браузер сам подставляет ключ из _options.js.
function pathsFor(url) {
	let parsed;

	try {
		parsed = new URL(url);
	} catch {
		return [url];
	}

	if (parsed.hostname !== 'kinopoiskapiunofficial.tech') return [url];

	// location /api/kinopoisk/ => https://kinopoiskapiunofficial.tech/api/<остаток>
	return [`/api/kinopoisk/${parsed.pathname.replace(/^\/api\//, '')}${parsed.search}`, url];
}

export default async function apiFetch(url) {
	return netFetch(pathsFor(url), { timeoutMs: 12000, attempts: 3, headers: options.headers });
}

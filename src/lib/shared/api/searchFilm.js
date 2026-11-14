import apiFetch from './_fetch';
import { searchFallback } from './searchFallback';

let apiURI = 'https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword';

export default async function searchFilm(keyword, page = 1, opts = {}) {
	if (!keyword) return { films: [] };

	// Pустой результат вместо исключения: страница поиска показывает сообщение, а не
	// бесконечную загрузку, если API не ответил.
	const answer = await apiFetch(`${apiURI}?keyword=${encodeURIComponent(keyword)}&page=${page}`);

	if (!answer.ok || !answer.data) {
		// Резерв работает только здесь, когда Kinopoisk не ответил: пока он живой, страница
		// получает ровно тот же ответ, что и раньше. Листается резерв на первой странице —
		// у Kodik, TMDB и Shikimori постраничного ответа на текстовый поиск нет, поэтому со
		// второй страницы резерв не отвечает и страница остаётся с сообщением об отказе.
		const fallback = page == 1 ? await searchFallback(keyword, opts) : { films: [], sources: [] };

		return {
			films: fallback.films,
			failed: true,
			status: answer.status,
			reason: answer.reason,
			notes: answer.notes,
			// Чем нашли, когда сами ничего не нашли: пишет интерфейс результатов.
			sources: fallback.sources,
			// Повтор имеет смысл только при сетевой ошибке или 5xx: отказ 4xx даст то же самое.
			retry: !answer.status || answer.status >= 500
		};
	}

	return {
		...answer.data,
		films: Array.isArray(answer.data.films) ? answer.data.films : []
	};
}

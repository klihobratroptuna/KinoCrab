import apiFetch from './_fetch';

let apiURI = 'https://kinopoiskapiunofficial.tech/api/v2.2/films/';

export default async function getFilm(id) {
	if (!id) return {};

	// Ответ не похож на карточку, если API не ответил или ответил ошибкой: тогда у
	// страницы просто нет данных, но она не висит с загрузкой. Причины нет только у
	// страницы — карточка в списке показывает, что именно не удалось получить.
	const answer = await apiFetch(`${apiURI}${id}`);

	if (!answer.ok || !answer.data) {
		return {
			failed: true,
			status: answer.status,
			reason: answer.reason,
			notes: answer.notes,
			via: answer.via,
			// Повтор имеет смысл только при сетевой ошибке или 5xx: источник ответил
			// отказом (4xx) — повтор даст тот же ответ.
			retry: !answer.status || answer.status >= 500,
			id: String(id)
		};
	}

	return answer.data;
}

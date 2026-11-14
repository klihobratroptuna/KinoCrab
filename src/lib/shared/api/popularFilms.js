import apiFetch from './_fetch';

let apiURI = 'https://kinopoiskapiunofficial.tech/api/v2.2/films/collections';

// Тип подборки передаем явно. Без параметра сервер берёт свой вариант по умолчанию
// (TOP_POPULAR_ALL), но его имя — часть списка значений API: любое другое значение
// даёт 400 «Failed to convert value ... CollectionType», и страница показывала ошибку.
// Поэтому здесь только значение из списка API, а не похожее название.
const TYPE = 'TOP_POPULAR_ALL';

export default async function popularFilms(page = 1) {
	const answer = await apiFetch(`${apiURI}?type=${TYPE}&page=${page}`);

	if (!answer.ok || !answer.data) {
		return {
			items: [],
			failed: true,
			status: answer.status,
			reason: answer.reason,
			notes: answer.notes,
			retry: !answer.status || answer.status >= 500
		};
	}

	return {
		...answer.data,
		items: Array.isArray(answer.data.items) ? answer.data.items : []
	};
}

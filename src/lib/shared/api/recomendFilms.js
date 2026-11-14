import apiFetch from './_fetch';

const urlAPI = 'https://kinopoiskapiunofficial.tech/api/v2.2/films';

// REMAKE и SPOOFED раньше не проходили, хотя именно они (ремейки и пародии)
// описаны в анонсе endpoint. Упоминания (REFERENCES / REFERENCES_IN / EDITED_INTO)
// остаются за бортом: это список, где тайтл просто мелькнул, а не связанная работа.
// У пародий два направления: SPOOFED (этот тайтл пародируют) и SPOOFS (этот тайтл
// пародирует сам). Раньше пропускалось только одно, поэтому половина терялась.
// У спин-оффов тоже два направления: SPIN_OFF (спин-офф этого тайтла) и SPUN_OFF_FROM
// (этот тайтл сам вышел из другого). Замер 2026-11-10 по 22 тайтлам: SPUN_OFF_FROM
// попал у «Возвращение в рай» (1 шт.), и раньше он не проходил.
const allowedRelations = ['SIMILAR', 'SEQUEL', 'PREQUEL', 'VERSION', 'SPIN_OFF', 'SPUN_OFF_FROM', 'REMAKE', 'SPOOFED', 'SPOOFS'];

/**
 * Get linked and similar films by id
 * @param {number} id
 * @returns {Promise<{ items: Array, failed: boolean, status: number, reason: string, notes: Array, retry: boolean }>}
 */
export default async function recomendFilms(id) {
	if (!id) return { items: [], failed: false, status: 0, reason: '', notes: [], retry: false };

	// Без ограничения по времени этот запрос висел бесконечно, и блок связанных фильмов
	// показывал только загрузку. Ошибку ответа тоже не пускаем дальше: список обязан
	// показаться пустым, а не вращаться.
	const answer = await apiFetch(`${urlAPI}/${id}/relations`);
	const items = Array.isArray(answer.data?.items) ? answer.data.items : [];

	const result = items
		.filter((movie) => allowedRelations.includes(movie.relationType))
		.reduce(
			(acc, movie) => {
				const filmId = movie.kinopoiskId;
				if (!acc.seen.has(filmId)) {
					acc.seen.add(filmId);
					acc.result.push(movie);
				}
				return acc;
			},
			{ seen: new Set(), result: [] }
		).result;

	return {
		items: result,
		failed: !answer.ok,
		status: answer.status,
		reason: answer.reason,
		notes: answer.notes,
		retry: !answer.status || answer.status >= 500
	};
}

// Резервный поиск по имени в календарях — dorama_releases и anime_releases.
//
// Почему нужен нормализованный ключ, а не LIKE по title: PocketBase строит фильтр
// `title~"..."` как LIKE '%значение%', и индекс для такого запроса не используется.
// В коллекциях есть поле nameKey — то же имя в виде сравнения (регистр, пунктуация), и
// запрос с точным равенством `nameKey="значение"` попадает в индекс
// dorama_releases_name_key_idx / anime_releases_name_key_idx. Индексы создают миграции
// pb_migrations/1793300700 (дорамы) и pb_migrations/1793440300 (аниме), раньше индексы
// были только на doramatvId / shikimoriId и date. Проверяли живым запросом: по точному
// равенству поле есть, индекс работает.
//
// Порядок: сначала точное равенство по nameKey, и только если там пусто — обычный LIKE по
// title. Так запасной путь ничего не меняет: он добавляет индекс и остаётся совместимым
// с записями, где nameKey ещё не заполнен.
//
// Замер на живых данных (2026-10-31): в dorama_releases 117 записей, у всех 117 ключ
// заполнен (заполнял шаг --fill-name-key скрапера дорам). Карточки карусели называют тайтлы
// с суффиксом сезона («Баларао 1 Сезон (2026)»), поэтому сравниваем нормализованное имя
// целиком и короткое имя отдельно. Живая проверка точного запроса: nameKey="дом удобрений"
// -> 1 запись.

import pb from '$lib/shared/pocketbase';

// Нормализация имени — в $lib/shared/nameKey.js: файл без импорта PocketBase, чтобы его
// мог импортировать scratch-проверка на живых данных. Здесь импортируем и переэкспортируем
// одновременно: просто переэкспорт не создаёт локальные имена, а они нужны функциям ниже,
// и в браузере это дало ReferenceError: nameKeyOf is not defined (проверено 2026-11-05 —
// выборка аниме тогда падала в запасную ветку Kodik-списка).
import { nameKeyOf, shortNameOf } from './nameKey.js';

export { nameKeyOf, shortNameOf };

function filterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

/**
 * Запись календаря по имени: точное совпадение по nameKey (работает индекс), при пустом
 * результате — LIKE по title. Возвращает запись или null.
 *
 * В anime_releases на один тайтл приходится несколько записей (по одной на день серии),
 * поэтому там сортировка по date: берём самую свежую. Поле date проиндексировано,
 * сортировка по нему работает; сортировку по created PocketBase 0.40 не принимает —
 * индекса на это поле нет.
 */
export async function recordByName(collection, fullTitle, shortTitle) {
	const full = nameKeyOf(fullTitle);
	const short = shortTitle ? nameKeyOf(shortTitle) : shortNameOf(fullTitle);

	if (!full && !short) return null;

	const list = pb.collection(collection);
	const sort = collection === 'anime_releases' ? '-date' : '';

	for (const key of [full, short].filter(Boolean)) {
		// Точное равенство: фильтр по индексируемому полю, без LIKE.
		const hits = await list
			.getFullList({ filter: `nameKey = "${filterValue(key)}"`, sort, perPage: 5 })
			.catch(() => []);

		const hit = hits.find((record) => nameKeyOf(record.title) === key);

		if (hit) return hit;
	}

	// Запасной путь для записей без nameKey: LIKE по title, как раньше.
	if (short) {
		const hits = await list
			.getFullList({ filter: `title~"${filterValue(short)}"`, sort, perPage: 5 })
			.catch(() => []);

		const hit =
			hits.find((record) => nameKeyOf(record.title) === full) ??
			hits.find((record) => nameKeyOf(record.title) === short) ??
			null;

		if (hit) return hit;
	}

	return null;
}

/** Запись календаря дорам по названию карточки карусели. */
export function doramaRecordByName(fullTitle, shortTitle) {
	return recordByName('dorama_releases', fullTitle, shortTitle);
}

/** Запись календаря аниме по названию карточки карусели. */
export function animeRecordByName(fullTitle, shortTitle) {
	return recordByName('anime_releases', fullTitle, shortTitle);
}

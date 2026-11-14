// Кэш карточек Kinopoisk в localStorage. Записываем только то, что нужно карточке:
// название, год, тип, рейтинг, постер и описание. Запись «Смотрю» или «Буду смотреть»
// хранит только film_id, поэтому без кэша каждая карточка каждый раз ждёт ответ API;
// когда API не ответил, карточка остаётся пустой — это и видели на профиле
// (undefined вместо названия и битый постер). С кэшем карточка показывает то, что
// уже получали, а свежий ответ только уточняет данные.
//
// Что добавлено для скорости, поведение прежнее:
// 1) зеркало кэша в памяти — раньше каждая карточка заново читала и парсила весь
//    localStorage (200 записей на список из 10 карточек); теперь разбор один раз,
//    содержимое то же, что в localStorage;
// 2) группировка запросов: один и тот же film_id запрашивается один раз, независимо от
//    того, сколько карточек его показывает (одна запись может быть и в «Смотрю», и в
//    «Похожем»), и запросы идут группой — не больше MAX_CONCURRENT одновременно,
//    иначе список из двадцати карточек выстроил бы двадцать одновременных запросов;
// 3) неудачу не запоминаем: карточка по-прежнему может повторить запрос, и сообщение
//    об отсутствии данных остаётся то же.
//
// Пачкой запросы к Kinopoisk не получится: у неофициального API нет способа получить
// несколько фильмов одним запросом, есть только /api/v2.2/films/{id}. Поэтому группой
// считаем общее число одновременных обращений и общую работу для одного id.
const KEY = 'film_cache';
const MAX = 200;
const MAX_CONCURRENT = 4;

const memory = new Map();
const pending = new Map();
const waiting = [];
let running = 0;
let loaded = false;

function stored() {
	if (!loaded) {
		loaded = true;

		try {
			const data = JSON.parse(localStorage.getItem(KEY) || '{}');

			Object.entries(data).forEach(([id, film]) => memory.set(id, film));
		} catch (error) {
			console.error(error);
		}
	}

	return memory;
}

function entry(film) {
	return {
		nameRu: film.nameRu,
		nameEn: film.nameEn,
		nameOriginal: film.nameOriginal,
		year: film.year,
		type: film.type,
		rating: film.rating,
		ratingKinopoisk: film.ratingKinopoisk,
		ratingImdb: film.ratingImdb,
		posterUrlPreview: film.posterUrlPreview || film.posterUrl,
		description: film.description
	};
}

function pump() {
	if (running >= MAX_CONCURRENT) return;

	const job = waiting.shift();

	if (!job) return;

	running++;

	(async () => {
		try {
			const data = await job.fetcher(job.id);

			if (data && !data.failed) {
				// Тот же порядок, что был раньше: запоминаем только удачный ответ.
				setEntry(job.id, data);
			}

			// Неудачу из очереди убираем, чтобы карточка могла повторить запрос.
			pending.delete(job.id);
			job.resolve(data);
		} catch (error) {
			pending.delete(job.id);
			job.reject(error);
		} finally {
			running--;
			pump();
		}
	})();
}

function setEntry(id, film) {
	const data = stored();

	data.set(id, entry(film));

	if (data.size > MAX) {
		// Кэш не должен расти бесконечно: при переполнении убираем самые старые записи.
		const ids = [...data.keys()];

		ids.slice(0, ids.length - MAX).forEach((key) => data.delete(key));
	}

	try {
		localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(data)));
	} catch (error) {
		console.error(error);
	}
}

const filmCache = {
	get: (id) => {
		if (!id) return null;

		return stored().get(String(id)) || null;
	},

	set: (id, film) => {
		if (!id || !film) return;

		setEntry(String(id), film);
	},

	/**
	 * Данные для карточки: из памяти, если уже были, иначе один запрос на id.
	 * Возвращает то же, что apiGetFilm (в том числе flag failed), и тот же отказ при
	 * сетевой ошибке — карточка обрабатывает их как раньше.
	 */
	load: (id, fetcher) => {
		const key = String(id);

		if (!key) return Promise.resolve(null);

		const hit = stored().get(key);

		if (hit) return Promise.resolve(hit);

		if (pending.has(key)) return pending.get(key);

		let resolve;
		let reject;

		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});

		pending.set(key, promise);
		waiting.push({ id: key, fetcher, resolve, reject });
		pump();

		return promise;
	}
};

export default filmCache;

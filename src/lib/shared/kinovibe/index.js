// Снимок карусели kinovibe для вкладки «Дорамы» на главной. Вкладка «Фильмы» больше не
// читает kinovibe: её коллекцию наполняет Kinopoisk, и читает её $lib/shared/movieSource.js.
//
// Источник — kinovibe.cc: блок «Дорамы» (10 карточек).
// Публичного API у него нет, порядок — их собственная выборка, поэтому страницу читаем
// и сохраняем как есть, ровно так, как это делает снимок сезона AnimeGO: один проход в
// сутки, показ всегда — либо свежий снимок, либо последний сохранённый (пустая вкладка
// из-за одной неудачной попытки не появляется).
//
// Страницу читает прокси nginx (/api/kinovibe/): источник не отдаёт CORS-заголовки,
// поэтому из браузера её прочитать нельзя — проверено ответом 200 без заголовка
// access-control-allow-origin. Постеры грузим через этот же прокси: их CDN отвечает 200 и
// без нашего referer (проверено), файл на диске не появляется. Путь для картинки собирает
// src/lib/shared/doramaPoster.js, поэтому карточка получает адрес с нашего сайта.
//
// Ссылка карточки — как в карусели аниме: сначала id из записи календаря, при пустом
// ответе поиск по названию. Проверено на живых данных (2026-10-29): из 10 карточек в
// календаре была только одна («Безмолвные», doramatvId 34634), остальные девять находились
// поиском Kodik по короткому названию, и get-player по найденному id отвечал плеером.
// Без записи в календаре страница плеера раньше останавливалась на «нет записи», поэтому
// в ui.player.svelte добавлена ветка: id вида serial-... играется напрямую.
//
// Проверка нового тайтла (2026-10-31). Суточный проход ищет каждый тайтл, у которого
// ещё нет id: запись календаря, поиск Kodik по короткому названию, номер фильма в
// Kinopoisk по названию. Результат пишем в запись снимку (kinopoiskId, checkNote,
// checkDay), чтобы было видно, что проверка была. Раньше такой тайтл сразу вёл на
// страницу источника: посетитель уходил с сайта, даже когда позже Kodik узнавал тайтл.
// Теперь карточка ведёт на нашу страницу /watch по названию — там поиск происходит при
// клике, и страница пишет, что именно нашли; страница источника остаётся ссылкой на
// этой странице. Наружу карточка ведёт только когда искать нечем: нет ни id, ни названия.
// Замер на «Баларао 1 Сезон (2026)» (2026-10-31, первый день в карусели): Kodik — 0
// результатов, Shikimori — пусто, Kinopoisk — есть (filmId 14328310), Collaps 422,
// Alloha «not movie». То есть тайтл находится и получает номер, но играть его пока
// нечем — и это видно на странице, а не за пределами сайта.
// Пустые поля проверяются каждый суточный проход: Kodik и Kinopoisk узнают новые тайтлы
// со временем, и карточка сама начнёт вести на нашу играбельную страницу.

import pb from '$lib/shared/pocketbase';
import searchFilm from '$lib/shared/api/searchFilm';
import { preSearch } from '$lib/shared/preSearch';
import { kodikEmbed, kodikSearch } from '$lib/shared/kodik';
import { todayKey } from '$lib/shared/moscowDate';
import { readSnapshot } from '$lib/shared/scripts/snapshotCache';
import { doramaRecordByName, nameKeyOf } from '$lib/shared/nameIndex';
import { parseDramaCarousel, shortTitle } from './parse.js';

export const COLLECTION = 'drama_carousel';

// Отметка «проверяли, записи нет» — она не то же самое, что неответивший запрос. По пустому
// полю видно, что проверку делали; по этой отметке следующий проход её повторит, только если
// запись ещё не проверялась сегодня.
const KODIK_MISS = 'Kodik: проверяли, записи нет';

const TIMEOUT_MS = 12000;

// Сколько записей читаем за один запрос. Раньше снимок читался списком getFullList,
// где SDK 0.21.5 по умолчанию поднимает по 500 записей за запрос — то есть вся история
// дней, хотя показываем только последний день. Страницы хватает с запасом: карусель
// источника — 10 карточек дорам и 5 карточек фильмов.
const SNAPSHOT_PAGE = 60;

// Пауза между поисками Kodik: за один проход по карточке — один запрос, и по одному
// токену не стоит слать десять подряд. 400 мс — проверка на живых данных.
const PAUSE_MS = 400;

export function proxyPath() {
	// location /api/kinovibe/ в nginx.conf.template; путь с косой чертой на конце обязателен,
	// иначе location не совпадёт и запрос уйдёт в SPA-фолбэк.
	return '/api/kinovibe/';
}

/**
 * Снимок: записи в порядке их карусели. Показываем только последний день — тайтлы,
 * которые исчезли из их карусели, остаются в базе с более ранним днём и в показ не
 * попадают. Возвращает { day, cards }; day пустой, когда снимка ещё нет.
 *
 * force нужен после суточного обновления: кэш в памяти мог сохранить снимок до записи,
 * и без него карусель показала бы старый день.
 */
export async function loadSnapshot(force = false) {
	return snapshotFrom(COLLECTION, force);
}

async function snapshotFrom(collection, force = false) {
	return readSnapshot(`kinovibe:${collection}`, () => newestPage(collection), force);
}

// Один запрос вместо списка всей коллекции. Сортировка '-day, pos' (проверено живым
// запросом:PocketBase принимает вид '-day, pos', а 'day desc, pos' и 'day:desc'
// отвергает) ставит самый свежий день первыми, порядок pos внутри дня — это порядок
// карусели источника, поэтому показ получается тем же, что и при чтении всей коллекции.
async function newestPage(collection) {
	const page = await pb.collection(collection).getList(1, SNAPSHOT_PAGE, { sort: '-day, pos' });
	const items = page?.items || [];

	// При сортировке по дню вниз первый элемент и есть самый свежий день.
	const newest = items.length ? items[0].day : '';

	return {
		day: newest,
		cards: newest ? items.filter((record) => record.day == newest) : items
	};
}

// Имя в виде сравнения: то же правило, что пишет поле nameKey ($lib/shared/nameIndex.js),
// чтобы точное равенство по индексу и сравнение в коде не разошлись. Запасной путь — LIKE по
// title для записей без ключа: подробности в $lib/shared/nameIndex.js.
function normTitle(value) {
	return nameKeyOf(value);
}

async function calendarRecord(short, fullTitle) {
	return doramaRecordByName(fullTitle, short);
}

/**
 * Запись календаря по названию карточки: точное равенство по индексу nameKey, и LIKE как
 * запасной путь. Нужна странице /watch, когда id в адресе не нашло запись: карточка дорамы
 * названа «Баларао 1 Сезон (2026)», а в календаре имя без суффикса сезона, поэтому сравниваем
 * и полное имя, и короткое.
 */
export async function calendarRecordByTitle(fullTitle) {
	return calendarRecord(shortTitle(fullTitle), fullTitle);
}

async function fetchPage() {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(proxyPath(), { signal: controller.signal });

		if (!response.ok) return { ok: false, html: '', reason: `HTTP ${response.status}` };

		return { ok: true, html: await response.text(), reason: '' };
	} catch {
		return { ok: false, html: '', reason: `не ответил за ${TIMEOUT_MS / 1000} секунд` };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Один проход обновления: страница через прокси, разбор, сопоставление с календарём
 * и поиск Kodik по названию, запись снимка. Возвращает { ok, reason, added, updated } —
 * причину пишет блок, чтобы было видно, что источник не ответил и показан сохранённый
 * снимок, а не пустая вкладка.
 */
export async function refreshSnapshot() {
	const page = await fetchPage();
	const parsed = parseDramaCarousel(page.html);

	if (!parsed.length) {
		return { ok: false, reason: page.reason || 'ничего не разобрал', added: 0, updated: 0 };
	}

	const day = todayKey();
	const all = await pb.collection(COLLECTION).getFullList({ sort: 'pos' }).catch(() => []);
	const byId = new Map(all.map((record) => [record.kinovibeId, record]));

	let added = 0;
	let updated = 0;

	for (const card of parsed) {
		const record = byId.get(card.kinovibeId);
		const short = shortTitle(card.title);

		// Тайтл уже сопоставлен — второй раз к источнику не ходим. Запись календаря нужна
		 // только для ссылки: плеер сам умеет играть и по id Kodik, и по названию.
		let doramatvId = record?.doramatvId || '';
		let kodikId = record?.kodikId || '';
		let kinopoiskId = record?.kinopoiskId || '';
		let imdbId = record?.imdbId || '';
		let year = record?.year || '';
		let genre = record?.genre || '';
		let checkNote = record?.checkNote || '';
		let checkDay = record?.checkDay || '';

		if (!doramatvId && !kodikId) {
			const match = await calendarRecord(short, card.title);

			if (match) {
				doramatvId = match.doramatvId || '';
				kodikId = match.kodikId || '';
			}
		}

		// Pre-search по ID перед любым поиском по названию: один запрос v2.2 films?keyword даёт
		// номер фильма, код IMDb, год, жанр и оценку одной строкой (поля imdbId в v2.1 нет —
		// проверено 2026-10-31 на «Баларао»: kinopoiskId 14328310, imdbId null). Ответ дня
		// берётся из кэса, поэтому суточный проход ходит к API только за новыми тайтлами.
		if (!kinopoiskId) {
			await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

			const found = await preSearch(card.title);

			if (found.ok) {
				kinopoiskId = found.kinopoiskId;
				imdbId = found.imdbId;
				year = year || found.year;
				genre = genre || found.genre;
				checkNote = found.note;
			} else {
				// Пустой поиск и неответивший запрос тут различаются: во втором случае проверка
				// повторится следующим проходом, в первом — пока тайтл не появится в API.
				checkNote = found.note;
			}

			checkDay = day;
		}

		// Kodik строго по номеру фильма. Текстовый поиск по названию ошибается больше половины
		// случаев (замер 2026-10-31: «Чужая мама» без strict → чужой фильм «Чужая шуба» (1985),
		// «Идеальная работа» без strict → 5 результатов, 3 посторонние). По номеру ошибки нет:
		// search?kinopoisk_id=7791628 выдаёт ровно свою запись serial-79386, и get-player по
		// тому же номеру отвечает плеером без поиска и по публичному токену. Поэтому путь по ID
		// идёт первым, поиск по названию — только когда номера фильма нет.
		if (!kodikId && kinopoiskId && checkNote != KODIK_MISS) {
			await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

			const byId = await kodikEmbed(kinopoiskId);

			if (byId.ok) kodikId = byId.id || '';
			else if (byId.checked) checkNote = KODIK_MISS;
		}

		// Записи в календаре нет и номера фильма нет — ищем Kodik по названию: по найденному id
		// страница плеера играет без поиска. Внутри kodikSearch первый шаг — поиск по strict=1,
		// второй обычный. Поиск требует токен из .env, поэтому идёт через прокси /api/kodik/
		// (в браузере токена нет). types пустой: dorama API считает неверным типом, дорамы лежат
		// в foreign-serial и foreign-movie.
		if (!doramatvId && !kodikId && !kinopoiskId && checkNote != KODIK_MISS) {
			await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

			const found = await kodikSearch({ title: short, types: '' });

			if (found.ok) kodikId = found.id || '';
			else if (found.checked) checkNote = KODIK_MISS;
		}

		// id Kodik, который появился из текстового поиска, сверяем по имени. Раньше любое
		// совпадение принималось, и это давало чужие плееры: замер 2026-10-31 по карточкам
		// дня — «Богатое будущее 1 Сезон (2026)» хранила kodikId movie-33039 (мультфильм
		// «Мирай из будущего», 2018), «Любовь со львом 1 Сезон (2026)» — movie-62690
		// («Остров», 2022), а отметка о проверке при этом говорила, что имя не совпало.
		// Id, полученный по номеру фильма (kinopoiskId), точный: Kodik отвечает по нему
		// ровно своей записью, поэтому такой сверки не требует.
		if (kodikId && !kinopoiskId) {
			await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

			const check = await kodikSearch({ title: short, types: '' });

			if (check.ok && check.id) {
				checkNote = check.id === kodikId
					? `Kodik: id подтверждён именем (${check.note})`
					: `Kodik: id сверен по имени (${check.note})`;

				if (check.id !== kodikId) kodikId = check.id;
			} else if (check.checked) {
				kodikId = '';
				checkNote = check.note;
			}
		}

		const patch = {
			day,
			pos: card.pos,
			kinovibeId: card.kinovibeId,
			title: card.title,
			episode: card.episode,
			poster: card.poster,
			sourceUrl: card.sourceUrl,
			doramatvId,
			kodikId,
			kinopoiskId,
			imdbId,
			year,
			genre,
			checkNote,
			checkDay
		};

		try {
			if (record) {
				await pb.collection(COLLECTION).update(record.id, patch);
				updated++;
			} else {
				await pb.collection(COLLECTION).create(patch);
				added++;
			}
		} catch (error) {
			console.error(error);
		}
	}

	// Заполняем кэш в памяти тем, что только что легло в базу: блок после обновления
	// читает снимок, и без force он получил бы снимок до записи.
	await snapshotFrom(COLLECTION, true);

	return { ok: true, reason: '', added, updated };
}

/**
 * Ссылка внутри проекта: /watch по номеру фильма, иначе по id записи календаря, иначе по id
 * Kodik. Номер фильма в адресе — тот путь, который нужен: по нему Alloha и Collaps работают
 * без поиска по названию, а Kodik — через get-player, где ошибки текстового поиска нет.
 * Страница /watch находит запись календаря и по номеру фильма, так что карточка ничего не
 * теряет: id источника остаётся запасным путем.
 */
export function tileHref(card) {
	const name = card.title || '';

	if (card.kinopoiskId) {
		// Название держим в адресе: если запись календаря найдена по номеру фильма, странице
		// нечем строить заголовок, когда карточка снимка не совпала с названием.
		return `/watch?kp=${card.kinopoiskId}&type=dorama${name ? `&title=${encodeURIComponent(name)}` : ''}`;
	}

	if (card.doramatvId) {
		// Название держим в адресе: когда записи в календаре нет, странице нечем искать,
		// кроме id — по названию Kodik находит чаще.
		return `/watch?id=${card.doramatvId}&type=dorama${name ? `&title=${encodeURIComponent(name)}` : ''}`;
	}

	if (card.kodikId) {
		return `/watch?id=${card.kodikId}&type=dorama${name ? `&title=${encodeURIComponent(name)}` : ''}`;
	}

	// Ни номера, ни id нет, но название есть: ведём на нашу страницу, где проверка происходит
	// при клике и пишет, что именно нашли. Наружу карточка ведёт только когда искать нечем.
	if (name) return `/watch?title=${encodeURIComponent(name)}&type=dorama`;

	return card.sourceUrl || '';
}

/** Карточка снимка по названию — для страницы /watch, куда карусель ведёт без id записи. */
export async function carouselCardByTitle(title, force = false) {
	const snapshot = await loadSnapshot(force);
	const name = normTitle(title);

	if (!name) return null;

	return snapshot.cards.find((card) => normTitle(card.title) === name) || null;
}

// Поле названия в ответе поиска Kinopoisk — nameRu (поля name там нет), поле оценки —
// rating. Совпадение проверяем в коде, потому что поиск по длинному имени с двоеточием и
// тире выдаёт посторонние тайтлы (проверено живым запросом 2026-10-29: «Шёпот смерти:
// Саминг – зверь-оборотень» -> 0 карточек, «Чужая мама» -> чужой фильм). Поэтому
// принимаем только точное совпадение имени или короткого имени, и из совпавших выбираем
// год карточки.
async function kinopoiskMatch(fullTitle) {
	// Pre-search по ID идёт первым: один запрос v2.2 films?keyword даёт номер фильма, код IMDb,
	// год, жанр и оценку одной строкой, и ответ дня берётся из кэса — повторный проход того же
	// тайтла запроса не отправляет. Поля imdbId в ответе v2.1 search-by-keyword нет (проверено
	// живым запросом 2026-10-31 на «Баларао»), поэтому v2.2 — основной путь, а v2.1 остался
	// запасным: он работает, когда бюджет дня уже исчерпан и кэш не отвечает.
	const byName = await preSearch(fullTitle);

	if (byName.ok) {
		return {
			kinopoiskId: byName.kinopoiskId,
			imdbId: byName.imdbId,
			year: byName.year,
			rating: byName.rating,
			genre: byName.genre,
			note: byName.note
		};
	}

	const answer = await searchFilm(fullTitle);

	// searchFilm не поднимает исключение: при ошибке он возвращает films: [] и flag failed.
	if (answer.failed || !Array.isArray(answer.films)) return null;

	const short = shortTitle(fullTitle);
	const candidates = answer.films.filter(
		(film) =>
			normTitle(film.nameRu) === normTitle(fullTitle) || normTitle(film.nameRu) === normTitle(short)
	);

	if (!candidates.length) return null;

	const year = (String(fullTitle).match(/\((\d{4})\)$/) || [])[1] || '';
	const film = candidates.find((item) => String(item.year) === year) ?? candidates[0];

	// Ответ Kinopoisk отдаёт пустую оценку как строку "null" (проверено живым ответом:
	// «Плетёный муж» -> "rating":"null"), поэтому такую оценку считаем отсутствующей и
	// карточку показываем без строки оценки.
	const raw = film.rating === null || film.rating === undefined ? '' : String(film.rating);

	return {
		kinopoiskId: String(film.filmId || ''),
		rating: raw === 'null' ? '' : raw,
		// Поле genres есть и в ответе поиска (проверено живым ответом), поэтому жанр
		// берём из того же запроса — отдельного запроса к API ради жанра нет. В ответе
		// поиска элемент называется {genre: "ужасы"}, а в ответе карточки фильма — {name:
		// "ужасы"}: принимаем оба варианта. Пустые значения в массиве бывают, их не показываем.
		genre: (Array.isArray(film.genres) ? film.genres : []).map((item) => item?.name || item?.genre).filter(Boolean)[0] || ''
	};
}

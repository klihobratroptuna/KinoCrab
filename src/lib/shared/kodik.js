// Kodik не даёт статическую ссылку вида /kp/<id>: embed-адрес уникален для каждого
// фильма и приходит из API. Токен нельзя показывать в браузере, поэтому запрос идёт
// через прокси nginx (/api/kodik/), который подставляет KODIK_TOKEN из .env.
//
// Endpoint get-player принимает и личный токен, и публичный токен Kodik (тот, что
// зашит в их скрипте плееров). Публичный токен выдаёт плееры только для аниме,
// поэтому он используется как запасной вариант, когда KODIK_TOKEN пустой.

import netFetch, { netSummary } from './net';
import netCache from './netCache';

// Regex тот же, что в kodikwrapper: ищет токен в их скрипте плееров.
const TOKEN_RE = /token\s*[=:]\s*["'](?<token>[0-9a-f]+)["']/i;

let publicToken = '';
let publicTokenTried = false;

export function isKinopoiskId(id) {
	return /^\d{3,10}$/.test(String(id ?? ''));
}

// id собственной записи Kodik: serial-78775, movie-93288. Он нужен плееру: карточка
// карусели дорам ведёт на /watch по такому id, когда записи в календаре нет, и
// get-player отвечает по нему напрямую (проверено на тайтлах карусели).
export function isKodikId(id) {
	return /^[a-z]+-\d{3,12}$/.test(String(id ?? ''));
}

async function publicKodikToken(force = false) {
	// Пробуем один раз и не повторяем при каждой проверке источника: на холодном старте
	// браузер не читает чужие хосты, и без этой отметки страница каждый раз ждала бы
	// полные 10 секунд на токене. Успех запоминаем, неудачу — нет, чтобы повтор после
	// старта всё-таки мог пройти.
	if (publicToken) return publicToken;
	if (publicTokenTried && !force) return '';

	publicTokenTried = true;

	try {
		const answer = await netFetch('/api/kodik-token', { timeoutMs: 10000, attempts: 3 });
		publicToken = answer.text?.match(TOKEN_RE)?.groups?.token ?? '';
	} catch {
		publicToken = '';
	}

	return publicToken;
}

async function callKodik(path, force = false) {
	return netCache(`kodik:${path}`, () => netFetch(path, { timeoutMs: 15000, attempts: 3 }), force);
}

function normalizeLink(link) {
	if (!link) return '';
	return link.startsWith('//') ? `https:${link}` : link;
}

/**
 * get-player с подстановкой токена: сначала личный KODIK_TOKEN (его добавляет nginx),
 * при 401 — публичный токен из скрипта плееров. Общий для номера фильма и для id Shikimori.
 */
async function getPlayer(query, force = false) {
	let answer = await callKodik(`/api/kodik/get-player?${query}`, force);

	if (answer.status !== 401) return { ...answer, usedPublicToken: false };

	const token = await publicKodikToken(force);

	if (!token) return { ...answer, usedPublicToken: false, noToken: true };

	return {
		...answer,
		usedPublicToken: true,
		...(await callKodik(`/api/kodik/get-player?${query}&token=${token}`, force))
	};
}

function playerAnswer(answer, labelNotFound) {
	if (answer.noToken) {
		return {
			ok: false,
			label: 'нет токена',
			note: 'Kodik требует API-токен: добавь KODIK_TOKEN в .env'
		};
	}

	if (answer.status === 0) {
		return {
			ok: false,
			label: 'сеть',
			note: `Kodik API ${netSummary('не ответил', answer)} — сеть или прокси nginx ошибся`,
			retry: true
		};
	}

	if (answer.status !== 200) {
		return {
			ok: false,
			label: `ошибка ${answer.status}`,
			note: `Kodik API ответил ${answer.status}`
		};
	}

	const link = normalizeLink(answer.data?.link);

	if (link && answer.data?.found) {
		// id записи Kodik (вид serial-77852) нужен не только плееру: карусель сохраняет его
		// в снимок, чтобы ссылка карточки вела на /watch сразу.
		return { ok: true, label: 'ok', link, id: answer.data?.id || '', note: '' };
	}

	// checked=true тут значит, что источник ответил и запись не найдена: это не то же самое,
	// что неответивший запрос выше, и суточный проход по этой отметке источник не долбит.
	return { ok: false, label: 'не найден', checked: true, note: labelNotFound };
}

// Поиск Kodik требует токен из .env (KODIK_TOKEN). Публичный токен, который парсится из
// скрипта плееров (то же, что делает kodikwrapper.getPublicToken), отвечает только на
// get-player: на search он даёт 401 «Отсутствует или неверный токен» — это проверено
// запросом. Параметр поиска называется ровно `title`: keyword, name, q, search и query API
// отвечает 400 «Не указан хотя бы один параметр для поиска» — тоже проверено запросом.
// types — фильтр по типу материала. Для аниме это anime. Для дорам фильтр не ставим: dorama
// API считает неверным типом («Неправильный тип»), дорамы лежат в foreign-serial и
// foreign-movie. Без фильтра поиск идёт по названию по всем типам, и это работает.
// Название записи Kodik для сравнения: тот же нормализатор, что в скрапере
// scripts/scrape-doramas.mjs и в $lib/shared/nameIndex.
function normName(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

// Имя без суффикса сезона и года в скобках: у Kodik запись обычно названа коротким именем,
// а наша карточка — «Баларао 1 Сезон (2026)». Границу \b не используем: в JavaScript она
// работает только для [A-Za-z0-9_], после кириллического «сезон» её нет.
function shortName(value) {
	return normName(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Совпадение имени с записью Kodik. Возвращает пустую строку, если имена разные: текстовый
 * поиск Kodik отвечает близкими, а не одинаковыми названиями. Замер 2026-10-31:
 * search?title=Баларао 1 Сезон (2026) без strict дал 3 результата, и все три — чужая
 * корейская дорама «Остров» (2022, kp 1445076). Раньше страница играла первый результат и
 * показывала чужое произведение.
 *
 * Проверяемые поля Kodik: title, original_title (иногда answer отдаёт его как title_orig) и
 * other_title. Other_title — это список альтернативных названий через слеш, и тайтл карусели
 * часто стоит именно там: замер того же дня, «Спасительный рецепт маленького города» (kp
 * 14730352) → запись Kodik названа «Рецепт для маленького городка», а наше имя стоит в
 * other_title одним из вариантов. Значит список нужно разбирать, а не сравнивать целиком.
 */
function nameSet(item) {
	const names = [];

	for (const value of [item?.title, item?.original_title || item?.title_orig, item?.other_title]) {
		for (const part of String(value || '').split('/')) {
			const name = normName(part);

			if (name) names.push(name);
		}
	}

	return names;
}

/**
 * Совпадение имени с записью Kodik, с проверкой года.
 *
 * Короткое имя само по себе не совпадение — замер 2026-11-04 по снимку карусели «Сериалы»:
 * карточка «Великий» (The Greatest, 2026, США) получила search?title=Великий → serial-9848
 * «Наследный принц», где «Великий принц» стоит в other_title. Это чужая корейская дорама
 * 2018 года (kp 1049707): совпало одно слово, а ссылка карточки повела на неё. Замер того же
 * дня по коду IMDb карточки (tt15715850): Kodik по коду отвечает пусто, то есть правильный
 * результат для этой карточки — «плеера нет», а не чужой плеер.
 *
 * Поэтому короткое имя принимаем только когда год записи Kodik — тот же, что в карточке.
 * Год не проверяем, когда он неизвестен у одной из сторон: у Kodik бывает пустой year.
 */
function nameMatch(query, item, year = '') {
	const full = normName(query);
	const short = shortName(query);
	const names = nameSet(item);

	if (!full || !names.length) return '';

	if (names.includes(full)) return 'совпало полностью';

	if (short && names.some((name) => name === short || name.startsWith(`${short} `))) {
		if (year && item?.year && Number(item.year) != Number(year)) return '';

		return 'совпало коротким именем';
	}

	return '';
}

// Год в строке Kodik — поле year; сравниваем как число, потому что Kodik пишет его и числом,
// и строкой.
function yearMatches(item, year) {
	return !year || !item?.year || Number(item.year) == Number(year);
}

export async function kodikSearch(params, force = false) {
	// Год входит в ключ кэса: поиск по одному и тому же имени для карточек разных лет отвечает
	// по-разному, и общий ключ на два года дал бы одну и ту же запись обеим.
	const key = `search:${params.types || 'all'}:${params.year || 'без года'}:${params.shikimoriId || params.imdbId || params.title}`;

	return netCache(key, () => searchOnce(params, force), force);
}

async function searchOnce({ shikimoriId, imdbId, title, types = 'anime', year = '' }, force) {
	// Ищем по одному критерию за раз. Kodik применяет каждый переданный параметр как
	// общий фильтр, то есть id Shikimori и название — это условие «и»: запись, которая
	// нашлась по id, исчезает, если название у Kodik написано иначе, чем на плитке
	// («Ледяная стена 2» против «Ледяная стена 2 сезон»). Поэтому сначала спрашиваем
	// строго по id, и только если ответа нет — строго по названию.
	//
	// Строгий поиск по номеру точнее текстового. Замер живыми запросами 2026-10-31:
	// search?kinopoisk_id=7791628 выдаёт ровно свою запись serial-79386, а поиск по
	// названию «Идеальная работа» без strict дал 5 результатов, где 3 посторонние.
	// Поэтому для названия сначала пробуем strict=1, и только при пустом ответе — обычный
	// поиск: strict может отбросить запись, у Kodik название которого написано иначе
	// (перевод). Замер того же дня: «Чужая мама» без strict → первым «Чужая шуба» (1985),
	// по strict → «Чужая» (1978); «Баларао» → 0 результатов обоими способами, а полным
	// именем карточки «Баларао 1 Сезон (2026)» → strict 0, без strict 3 результата, и все
	// три — чужая дорама «Остров». Поэтому имя проверяем, а не берём первое.
	// По номеру фильма такой ошибки нет, поэтому страницы сначала спрашивают preSearch,
	// и сюда попадают только тайтлы, где номера нет.
	const attempts = [];
	const offered = [];

	// Ответ поиска по критерию: id записи Kodik (вид serial-77852) нужен не только плееру —
	// карусель дорам сохраняет его в снимок, чтобы ссылка карточки вела на /watch сразу.
	// Имена и номера из строки читает ещё и резерв текстового поиска
	// (src/lib/shared/api/searchFallback.js): по ним карточка знает, чем открыть тайтл, какой
	// у него номер Kinopoisk и какие записи под этим именем Kodik предложил. Поля добавили
	// 2026-11-09, существующие потребители читают по-прежнему только ok, id, link и note.
	// matches — все строки, совпавшие по имени: первое result Kodik даёт чужое
	// («Во все тяжкие» → «Во мраке»), поэтому одна строка ответа тут не отвечает.
	const ok = (item, via, what, matches = [item]) => ({
		ok: true,
		label: 'ok',
		id: item.id,
		link: normalizeLink(item.link),
		name: item.title || item.other_title || '',
		type: item.types || '',
		year: String(item.year || ''),
		numbers: {
			kinopoiskId: String(item.kinopoisk_id || ''),
			imdbId: String(item.imdb_id || ''),
			shikimoriId: String(item.shikimori_id || ''),
			mdlId: String(item.mdl_id || '')
		},
		// Нормализуем и строки-совпадения: потребителю нужны те же поля у каждой, иначе
		// первая строка ответа будет описана одним набором, а остальные — другим.
		matches: matches.map((match) => ({
			id: match.id,
			link: normalizeLink(match.link),
			name: match.name || match.title || match.other_title || '',
			type: match.types || '',
			year: String(match.year || ''),
			numbers: {
				kinopoiskId: String(match.kinopoisk_id || ''),
				imdbId: String(match.imdb_id || ''),
				shikimoriId: String(match.shikimori_id || ''),
				mdlId: String(match.mdl_id || '')
			}
		})),
		note: `Kodik нашёл по ${via}, ${what}`
	});

	if (shikimoriId) {
		attempts.push({ param: 'shikimori_id', value: String(shikimoriId), via: 'id Shikimori' });
	}

	// Код IMDb (вид tt20597468) — отдельный параметр поиска, тоже точный: проверено живым
	// запросом 2026-10-31, ответ по imdb_id выдаёт ровно свою запись. Он нужен тайтлам, у
	// которых номера фильма в Kinopoisk нет, но код IMDb есть.
	if (imdbId) {
		attempts.push({ param: 'imdb_id', value: String(imdbId), via: 'коду IMDb', strict: true });
	}

	if (title) {
		attempts.push({ param: 'title', value: String(title), via: 'названию по strict', strict: true });
		attempts.push({ param: 'title', value: String(title), via: 'названию без strict' });
	}

	for (const attempt of attempts) {
		const query = new URLSearchParams({ limit: '3' });

		if (types) query.set('types', types);

		query.set(attempt.param, attempt.value);

		if (attempt.strict) query.set('strict', '1');

		const answer = await callKodik(`/api/kodik/search?${query}`, force);

		if (answer.status === 401) {
			return {
				ok: false,
				label: 'нет токена',
				note: 'Kodik ищет только по личному токену: публичный токен из скрипта плееров отвечает на search 401. Добавь KODIK_TOKEN в .env'
			};
		}

		if (answer.status === 0) {
			return {
				ok: false,
				label: 'сеть',
				note: `Kodik API ${netSummary('не ответил', answer)} — сеть или прокси nginx ошибся`,
				retry: true
			};
		}

		if (answer.status !== 200) {
			return {
				ok: false,
				label: `ошибка ${answer.status}`,
				note: `Kodik API ответил ${answer.status}`
			};
		}

		const results = answer.data?.results ?? [];

		// Пустой ответ по этому критерию — не повод останавливаться: если id ничего не
		// дал, у Kodik ещё есть шанс найти запись по названию.
		if (!results.length) {
			continue;
		}

		if (attempt.param === 'title') {
			const found = results.filter((item) => nameMatch(attempt.value, item, year));

			if (found.length) {
				return ok(
					found[0],
					attempt.via,
					`${nameMatch(attempt.value, found[0], year)}${year ? `, год ${found[0].year || 'неизвестен'}` : ''}: ${found[0].title || found[0].other_title || 'без названия'}`,
					found
				);
			}

			// Совпадение по короткому имени, отбракованное годом — это чужой тайтл, и писать
			// о нём нужно отдельно: иначе отметка выглядела бы как «имени нет вовсе», а Kodik
			// запись предложил, просто того же слова у другой картины другой год.
			const byShort = results.find((item) => nameMatch(attempt.value, item) && !yearMatches(item, year));

			if (byShort) {
				offered.push(
					`по ${attempt.via} предложил «${byShort.title || byShort.other_title || 'без названия'}» (${byShort.year || 'год неизвестен'}, kp ${byShort.kinopoisk_id || 'нет'}) — совпало коротким именем, а год ${byShort.year || 'неизвестен'} против ${year} в карточке`
				);

				continue;
			}

			// Единственный результат без совпадения имени не принимаем: замер 2026-10-31 по
			// живому дню карусели показал, как это заканчивается. Карточка «Богатое будущее
			// 1 Сезон (2026)» получила kodikId movie-33039 — это мультфильм «Мирай из
			// будущего» (2018), «Любовь со львом 1 Сезон (2026)» — movie-62690, он же
			// «Остров» (2022). Оба пришли одиночным результатом близкого поиска. Теперь
			// пишем, что именно предложил Kodik, и ничего не играем.

			offered.push(
				`по ${attempt.via} предложил «${results[0].title || 'без названия'}» (${results[0].year || 'год неизвестен'}, kp ${results[0].kinopoisk_id || 'нет'}) — другая запись`
			);

			continue;
		}

		// Поиск по номеру Kodik применяет как точный фильтр, но и здесь проверяем ответ:
		// принимаем запись, у которой поле ответа — тот же номер, что спрашивали. Замер
		// 2026-10-31: kinopoisk_id=14730352 → 3 записи kp 14730352; shikimori_id=61990 →
		// 3 записи shikimori_id 61990. Чужую запись по номеру Kodik не выдаёт, поэтому
		// проверка нужна только для текстового поиска ниже.
		const exact = results.find((item) => String(item[attempt.param] || '') === attempt.value);

		if (exact) {
			return ok(exact, attempt.via, `номер совпал: ${exact.title || 'без названия'}`);
		}

		offered.push(
			`по ${attempt.via} ответил «${results[0].title || 'без названия'}» с ${attempt.param}=${results[0][attempt.param] || 'нет'} — это чужой номер`
		);

		continue;
	}

	// Ни по одному критерию ответа нет — пишем, по чему именно спрашивали. checked=true
	// значит, что проверка была и ответ был пустым: это не то же самое, что неответивший
	// запрос, и по этой отметке суточный проход не долбит источник повторно.
	const searched = attempts.map((attempt) => `по ${attempt.via}`);

	return {
		ok: false,
		label: 'не найден',
		checked: true,
		note:
			(searched.length > 1
				? `Kodik не нашёл материал ни ${searched.join(', ни ')}`
				: `Kodik не нашёл материал ${searched[0]}`) +
			(offered.length ? `; ${offered.join('; ')}` : '')
	};
}

export async function kodikEmbed(kinopoiskId, force = false) {
	if (!isKinopoiskId(kinopoiskId)) {
		return { ok: false, label: 'bad id', note: 'id в адресе не похож на номер фильма в Kinopoisk' };
	}

	return netCache(`kodik:${kinopoiskId}`, () => playerOnce(kinopoiskId, force), force);
}

async function playerOnce(kinopoiskId, force) {
	// 401 — это значит, что KODIK_TOKEN в .env пустой: getPlayer пробует публичный токен.
	const answer = await getPlayer(`kinopoiskID=${encodeURIComponent(kinopoiskId)}`, force);

	return playerAnswer(
		answer,
		answer.usedPublicToken
			? 'Kodik не нашёл плеер: публичный токен Kodik отвечает только по аниме. Для фильмов нужен личный токен kodikapi.com'
			: 'Kodik не нашёл плеер для этого фильма'
	);
}

// Плеер по id записи в открытой базе Shikimori. Метод get-player отвечает и по
// публичному токену из скрипта плееров — это проверено запросом (Shikimori-запись
// 57192 → плеер Kodik), поэтому дорама играется без личного KODIK_TOKEN. Тот же путь
// первый и для аниме: поиск для него не нужен. Личный токен нужен только методу search,
// который отвечает 401.
export async function kodikPlayerByShikimoriId(shikimoriId, force = false) {
	return netCache(
		`shikimori:${shikimoriId}`,
		async () =>
			playerAnswer(
				await getPlayer(`shikimori_id=${encodeURIComponent(shikimoriId)}`, force),
				'Kodik не нашёл плеер по id Shikimori: в его базе такой записи нет'
			),
		force
	);
}

// Плеер по id записи Kodik (вид serial-77852). Это путь для дорам, которых нет в базе
// Shikimori: скрапер scripts/scrape-doramas.mjs --fill-kodik находит дораму по названию и
// пишет этот id в календарь, а странице достаточно одного запроса get-player?id=... — поиск
// не нужен. Метод отвечает и по публичному токену плеера (проверено запросом:
// id serial-77852 -> found=true), поэтому дорама играется даже без KODIK_TOKEN.
export async function kodikPlayerByKodikId(kodikId, force = false) {
	return netCache(
		`kodikid:${kodikId}`,
		async () =>
			playerAnswer(
				await getPlayer(`id=${encodeURIComponent(kodikId)}`, force),
				'Kodik не нашёл плеер: id записи есть в календаре, но get-player по нему отвечает found=false'
			),
		force
	);
}

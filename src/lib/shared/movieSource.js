// Фильмы: снимок карусели. Наполняет его фоновый проход (scripts/scrape-movies.mjs),
// страница читает готовый список из PocketBase.
//
// Почему проход, а не страница. До 2026-11-06 каждое открытие вкладки «Фильмы» обращалось к
// источнику, и правило-гейт («в ленте только тайтлы, найденные нашими плеерами») требовало
// проверки каждого кандидата. Замер 2026-11-06: чтение готового снимка — 5 мс, один проход
// пула (~150 кандидатов) — около трёх минут сетевых ответов. Посетитель не должен ждать
// эти минуты, и повторное открытие страницы не должно повторно расходовать квоту источников.
//
// Пул (решение пользователя от 2026-11-06 — лента только из текущих новинок): TMDB movie/popular
// страницы 1–3, но строки года прохода, плюс окно премьер с 1 января этого года по сегодня.
// Дополнение старыми годами (2018–2024), которое было тем же решением, убрано: по замеру оно
// наполняло ленту тайтлами 2024, 2023 и 2019 года, то есть не новинками. Замер: фильтры discover
// работают, sort игнорируется (порядок всегда popularity desc), строка search/discover не несёт
// imdb_id, русские имена приходят с language=ru. Поэтому имена берутся из TMDB, а порядок ленты
// считается здесь.
//
// Gate: строка Kodik, где found и allowed. Замер 2026-11-06: строка search поля allowed не
// отдаёт (в ней id, type, title, quality, camrip, created_at), поэтому проверка — два запроса:
// search находит запись, get-player подтверждает, что её можно играть (там же quality и link;
// camrip и created_at есть только в search). types для фильма — foreign-movie: замер
// 2026-11-06, types=movie ответил 400 «Неправильный тип». Публичный токен Kodik отвечает на
// search 401, поэтому проход работает с KODIK_TOKEN, который подставляет nginx.
//
// Матчинг — по имени и году. Строка TMDB не несёт imdb_id, а /movie/{id} на каждый тайтл — это
// 100–150 запросов в сутки. Замер 2026-11-06: поиск Kodik работает по словам, а не по точному
// имени («Тёмный рыцарь» → «Рыцарь теней» и «Шанхайский рыцарь», limit=20, самого тайтла в
// выдаче нет), поэтому совпадение проверяется по ключу имени и году, и ничего не берётся
// «первым результатом». Год проверяем и при полном совпадении имени: по замеру того же дня
// карточка «Курьер» (2026) иначе получила бы чужой «Курьер» (2008). По замеру покрытия гейт
// пропускает мало: из 49 проверенных кандидатов прошли 2. Это следствие гейта, а не ошибка —
// лента короткая и наполняется по мере появления рипов.
//
// Проверка того же дня, что короткий список — не вина матчинга: окно 2026, страница 1 (20 имён) —
// прошёл 1 тайтл, у 4 Kodik пуст, 11 совпадений дали другой год (это другие картины с тем же
// словом), 5 строк с чужими именами. Контроль по коду IMDb на те 12 имён, где имя не совпало:
// Kodik ответил пустым списком на все 12 — этих премьер у плеера нет. Код IMDb здесь не помогающий
// путь, а проверка: он требует отдельный запрос external_ids на каждый тайтл, то есть 100–150
// запросов в сутки, и имя остаётся основным ключом.

import pb from '$lib/shared/pocketbase';
import { todayKey } from '$lib/shared/moscowDate';
import { readSnapshot } from '$lib/shared/scripts/snapshotCache';
import netFetch, { netSummary } from '$lib/shared/net';
import netCache from '$lib/shared/netCache';
import { nameKeyOf, shortNameOf } from '$lib/shared/nameKey';
import { allohaEmbed } from '$lib/shared/alloha';

export const MOVIE_COLLECTION = 'movie_carousel';

// Предел ленты — 20 карточек (решение пользователя 2026-11-06 вечер: наполнение до 20 тайтлов
// текущего года). Это предел, а не фактическая длина: гейт пропускает только тайтлы с нашим
// плеером. Замер окна 2026 по 60 именам тем же путём, что в проходе (три страницы): прошли гейт
// 2 тайтла, у 12 Kodik ответил пусто, 20 строк дали чужие имена, 26 совпадений имени оказались
// другими картинами по году. Спорный год проверен отдельно: original_title совпал только в одном
// случае, и по коду IMDb это тоже другая картина. Значит короткая лента — не ошибка матчинга, а
// отсутствие рипов: при coverage 2/60 (3%) двадцать карточек требуют около 600 проверенных имён,
// и лента растёт по мере появления рипов, а не ослаблением гейта.
const TOP = 20;

// Сколько записей читаем за один запрос — как в карусели дорам: только последний день.
const SNAPSHOT_PAGE = 60;

// Пул: страницы popular 1–3 и окно премьер текущего года. Окно читаем двадцатью пятью страницами
// по 20 имён — это около 500 кандидатов в день, и именно так наполняется лента до 20 карточек.
// Замер 2026-11-06 вечер по покрытию: страницы 1–3 (60 имён) — 2 карточки, 4–6 (60 имён) — 3,
// 7–10 (80 имён) — 2. Итого 200 имён дали 7 карточек, coverage около 3.5%: чтобы набрать 20
// карточек, нужно проверить около 550 имён, а не ослабить гейт. Kodik перечислить свой каталог не
// даёт: пустой запрос и запрос только по году отвечают 400, endpoint recent через прокси — 404,
// запрос по translation_id + year — 400. Поэтому candidates идут из TMDB, а плеер проверяется по
// имени, и лента растёт по мере появления рипов.
const POOL_PAGES = [1, 2, 3];
const WINDOW_PAGES = Array.from({ length: 25 }, (_, index) => index + 1);

// Предпочтение по стране производства (решение пользователя 2026-11-06 вечер): в начало ленты
// карточки производства США, если их не хватает — популярные новинки других стран, и внутри
// группы порядок по свежести релиза. Замер того же вечера, окно 2026 с фильтром
// with_origin_country=US (20 имён первой страницы): Kodik по имени не нашёл ни одного тайтла,
// Alloha по коду IMDb нашёл 19 из 20. Без фильтра по стране лента вышла совсем без американских
// карточек — по составу дня: TH 2, KR 5, ID 2, AU 3, ES 1, IN 4, TR 1, JP 1, CN 1.
//
// Фильтр with_origin_country работает (замер: страницы с KR дают корейские строки), но самое поле
// origin_country прокси в строке search/discover не отдаёт, поэтому страну берём запросом
// /movie/{id}. Для кандидатов, пришедших из страницы с фильтром по стране, страна известна из
// самого запроса и пишется в карточку без дополнительного обращения.
const PREFERRED_COUNTRY = 'US';
const US_WINDOW_PAGES = Array.from({ length: 10 }, (_, index) => index + 1);

// Строка TMDB через прокси не несёт ни origin_country, ни imdb_id (замер 2026-11-06 вечер, keys
// строки search/discover: adult, backdrop_path, genre_ids, id, title, original_language,
// original_title, overview, popularity, poster_path, release_date, softcore, video, vote_average,
// vote_count). Их берёт один запрос /movie/{id}: он отдаёт и страну, и код IMDb. Он же нужен
// ветке Alloha, потому что Alloha проверяет материал только по номеру. Лимит — 400 запросов в
// сутки, их тратим на кандидатов в порядке предпочтения (сначала имена США), ответы дня лежат в
// netCache, и тайтл не запрашивается дважды в один день.
//
// Почему подняли с 220: замер 2026-11-06 вечер, проход проверил 500 кандидатов, и у 221-го и
// далее бюджет был исчерпан — эти тайтлы не доходили до ветки Alloha и записывались как «нет
// плеера», хотя материал у Alloha есть (например «Человек-паук: Новый день»). Проверка лимита:
// 40 и 60 обращений подряд через прокси — ни одного ответа 429 (из 60: 26 HIT, 34 MISS).
const MAX_DETAILS = 400;

// Типы Kodik для фильма. Русские картины раньше не проверялись: types был один foreign-movie,
// а запись русской премьеры лежит в russian-movie. Замер 2026-11-06 вечер: тот же запрос по
// имени с types=foreign-movie,russian-movie отвечает списком обоих типов, то есть список через
// запятую работает, и пустая выдача по foreign-movie перестала быть пропуском для русской картины.
export const KODIK_TYPE = 'foreign-movie,russian-movie';

// Окно считается по году прохода, а не по постоянной дате. Решение пользователя 2026-11-06: лента
// строится только из текущих новинок. До этого окно открывалось 2025-01-01, и в ленту попадали
// тайтлы прошлого года, плюс отдельное дополнение 2018–2024. Замер того же дня (окно 2026,
// страница 1 — 20 имён): гейтом прошёл 1 тайтл, у 4 Kodik пусто, 11 совпадений имени дали другой
// год (это другие картины, не наша), 5 строк с чужими именами. Контроль по коду IMDb на 12 имён,
// где поиск по имени не совпал: Kodik ответил пустым списком на все 12 — то есть этих премьер у
// плеера просто нет, и короткий список здесь следствие гейта, а не ошибки матчинга.
//
// Поэтому правило так и оставили: лента короткая и растёт по мере появления рипов. Дополнение
// старыми годами (FILL_*) убрано по решению пользователя — оно наполняло ленту тайтлами 2024,
// 2023 и 2019 года, что противоречит «только текущие новинки».
function windowYear(day) {
	return Number(String(day || todayKey()).slice(0, 4)) || new Date().getFullYear();
}

// Пороги зрительского качества (те же числа, что в правилах «Сериалов»).
const QUALITY_MIN_RATING = 6.0;
const QUALITY_MIN_VOTES = 50;
const QUALITY_MIN_VOTES_FRESH = 10;

// Проверка кандидата — не чаще одного раза в сутки (по checkDay). Замер 2026-11-06: ~150
// кандидатов в день, при паузе 700 мс проход занимает около трёх минут. С дополнением пула
// (20 имён старше окна) — до 170 кандидатов, и у каждого совпадения добавляется второй запрос
// get-player ради allowed, поэтому лимит подняли до 170: проход занимает около четырёх минут.
// Вечером того же дня пул стал окном в двадцать пять страниц (около 500 имён): лимит 550, проход
// занимает около шести минут при паузе 700 мс и укладывается в интервал 30 минут. Карточки,
// попавшие в ленту, на следующий день переносятся и перепроверяются, поэтому наполнение
// накапливается: имена, где плеера нет, остаются в базе с checkDay и проверяются раз в сутки.
const MAX_CHECKS = 550;
const KODIK_DELAY_MS = 700;

/**
 * Снимок: записи в порядке карусели, только последний день и только прошедшие гейт.
 * Возвращает { day, cards }; day пустой, когда снимка ещё нет.
 */
export async function loadMovieSnapshot(force = false) {
	return readSnapshot(`movieSource:${MOVIE_COLLECTION}`, () => newestPage(), force);
}

// Один запрос вместо всей коллекции. Сортировка '-day, pos' (проверено живым запросом).
// Записи без плеера (playerVia пустое) не показываются: это и есть гейт — тайтла без
// плеера в ленте нет, и «нет строки» означает «нет карточки», а не «карточка без плеера».
// Pos 0 — строка, которая в ленту прохода не попала (держит checkDay) или строка прежнего
// прохода того же дня: карточкой она не становится, потому что порядок ленты — это pos 1…TOP,
// которые пишет проход.
async function newestPage() {
	const page = await pb.collection(MOVIE_COLLECTION).getList(1, SNAPSHOT_PAGE, { sort: '-day, pos' });
	const items = (page?.items || []).filter((record) => record.playerVia && Number(record.pos) > 0);
	const newest = items.length ? items[0].day : '';

	return {
		day: newest,
		cards: (newest ? items.filter((record) => record.day == newest) : items).slice(0, TOP)
	};
}

/**
 * Ссылка внутри проекта: страница плеера. После гейта 2026-11-07 у каждой карточки ленты есть
 * числовой ключ Kinopoisk, поэтому ссылка у всех карточек одна — /watch?kp=<номер>. Страница по
 * номеру показывает заголовок, постер и оценку (Kinopoisk отвечает), и список работает по тому же
 * числовому ключу.
 *
 * Ветка ?id=<id Kodik> осталась только для строк прежнего прохода без ключа: по строковому id
 * список не работает (поле film_id числовое), и карточка без ключа не могла попасть в «Смотрю».
 * Ветку по коду IMDb убрали — карточка с кодом без номера в ленту больше не попадает, а страница по
 * строке tt... показывала только плеер (замер 2026-11-07: api/film/tt13884466 → 400).
 */
export function movieTileHref(card) {
	const name = card.title || '';
	const key = numericKey(card.kinopoiskId);

	if (key) {
		return `/watch?kp=${key}${name ? `&title=${encodeURIComponent(name)}` : ''}`;
	}

	if (card.kodikId) {
		return `/watch?id=${card.kodikId}${name ? `&title=${encodeURIComponent(name)}` : ''}`;
	}

	return card.sourceUrl || '';
}

// — — — — — — — — — — — — — — — — — — — — правила отбора — — — — — — — — — — — — — — — — — —

/** Строка TMDB (popular, окно года или дополнение старше окна) в кандидата ленты. */
function candidateFrom(row, inWindow, source = 'popular', knownCountry = '') {
	const title = row.title || row.original_title || '';
	const year = Number(String(row.release_date || '').slice(0, 4) || 0);
	const poster = row.poster_path ? `https://image.tmdb.org/t/p/w500${row.poster_path}` : '';

	return {
		nameKey: nameKeyOf(title),
		title,
		titleOrig: row.original_title || '',
		year,
		rating: Number.isFinite(Number(row.vote_average)) ? Number(row.vote_average) : null,
		votes: Number(row.vote_count) || 0,
		genreIds: Array.isArray(row.genre_ids) ? row.genre_ids : [],
		poster,
		tmdbId: String(row.id || ''),
		inWindow,
		// Страна — кодом (US, KR, TH). Её даёт либо запрос пула с фильтром with_origin_country,
		// либо ответ /movie/{id}, который делает ветка Alloha. Поле в базе — country.
		country: (Array.isArray(row.origin_country) ? row.origin_country : []).map((item) => String(item || '').trim()).filter(Boolean)[0] || knownCountry,
		// Полная дата релиза, не только год: по ней порядок ленты сравнивает свежесть, и две
		// карточки одного года иначе встали бы в произвольном порядке.
		releaseDate: String(row.release_date || '').slice(0, 10),
		// Откуда пришло имя: popular (страницы popular) и window (окно премьер текущего года). По
		// этому полю порядок ленты различает топ popular и свежие премьеры; в базу его не пишем —
		// порядок считается в проходе, а страница читает pos. Дополнение старыми годами убрано
		// 2026-11-06, поэтому source теперь только эти два значения.
		source,
		// TMDB не даёт imdb_id (замер 2026-11-06), поэтому имя — основной ключ.
		imdbId: row.external_ids?.imdb_id || ''
	};
}

// Числовой ключ карточки — номер в Kinopoisk. Поле film_id в списке профиля числовое, поэтому
// тайтл без номера сохранить в «Смотрю»/«Буду смотреть» нельзя. Плюс страница плеера без номера
// показывает только плеер: заголовок, постер и оценка берутся из ответа Kinopoisk, а по строке
// tt... он не отвечает (замер 2026-11-07: api/film/tt13884466 → 400 «No static resource»,
// films?imdbId=tt13884466 → total 0, такой записи в Kinopoisk нет). Поэтому карточка ленты обязана
// иметь числовой ключ: без ключа она не карточка, а строка проверки. Замер того же дня по ленте:
// 20 карточек, 18 с числовым ключом и 2 без (Образцовый гражданин, Стрим из ада — Alloha нашёл
// материал по коду IMDb, id_kp пустой).
function numericKey(value) {
	const key = String(value || '');

	return /^\d+$/.test(key) ? key : '';
}

// Ключ, по которому проход узнаёт карточку: сначала числовой номер Kinopoisk, потом имя. Имя само по
// себе ненадёжно: один и тот же фильм приходит из TMDB как «Идеальное Рождество для собаки», а из
// Alloha как «Идеальное собачье Рождество», и по имени проход видит два разных тайтла. Замер
// 2026-11-07: в ленте 16 дублей, строки в каждой паре полностью одинаковые — вторая строка появилась
// потому, что проход не нашёл первую по имени и создал новую. Номер один у фильма всегда, поэтому
// по нему дубль невозможен.
function dedupeKeyOf(value) {
	const number = numericKey(value?.kinopoiskId);

	return number || value?.nameKey || nameKeyOf(value?.title);
}

// Зрительский тир: 1 — оценка и голосов достаточно, 2 — премьера внутри окна при 10 голосах,
// 0 — кандидата в ленте нет. Пороги взяты из правила «Сериалов» от 2026-11-05; без поля голосов
// оценка 4.5 из трёх голосов прошла бы ленту. Для переноса карточки значения берутся из
// сохранённой строки. Окно — год прохода (решение 2026-11-06: только текущие новинки).
function viewerTier(candidate, record = null, windowY = windowYear()) {
	const rating = Number(candidate.rating ?? record?.rating);
	const votes = Number(candidate.votes ?? record?.ratingCount) || 0;
	const year = Number(candidate.year ?? record?.year) || 0;
	const inWindow = candidate.inWindow || year >= windowY;

	if (!Number.isFinite(rating)) return 0;

	if (rating >= QUALITY_MIN_RATING && votes >= QUALITY_MIN_VOTES) return 1;

	if (inWindow && votes >= QUALITY_MIN_VOTES_FRESH) return 2;

	return 0;
}

// Тир рипа. Строка качества Kodik — это источник рипа, разрешение видно в link: замер
// 2026-11-06, quality бывает «BDRip» без цифр, а разрешение берётся из ссылки.
function ripSourceOf(quality) {
	const q = String(quality || '').toLowerCase();

	if (/camrip|\bcam\b/.test(q)) return 'cam';
	if (/satrip|\bsat\b|vhsrrip|tdr\b/.test(q)) return 'sat';
	if (/web-?dl|webdl/.test(q)) return 'webdl';
	if (/bluray|bd-?rip|\bbd\b/.test(q)) return 'bluray';
	if (/web-?rip|webrip/.test(q)) return 'webrip';
	if (/hdtv|hdrip|pdtv|dvdrip/.test(q)) return 'hdtv';

	return 'other';
}

function resolutionOf(link, quality) {
	const fromLink = String(link || '').match(/(2160|1080|720|576|480|360)p/i);
	const fromQuality = String(quality || '').match(/(2160|1080|720|576|480|360)p/i);
	const value = fromLink?.[1] || fromQuality?.[1];

	return value ? `${value.toLowerCase()}p` : '';
}

// 1 — BDRip/WEB-DL 1080p и выше, 2 — тот же источник 720p или без цифр, 3 — HDTVRip/HDRip,
// 4 — SATRip и SD, 5 — CAMRIP. Пятый тир в ленту не пускаем: по замеру окна без плеера
// осталось 12 карточек из 65, и жёсткое отсечение CamRip ленту укорачивает ещё.
function ripTier(quality, link) {
	const source = ripSourceOf(quality);
	const resolution = resolutionOf(link, quality);
	const number = Number(String(resolution).replace('p', '')) || 0;

	if (source === 'cam') return 5;

	if ((source === 'bluray' || source === 'webdl') && number >= 1080) return 1;
	if (source === 'bluray' || source === 'webdl') return 2;
	if (source === 'webrip') return number >= 1080 ? 2 : 3;
	if (source === 'hdtv') return 3;

	return 4;
}

// Совпадение имени с записью Kodik — тот же подход, что в $lib/shared/kodik.js: список
// альтернативных названий разбирается по слешу, потому что имя карточки часто стоит в
// other_title. Год проверяем, когда он известен у обеих сторон.
function nameSet(item) {
	const names = [];

	for (const value of [item?.title, item?.original_title || item?.title_orig, item?.other_title]) {
		for (const part of String(value || '').split('/')) {
			const name = nameKeyOf(part);

			if (name) names.push(name);
		}
	}

	return names;
}

// Совпадение именем. Три варианта, по убыванию точности: полное имя, короткое имя карточки
// («История игрушек 5» → «История игрушек») и обратное — когда Kodik называет запись одним
// словом, а карточка полным именем. Обратный вариант включил пользователь 2026-11-06:
// замер того же дня по dry-run проходу, Kodik выдаёт «Лес» (2016) для «Ведьмин лес» (2026),
// «Остров» (2018) для «Остров забвения» (2026), «Ноль» (2018) для «Годзилла: Минус ноль»
// (2026). В эти строки проход писал «совпадения имени нет», и карточка не появлялась.
// Обратное совпадение принимаем только отдельным словом и только при совпадении года:
// по тому же замеру «Тайна» (1967) против «Тайна Коко» (2017) — разные годы, и такой карточки
// в ленте нет. Короткие слова меньше трёх букв не берём: Kodik отвечает «День 0», «Кто я?».
function nameMatches(candidate, item) {
	const names = nameSet(item);
	const full = nameKeyOf(candidate.title);
	const short = shortNameOf(candidate.title);

	if (!full || !names.length) return '';
	if (names.includes(full)) return 'полным именем';

	if (short && names.some((name) => name === short || name.startsWith(`${short} `))) return 'коротким именем';

	const words = full.split(' ');

	if (names.some((name) => name.length >= 3 && words.includes(name))) return 'обратным именем';

	// Словосочетание добавил 2026-11-06 по решению пользователя: Kodik часто хранит только вторую
	// часть имени франшизы. Замер того же дня: «Веном: Последний танец» (2024) → Kodik отвечает
	// «Последний танец» (2024, WEB-DLRip 720p), и одиночное слово его не берёт, потому что имя
	// Kodik состоит из двух слов — карточка с рипом оставалась за лентой. Берём сочетание из двух
	// и более слов, которое стоит внутри имени карточки подряд, и только при том же годе: без года
	// сюда попали бы «Последний танец» (2003) и «Танец дракона» (2008).
	const phrase = (name) => name.split(' ').length >= 2 && (full === name || full.startsWith(`${name} `) || full.endsWith(` ${name}`) || full.includes(` ${name} `));

	if (names.some((name) => phrase(name))) return 'словосочетанием';

	return '';
}

// Год проверяем отдельно и при полном совпадении имени: замер 2026-11-06, карточка
// «Курьер» (2026) получила запись Kodik «Курьер» (2008), то есть одно слово у другой
// картины. Год Kodik сравниваем как число: он пишет year и числом, и строкой.
function yearMatches(candidate, item) {
	return !candidate.year || !item?.year || Number(item.year) == Number(candidate.year);
}

// — — — — — — — — — — — — — — — — — — — — — источники — — — — — — — — — — — — — — — — — — — —

async function tmdbJson(path, force) {
	return netCache(`tmdb:${path}`, () => netFetch(`/api/tmdb/${path}`, { timeoutMs: 15000, attempts: 2 }), force);
}

// Страна и код IMDb кандидата одним запросом /movie/{id}. Строка пула их не даёт, поэтому это
// отдельное обращение: оно нужно, когда Kodik по имени не нашёл запись, потому что Alloha
// проверяет материал только по номеру. Ответ дня лежит в netCache, и запросы считаем — не больше
// MAX_DETAILS в сутки. Считаем только фактические обращения: cached-ответ бюджета не расходует.
const detailsByDay = new Map();

async function detailOf(candidate, day, force) {
	const tmdbId = String(candidate?.tmdbId || '');
	const code = String(candidate?.imdbId || '');

	// Запасной путь: у строки базы нет поля tmdbId, но код IMDb есть. /find по коду — то же
	// количество обращений (один запрос), и он даёт страну и дату релиза для перенесённой карточки.
	if (!tmdbId && !code) return null;

	if ((detailsByDay.get(day) || 0) >= MAX_DETAILS) return { imdbId: code, country: '', releaseDate: '', reason: `бюджет ${MAX_DETAILS} обращений на день исчерпан` };

	const path = tmdbId
		? `3/movie/${tmdbId}?language=ru&append_to_response=release_dates`
		: `3/find/${code}?external_source=imdb_id&language=ru&append_to_response=release_dates`;
	const answer = await tmdbJson(path, force);

	if (!answer.ok) return { imdbId: code, country: '', releaseDate: '', premiereDate: '', reason: `TMDB detail не ответил (${answer.status})` };

	if (!answer.cached) detailsByDay.set(day, (detailsByDay.get(day) || 0) + 1);

	const row = answer.data?.movie_results?.[0] || answer.data?.results || answer.data || {};
	const country = (Array.isArray(row.origin_country) ? row.origin_country : []).map((item) => String(item || '').trim()).filter(Boolean)[0] || '';

	// Самый ранний фактический релиз. Замер 2026-11-06 вечер: у «Обсессии» general release
	// 2026-05-13, а блок release_dates даёт 2025-09-06 (тип 1, премьера в Канаде) — карточка
	// показывала 2026, хотя фильм известен как премьера 2025 года. Строка окна и путь find этот
	// блок не отдают, поэтому дату берём из detail; append_to_response идёт в том же запросе,
	// который уже нужен для страны и кода IMDb, то есть обращений больше не становится.
	const regions = Array.isArray(row.release_dates?.results) ? row.release_dates.results : [];
	const dates = regions
		.flatMap((region) => (Array.isArray(region.release_dates) ? region.release_dates : []).map((item) => String(item.release_date || '').slice(0, 10)))
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));

	return {
		imdbId: String(row.imdb_id || code),
		country,
		releaseDate: String(row.release_date || '').slice(0, 10),
		premiereDate: dates[0] || '',
		reason: ''
	};
}

async function genreNames(day, force) {
	const answer = await netCache(`tmdb:movie-genres:${day}`, () => netFetch('/api/tmdb/3/genre/movie/list?language=ru', { timeoutMs: 15000, attempts: 2 }), force);
	const list = Array.isArray(answer.data?.genres) ? answer.data.genres : [];
	const byId = new Map(list.map((g) => [Number(g.id), g.name || '']));

	return byId;
}

// Пул: страницы popular и окно премьер текущего года. Ответы дня лежат в netCache, повторный проход
// в тот же день их не спрашивает.
//
// Строки popular принимаем только текущего года: по замеру 2026-11-06 страницы popular идут
// вперемешку с тайтлами прошлых лет, и без этой проверки лента наполнялась ими.
async function poolCandidates(day, force) {
	const rows = [];
	const windowY = windowYear(day);

	// Часть предпочтения: окно премьер текущего года с фильтром по стране производства. Эти имена
	// идут в пул первыми по двум причинам: порядок ленты начинается с них, и лимит запросов
	// /movie/{id} (он же даёт код IMDb для ветки Alloha) расходуется по порядку пула, то есть
	// сначала на производство США.
	for (const page of US_WINDOW_PAGES) {
		const answer = await tmdbJson(
			`3/discover/movie?language=ru&with_origin_country=${PREFERRED_COUNTRY}&primary_release_date.gte=${windowY}-01-01&primary_release_date.lte=${day}&vote_count.gte=${QUALITY_MIN_VOTES_FRESH}&page=${page}`,
			force
		);

		if (!answer.ok) return { ok: false, reason: `TMDB окно ${PREFERRED_COUNTRY} ${answer.status}`, rows: [] };

		const found = Array.isArray(answer.data?.results) ? answer.data.results : [];

		if (!found.length) break;

		for (const row of found) {
			const candidate = candidateFrom(row, true, 'window-us', PREFERRED_COUNTRY);

			if (!rows.some((item) => item.nameKey === candidate.nameKey && item.year == candidate.year)) rows.push(candidate);
		}
	}

	for (const page of POOL_PAGES) {
		const answer = await tmdbJson(`3/movie/popular?language=ru&page=${page}`, force);

		if (!answer.ok) return { ok: false, reason: `TMDB popular ${answer.status}`, rows: [] };

		for (const row of Array.isArray(answer.data?.results) ? answer.data.results : []) {
			const candidate = candidateFrom(row, Number(String(row.release_date || '').slice(0, 4)) >= windowY);

			// Тот же тайтл может прийти и из окна премьер, и из списка popular: без проверки
			// по имени+году он попадает в пул дважды и в ленте две одинаковые карточки.
			if (candidate.inWindow && !rows.some((item) => item.nameKey === candidate.nameKey && item.year == candidate.year)) rows.push(candidate);
		}
	}

	const to = day;

	for (const page of WINDOW_PAGES) {
		const windowAnswer = await tmdbJson(
			`3/discover/movie?language=ru&primary_release_date.gte=${windowY}-01-01&primary_release_date.lte=${to}&vote_count.gte=${QUALITY_MIN_VOTES_FRESH}&page=${page}`,
			force
		);

		if (!windowAnswer.ok) return { ok: false, reason: `TMDB window ${windowAnswer.status}`, rows: [] };

		const found = Array.isArray(windowAnswer.data?.results) ? windowAnswer.data.results : [];

		if (!found.length) break;

		for (const row of found) {
			const candidate = candidateFrom(row, true);

			if (!rows.some((item) => item.nameKey === candidate.nameKey && item.year == candidate.year)) rows.push(candidate);
		}
	}

	// Жанром покрывать нечего: строка search/discover несёт только genre_ids, имена приходят
	// отдельным ответом списка (его кэшируем на день, это один запрос, а не один на кандидата).
	const genres = await genreNames(day, force);

	for (const row of rows) row.genre = genres.get(Number(row.genreIds[0])) || '';

	return { ok: true, reason: '', rows };
}

// Gate: Kodik по имени (search требует хотя бы один поисковый параметр: пустой запрос и
// запрос только по году отвечают 400), сначала strict, потом обычный поиск. Совпадение
// проверяется и именем, и годом: замер 2026-11-06, карточка «Курьер» (2026) получила запись
// «Курьер» (2008) — то же слово у другой картины.
//
// Разрешение играть берём из get-player. Замер того же дня: строка search поля allowed не
// отдаёт (в ней id, type, title, quality, camrip, created_at), а get-player отвечает
// {found, allowed, quality, translation, link}. Поэтому проверка — два запроса: search
// находит запись, get-player подтверждает, что её можно играть. Оба ответа лежат в netCache,
// и тайтл проверяется не чаще одного раза в сутки (checkDay).
//
// Alloha — второй источник и только по номеру: для трёх фильмов подборки он ответил
// «not movie», поля качества у него нет.
async function gateMovie(candidate, day, force) {
	const attempts = [];

	if (candidate.imdbId) attempts.push({ param: 'imdb_id', value: candidate.imdbId, via: 'коду IMDb', strict: true });

	attempts.push({ param: 'title', value: candidate.title, via: 'имени по strict', strict: true });
	attempts.push({ param: 'title', value: candidate.title, via: 'имени без strict' });

	const offered = [];

	for (const attempt of attempts) {
		const query = new URLSearchParams({ limit: '20', types: KODIK_TYPE });

		query.set(attempt.param, attempt.value);

		if (attempt.strict) query.set('strict', '1');

		const answer = await netCache(`kodik:movie:${attempt.param}:${attempt.value}`, () => netFetch(`/api/kodik/search?${query}`, { timeoutMs: 15000, attempts: 2 }), force);
		const results = Array.isArray(answer.data?.results) ? answer.data.results : [];

		if (!answer.ok) {
			if (answer.status === 401) return { ok: false, checked: true, note: 'Kodik ищет только по личному токену (KODIK_TOKEN): публичный токен отвечает 401' };

			return { ok: false, note: `Kodik ${netSummary('не ответил', answer)}`, retry: true };
		}

		if (!results.length) {
			if (attempt.param !== 'title') offered.push(`по ${attempt.via} пусто`);

			continue;
		}

		if (attempt.param === 'imdb_id') {
			const exact = results.find((item) => String(item.imdb_id || '') === attempt.value);

			if (exact) return acceptKodik(exact, `по ${attempt.via}, номер совпал`, force);

			continue;
		}

		const match = results.find((item) => nameMatches(candidate, item) && yearMatches(candidate, item));

		if (match) return acceptKodik(match, `по ${attempt.via}, ${nameMatches(candidate, match)} и годом ${match.year || 'неизвестен'}`, force);

		// Отдельная строка для совпадения именем, но не годом: это чужой тайтл, и писать о
		// нём нужно иначе, чем про пустой поиск.
		const byName = results.find((item) => nameMatches(candidate, item));

		if (byName) {
			offered.push(
				`по ${attempt.via} предложил «${byName.title || 'без названия'}» (${byName.year || 'год неизвестен'}) — имя совпало, год ${byName.year || 'неизвестен'} против ${candidate.year || 'неизвестного'} в карточке`
			);

			continue;
		}

		offered.push(
			`по ${attempt.via} предложил «${results[0].title || 'без названия'}» (${results[0].year || 'год неизвестен'}) — совпадения имени нет`
		);
	}

	if (candidate.kinopoiskId) {
		const alloha = await allohaEmbed(candidate.kinopoiskId, force);

		if (alloha.ok && numericKey(candidate.kinopoiskId)) {
			return {
				ok: true,
				checked: true,
				via: 'alloha',
				kinopoiskId: numericKey(candidate.kinopoiskId) || numericKey(alloha.kpId),
				country: candidate.country,
				note: `Alloha: ${alloha.note} (качества у источника нет)`
			};
		}

		offered.push(`Alloha: ${alloha.note}`);
	}

	// Ветка Alloha по коду IMDb. Раньше она для кандидатов пула не работала: строка TMDB не несёт
	// imdb_id, и у кандидата кода не было — до Alloha дело не доходило ни разу. Замер 2026-11-06
	// вечер, окно 2026 с фильтром по стране, 20 имён первой страницы: Kodik по имени не ответил
	// ни на один тайтл, Alloha по коду нашёл 19 из 20 (у «Истории Дерри» источник сказал «not
	// movie»). Значит короткая лента была не из-за отсутствия материала, а из-за того, что второго
	// плеера проверяли только по номеру, а номера у кандидатов не было. Код и страну даёт один
	// запрос /movie/{id}, у которого есть оба поля, поэтому он же закрывает и поле country.
	if (!candidate.imdbId) {
		const detail = await detailOf(candidate, day, force);

		if (detail) {
			candidate.imdbId = detail.imdbId;
			candidate.country = candidate.country || detail.country;
			candidate.releaseDate = candidate.releaseDate || detail.releaseDate;

			// Заметка «кода IMDb нет» была не честной: за ней скрывались два разных случая —
			// ответа не было (прокси ошибся) и бюджет обращений исчерпан. Замер 2026-11-06 вечер:
			// у тайтлов из заметки коды есть, значит обращение не дошло. Теперь причину видно.
			if (detail.reason) offered.push(`код не получен: ${detail.reason}`);
		}
	}

	const code = String(candidate.imdbId || '');

	if (!code) {
		offered.push('кода IMDb нет — Alloha проверяется только по номеру');

		return {
			ok: false,
			checked: true,
			country: candidate.country,
			note: `Kodik не нашёл материал ни по ${attempts.map((a) => a.via).join(', ни ')}${offered.length ? `; ${offered.join('; ')}` : ''}`
		};
	}

	const alloha = await allohaEmbed(code, force);

	if (alloha.ok) {
		// Alloha по коду IMDb отвечает success и без номера (замер 2026-11-07: tt13884466 и
		// tt43750202 — id_kp пустой, таких тайтлов в Kinopoisk нет). Материал такой источник
		// играет, но карточку по правилу не делаем: без числового ключа её нельзя сохранить в
		// список, и страница показывает только плеер. Строка остаётся с checkNote и checkDay.
		const key = numericKey(alloha.kpId);

		if (key) {
			return {
				ok: true,
				checked: true,
				via: 'alloha',
				imdbId: code,
				kinopoiskId: key,
				country: candidate.country,
				note: `Alloha по коду IMDb ${code}: ${alloha.note} (качества у источника нет)`
			};
		}

		offered.push(`Alloha по коду ${code}: ${alloha.note}, но id_kp пустой — карточка без ключа не может быть в списке`);
	}

	offered.push(`Alloha по коду ${code}: ${alloha.note}`);

	return {
		ok: false,
		checked: true,
		country: candidate.country,
		note: `Kodik не нашёл материал ни по ${attempts.map((a) => a.via).join(', ни ')}; ${offered.join('; ')}`
	};
}

async function acceptKodik(item, via, force) {
	const player = await netCache(
		`kodik:player:${item.id}`,
		() => netFetch(`/api/kodik/get-player?id=${encodeURIComponent(item.id)}`, { timeoutMs: 15000, attempts: 2 }),
		force
	);

	if (!player.ok) return { ok: false, checked: true, note: `Kodik нашёл запись ${via}, но get-player не ответил (${player.status})` };

	if (!player.data?.found) return { ok: false, checked: true, note: `Kodik нашёл запись ${via}, но get-player: found=false` };

	// Гейт: запись Kodik есть, но играть её нельзя — карточку не пишем.
	if (!player.data?.allowed) {
		return { ok: false, checked: true, note: `Kodik нашёл запись ${via}, но get-player: allowed=${player.data.allowed || 'пусто'}, играть нельзя` };
	}

	const quality = String(player.data.quality || item.quality || '');
	const link = normalizeLink(player.data.link || item.link);
	const tier = ripTier(quality, link);

	const key = numericKey(item.kinopoisk_id);

	// Гейт по ключу: запись Kodik есть и играть её можно, но без номера Kinopoisk карточка не
	// может быть ни в списке профиля, ни на странице с заголовком — см. numericKey. Такая строка
	// остаётся строкой проверки (checkNote, checkDay), но карточкой не становится.
	if (!key) {
		return {
			ok: false,
			checked: true,
			note: `Kodik нашёл запись ${via}, но числового ключа Kinopoisk нет (kinopoisk_id пустой) — карточка без ключа не может быть в списке`
		};
	}

	if (tier === 5) return { ok: false, checked: true, note: `Kodik нашёл запись ${via}, но рип CAMRIP — в ленту не пускаем` };

	return {
		ok: true,
		checked: true,
		via: 'kodik',
		kodikId: String(item.id || ''),
		kinopoiskId: key,
		imdbId: String(item.imdb_id || ''),
		quality,
		qualityTier: tier,
		qualitySource: ripSourceOf(quality),
		resolution: resolutionOf(link, quality),
		// created_at строки Kodik — дата появления рипа: по ней лента наполняется, потому что
		// ленты последних поступлений у Kodik нет (search требует параметр, sort игнорируется).
		playerAddedAt: String(item.created_at || '').slice(0, 10),
		note: `Kodik ${via}: ${quality || 'без качества'} ${resolutionOf(link, quality) || 'без разрешения'}`
	};
}

function normalizeLink(link) {
	if (!link) return '';

	return link.startsWith('//') ? `https:${link}` : link;
}

// — — — — — — — — — — — — — — — — — — — — проход — — — — — — — — — — — — — — — — — — — — — —

/**
 * Один проход: пул TMDB, проверка гейтом, запись в коллекцию. Возвращает { ok, reason, added,
 * updated, removed, checked, noPlayer, lowQuality }. Причина пишется в лог сервиса, чтобы было
 * видно, источник не ответил или правило не пустило кандидата.
 */
export async function refreshMovieSnapshot(force = false, opts = {}) {
	const dry = Boolean(opts.dryRun);
	const day = todayKey();
	// Год прохода: по нему окно и перенос карточек (решение 2026-11-06 — лента только из текущих
	// новинок). Считается от дня прохода, а не от даты в модуле: сервис живёт сутками, и 1 января
	// старое окно уже не год.
	const windowY = windowYear(day);
	const pool = await poolCandidates(day, force);

	const existing = await pb.collection(MOVIE_COLLECTION).getFullList({ sort: 'pos' }).catch((error) => {
		// Пустая карта при отказе запроса — это дубли: проход не видит карточки, которые уже в базе,
		// и создаёт их заново. Поэтому при отказе проход останавливается, а не пишет вслепую.
		console.warn(`  выборка строк: ${error?.status || 0} ${error?.message || error} — проход не делаем`);

		return null;
	});

	if (!existing) return { ok: false, reason: 'выборка строк не прошла', added: 0, updated: 0, removed: 0, parked: 0, duplicates: 0, checked: 0, noPlayer: 0, lowQuality: 0 };

	// Пул пуст, но проход всё равно идёт, если в базе есть карточки дня: лента собирается из
	// сохранённых строк (проверки сегодня не нужны), и дубли убираются. По замеру 2026-11-07
	// вечером TMDB не ответил (0 строк окна), проход остановился, и 16 пар дублей остались в
	// карусели на весь день.
	if (!pool.rows.length && !existing.some((record) => record.day == day && record.playerVia)) {
		return { ok: false, reason: pool.reason || 'пул пустой', added: 0, updated: 0, removed: 0, parked: 0, duplicates: 0, checked: 0, noPlayer: 0, lowQuality: 0 };
	}

	const byKey = new Map(existing.map((record) => [record.nameKey || nameKeyOf(record.title), record]));
	// Карта по числовому ключу — строки updater'а приходят без nameKey, и по одному имени два
	// писателя пишут два ряда для одного фильма.
	const byNumber = new Map(existing.filter((record) => numericKey(record.kinopoiskId)).map((record) => [numericKey(record.kinopoiskId), record]));

	let feed = [];
	const dropped = [];
	let checked = 0;
	let noPlayer = 0;
	let lowQuality = 0;

	// Кандидат пула: строка уже проверена сегодня — берём сохранённые значения, без запроса.
	for (const candidate of pool.rows) {
		if (!viewerTier(candidate, null, windowY)) {
			lowQuality++;
			continue;
		}

		// Строку ищем сначала по числовому ключу: одно и то же имя писатели пишут по-разному
		// (TMDB — «Идеальное Рождество для собаки», Alloha — «Идеальное собачье Рождество»), и по
		// имени проход создаёт второй ряд для того же фильма.
		const record = byNumber.get(numericKey(candidate.kinopoiskId)) || byKey.get(candidate.nameKey);

		if (record?.playerVia && record.checkDay == day) {
			// Правило 2026-11-07: карточка ленты обязана иметь числовой ключ. Строки, записанные по
			// прежнему правилу (Alloha ответил по коду IMDb, id_kp пустой), в ленту не переносим:
			// без ключа тайтл нельзя сохранить в список, и страница показывает только плеер.
			if (!numericKey(record.kinopoiskId)) {
				dropped.push({ id: record.id, why: 'нет числового ключа — карточка без ключа не может быть в списке' });

				continue;
			}

			feed.push(rowFromRecord(record, candidate, windowY, day));
			continue;
		}

		if (record?.checkDay == day) continue;

		if (checked >= MAX_CHECKS) continue;

		const gate = await gateMovie(candidate, day, force);

		checked++;

		if (!gate.ok) {
			noPlayer++;

			// В dry-run печатаем причину по каждому кандидату: по замеру 2026-11-06 лента
			// пустая, и по этой строке видно, источник не ответил, Kodik предложил чужой
			// тайтл или запись есть, но allowed = false.
			if (dry) console.log(`  · ${candidate.title} (${candidate.year}) тир ${viewerTier(candidate, record, windowY)}: ${gate.note}`);

			if (!record) continue;

			if (record.playerVia) {
				// Карточка остаётся, только если тайтл по-прежнему находится: сегодняшняя
				// проверка сказала «нет» — карточка уходит из ленты.
				dropped.push({ id: record.id, why: `исчез из плеера: ${gate.note}` });
			} else {
				// Строку без плеера не удаляем: она держит checkDay, и повторная проверка
				// тайтла в тот же день не нужна.
				await update(MOVIE_COLLECTION, record.id, { checkNote: gate.note, checkDay: day }, dry);
			}

			continue;
		}

		// Страна карточки: для кандидата из страницы с фильтром по стране она известна из пула,
		// для остальных её даёт один запрос /movie/{id}. Здесь он нужен только принятым карточкам
		// — не больше TOP обращений в день, потому что для непринятых страна не пишется. Тот же
		// запрос закрывает дату релиза: по ней порядок ленты сравнивает свежесть.
		if ((!candidate.country || !candidate.releaseDate || !candidate.premiereDate) && (candidate.tmdbId || candidate.imdbId)) {
			const detail = await detailOf(candidate, day, force);

			if (detail?.country) candidate.country = detail.country;
			if (detail?.releaseDate) candidate.releaseDate = detail.releaseDate;
			if (detail?.premiereDate) candidate.premiereDate = detail.premiereDate;
		}

		// Год карточки — год самого раннего фактического релиза, когда он известен. По той же дате
		// лента сравнивает свежесть: премьера раньше проката, поэтому порядок честнее (замер
		// 2026-11-06 вечер: «Обсессия» — general release 2026-05-13, премьера 2025-09-06, и
		// посетитель прав, когда называет фильм 2025 годом). Если блока release_dates нет (путь
		// find его не отдаёт), остаёмся на general release, как было раньше.
		if (candidate.premiereDate) {
			candidate.releaseDate = candidate.premiereDate;
			candidate.year = Number(String(candidate.premiereDate).slice(0, 4)) || candidate.year;
		}

		feed.push(rowFromGate(candidate, gate, day, record, windowY));

		await sleep(KODIK_DELAY_MS);
	}

	// Строки с плеером, которые сегодня в пул не попали (например, рип появился вчера):
	// перепроверяем, когда их не проверяли сегодня, и убираем, если рип исчез.
	for (const record of existing) {
		if (!record.playerVia) continue;

		// То же правило, что выше: строка без числового ключа карточкой не становится, её убираем
		// из ленты. Проверять такой тайтл заново не нужно — источник его играет, но ключа нет ни в
		// Kinopoisk, ни в Kodik.
		if (!numericKey(record.kinopoiskId)) {
			dropped.push({ id: record.id, why: 'нет числового ключа — карточка без ключа не может быть в списке' });

			continue;
		}

		const key = record.nameKey || nameKeyOf(record.title);

		if (feed.some((row) => row.nameKey === key)) continue;

		// Карточку не переносим, если её год — не год прохода (решение пользователя 2026-11-06: лента
		// формируется только из текущих новинок). Строку убираем из базы: без переноса она осталась бы
		// с тем же днём, и страница показала бы её, потому что фильтр страницы — по дню, а не по году.
		// Замер того же дня: три карточки ленты (Веном 2024, Годзилла 2023, Паразиты 2019) пришли
		// именно из переноса старого года, и по новому правилу они из ленты уходят.
		if (Number(record.year || 0) < windowY) {
			dropped.push({ id: record.id, why: `год ${record.year} — не текущий, лента только из новинок` });
			continue;
		}

		if (record.checkDay == day || checked >= MAX_CHECKS) {
			feed.push(rowFromRecord(record, null, windowY, day));
			continue;
		}

		const gate = await gateMovie({ title: record.title, year: Number(record.year) || 0, imdbId: record.imdbId, kinopoiskId: record.kinopoiskId }, day, force);

		checked++;

		if (!gate.ok) {
			noPlayer++;
			dropped.push({ id: record.id, why: `исчез из плеера: ${gate.note}` });

			continue;
		}

		feed.push(rowFromGate({ title: record.title, nameKey: key, year: Number(record.year) || 0, genre: record.genre || '', poster: record.poster || '', rating: null, votes: 0, inWindow: false, tmdbId: '' }, gate, day, record, windowY));

		await sleep(KODIK_DELAY_MS);
	}

	// Один фильм — одна карточка. Замер 2026-11-07: карусель показала 16 дублей, в базе было по два
	// ряда на тайтл. Второй ряд появлялся, когда поиск строки не прошёл (проход решил, что строки
	// нет, и создал новую) или когда тот же фильм пришёл под другим именем. Здесь остаётся первая
	// строка по ключу; лишние ряды базы убираются ниже.
	const keptKeys = new Set();

	feed = feed.filter((row) => {
		const key = dedupeKeyOf(row);

		if (keptKeys.has(key)) return false;

		keptKeys.add(key);

		return true;
	});

	// Порядок ленты (решение пользователя 2026-11-06 вечер): сначала производство preferred страны,
	// если таких карточек не хватает — популярные новинки других стран, и внутри группы по свежести
	// релиза, убывая. Раньше первым шёл зрительский тир, и лента началась с карточек других стран,
	// потому что американских в ней не было ни одной. Дата релиза сравнивается целиком, не год:
	// две карточки одного года иначе встали бы в произвольном порядке. Движение карточки
	// получается само: ключи меняются, когда изменились страна, дата релиза или тир.
	feed.sort(
		(a, b) =>
			countryGroup(a) - countryGroup(b) ||
			String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')) ||
			(a.viewerTier || 0) - (b.viewerTier || 0) ||
			(a.sub || 3) - (b.sub || 3) ||
			a.qualityTier - b.qualityTier ||
			String(b.playerAddedAt).localeCompare(String(a.playerAddedAt)) ||
			(b.year || 0) - (a.year || 0)
	);

	const rows = feed.slice(0, TOP);
	let added = 0;
	let updated = 0;
	// Ряды, которые проход писал в этом проходе — по ним ниже определяется, какой ряд оставить при
	// дубле.
	const written = new Set();

	for (const [index, row] of rows.entries()) {
		row.pos = index + 1;

		// Под-порядок нужен только для сортировки: поля в схеме нет, и писать его не нужно.
		delete row.sub;

		// Строку ищем не только по карте прохода: замер 2026-11-07 00:50 — два прохода шли
		// одновременно (cron-контейнер и ручной запуск), каждый создал свою карточку, и в базе
		// получилось 4 дубля (Стрим из ада, Унабомбер, Арахнид, Гипотеза любви), карусель показала
		// их дважды. Карта byKey собрана из строк, которые были в базе на старте прохода, поэтому
		// строку, созданную вторым процессом, первый не видит. Проверка — один запрос на новую
		// карточку, не больше TOP обращений в день. Дубли того же дня (16 пар, замер 2026-11-07
		// вечером) возникали ещё и так: отказ поиска проход считал «строки нет» и создавал второй
		// ряд для того же фильма. Теперь при отказе создание не делаем, а строку ищем по числовому
		// ключу, потому что одно и то же имя писатели пишут по-разному.
		let record = byNumber.get(dedupeKeyOf(row)) || byKey.get(row.nameKey);

		if (!record && !dry) {
			const found = await findByKey(MOVIE_COLLECTION, row.nameKey, numericKey(row.kinopoiskId), day);

			if (found.failed) continue;

			record = found.record;
		}

		if (!record) {
			const created = await create(MOVIE_COLLECTION, row, dry);

			if (!created) continue;

			added++;
			written.add(created.id);

			// Строку кладём в карту: если тот же фильм встретится в ленте ещё раз, проход обновит
			// её, а не создаст ещё один ряд.
			if (!dry) byNumber.set(dedupeKeyOf(row), created);

			continue;
		}

		// Карточку не трогаем, если ничего не изменилось: поле updated меняется при любом
		// сохранении, и «качество улучшилось сегодня» перестало бы быть правдой. Но pos — часть
		// порядка ленты, и его писать нужно: замер 2026-11-06, после дополнения пула лента шла
		// Надежда → Веном → Демонолог, а Демонолог остался с pos 2 из прошлого прохода, потому что
		// сама запись не изменилась. Страница сортирует по pos, поэтому позиция не должна отставать.
		if (sameRecord(record, row)) {
			written.add(record.id);

			if (Number(record.pos) != row.pos) await update(MOVIE_COLLECTION, record.id, { pos: row.pos }, dry);

			continue;
		}

		written.add(record.id);
		await update(MOVIE_COLLECTION, record.id, row, dry);
		updated++;
	}

	let removed = 0;

	for (const item of dropped) {
		await remove(item.id, item.why, dry);
		removed++;
	}

	// Строки того же дня, которые в ленту прохода не попали, карточкой не становятся: порядок ленты
	// — это pos 1…TOP, который пишет проход. Замер 2026-11-06 22:37: в базе 65 строк дня, лента
	// прохода — 20 карточек, а страница показала бы 40, потому что pos у строк прежнего прохода
	// остался и они проходили по фильтру «есть плеер». Им ставим pos 0: строка остаётся с checkDay,
	// и тайтл не проверяется в тот же день повторно.
	let parked = 0;

	for (const record of existing) {
		if (record.day != day) continue;

		const key = dedupeKeyOf(record);

		if (rows.some((row) => dedupeKeyOf(row) === key)) continue;
		if (Number(record.pos) == 0) continue;

		await update(MOVIE_COLLECTION, record.id, { pos: 0 }, dry);
		parked++;
	}

	// Дубль — это два ряда того же дня с одним ключом. Проход писал только один из них, второй
	// оставался, и карусель показывала фильм дважды: замер 2026-11-07 вечером — 16 пар дублей,
	// строки в каждой паре полностью одинаковые. Остаётся ряд, который проход писал в этом проходе;
	// если ни один из рядов не писался — остаётся первый по pos, лишние убираем.
	const winner = new Map();

	for (const record of existing) {
		if (record.day != day) continue;

		const key = dedupeKeyOf(record);
		const current = winner.get(key);

		if (!current) {
			winner.set(key, record);

			continue;
		}

		const preferWritten = written.has(record.id) && !written.has(current.id);
		const preferLowerPos = !written.has(record.id) && !written.has(current.id) && Number(record.pos) < Number(current.pos);

		if (preferWritten || preferLowerPos) winner.set(key, record);
	}

	let duplicates = 0;

	for (const record of existing) {
		if (record.day != day) continue;

		const key = dedupeKeyOf(record);
		const kept = winner.get(key);

		if (!kept || kept.id == record.id) continue;

		await remove(record.id, `дубль ${key}: осталась строка ${kept.id}`, dry);
		duplicates++;
	}

	if (!dry) await readSnapshot(`movieSource:${MOVIE_COLLECTION}`, () => newestPage(), true);

	return { ok: true, reason: '', added, updated, removed, parked, duplicates, checked, noPlayer, lowQuality, feed: rows.length };
}

// Группа по стране производства: карточки preferred страны идут раньше остальных независимо от
// зрительского тира — так просит пользователь (решение 2026-11-06 вечер). Пустая страна — вторая
// группа: её мы не знаем, потому что строка TMDB поля origin_country не несёт, и запрос
// /movie/{id} на этого кандидата не тратился (бюджет MAX_DETAILS).
function countryGroup(row) {
	return String(row?.country || '').split(', ')[0] === PREFERRED_COUNTRY ? 1 : 2;
}

// Под-порядок внутри зрительского тира: топ popular → свежие премьеры окна. Третьего под-порядка
// («старые по порогу», правило от 2026-11-05) больше нет: с 2026-11-06 лента строится только из
// текущих новинок, и тайтлы старше года прохода в неё не попадают. В базу поле не пишем: порядок
// считается в проходе, страница читает pos, и лишнее поле PocketBase отбросил бы молча.
function subOf(candidate, record = null, windowY = windowYear()) {
	const source = candidate?.source;

	if (source === 'popular') return 1;
	if (source === 'window') return 2;
	// Имена из страницы с фильтром по стране — тот же под-порядок, что окно: внутри своей группы
	// они идут по свежести релиза.
	if (source === 'window-us') return 2;

	// Перенос карточки без кандидата (строка из прошлого прохода): она могла прийти только из окна,
	// поэтому тот же под-порядок. Проход в пул таких строк уже не пускает, ветка осталась для
	// переноса.
	return Number(record?.year || candidate?.year || 0) >= windowY ? 2 : 3;
}

function rowFromGate(candidate, gate, day, record = null, windowY = windowYear()) {
	return {
		day,
		nameKey: candidate.nameKey,
		title: candidate.title || record?.title || '',
		year: candidate.year || Number(record?.year) || 0,
		genre: candidate.genre || record?.genre || '',
		rating: candidate.rating ?? record?.rating ?? '',
		ratingCount: candidate.votes ?? record?.ratingCount ?? 0,
		viewerTier: viewerTier(candidate, record, windowY),
		sub: subOf(candidate, record, windowY),
		poster: candidate.poster || record?.poster || '',
		sourceUrl: record?.sourceUrl || (candidate.tmdbId ? `https://www.themoviedb.org/movie/${candidate.tmdbId}` : ''),
		kinopoiskId: gate.kinopoiskId || record?.kinopoiskId || '',
		imdbId: gate.imdbId || record?.imdbId || '',
		kodikId: gate.kodikId || record?.kodikId || '',
		playerVia: gate.via,
		quality: gate.quality || record?.quality || '',
		qualityTier: gate.qualityTier ?? record?.qualityTier ?? 0,
		qualitySource: gate.qualitySource || record?.qualitySource || '',
		resolution: gate.resolution || record?.resolution || '',
		playerAddedAt: gate.playerAddedAt || record?.playerAddedAt || '',
		// qualityChangedAt — дата, когда тир действительно улучшился: новую строку пишем
		// сегодня, сохранённую дату переносим, когда за сегодня качество не выросло. Но для новой
		// карточки улучшения не было: качество такое, каким оно появилось, поэтому дата равна
		// playerAddedAt. Замер 2026-11-06: подсказка на Веном (2024) говорила «качество улучшилось
		// сегодня», хотя рип появился 2025-10-20 и за сегодня ничего не выросло.
		qualityChangedAt: !record
			? gate.playerAddedAt || day
			: Number(record.qualityTier) < Number(gate.qualityTier)
				? day
				: record.qualityChangedAt || day,
		checkNote: gate.note,
		checkDay: day,
		pos: record?.pos || 0,
		// Страна и дата релиза — поля, по которым лента считает порядок (сначала производство
		// preferred страны, внутри группы по свежести релиза) и строку под карточкой на странице.
		country: gate.country || candidate.country || record?.country || '',
		releaseDate: candidate.releaseDate || record?.releaseDate || ''
	};
}

function rowFromRecord(record, candidate, windowY = windowYear(), day = '') {
	// Дату улучшения здесь не правим: PocketBase в этой сборке не отдаёт поле created (проверено
	// живым запросом к /api/collections/movie_carousel/records — в ответе его нет), поэтому нельзя
	// отличить дату, написанную при создании, от даты реального улучшения. Правильную дату пишет
	// rowFromGate: для новой карточки она равна дате рипа, и улучшение отмечаем только когда тир
	// действительно вырос. Пять карточек от 2026-11-06, где дата равна дню создания, поправил
	// отдельный скрипт (scratch/movies-fix-quality-changed-at.mjs).

	return {
		...record,
		// День строки — день прохода. Страница выбирает карточки по дню самой свежей ленты, и
		// перенесённая строка с прежним днём в неё не попадает: замер 2026-11-07 01:23 — 19
		// карточек вместо 20, потому что одна перенесённая строка осталась с днём 2026-11-06.
		day: day || record.day,
		nameKey: record.nameKey || nameKeyOf(record.title),
		// Год сверяем с сохранённой датой релиза: строку мог написать проход по старому правилу,
		// где год брали из строки окна, а дата — general release. Раз дата теперь самая ранняя
		// фактическая премьера, год берём из неё; если даты нет, оставляем сохранённый год.
		year: Number(String(record.releaseDate || '').slice(0, 4)) || Number(record.year) || 0,
		viewerTier: viewerTier(candidate || {}, record, windowY),
		sub: subOf(candidate, record, windowY),
		qualityTier: Number(record.qualityTier) || 0,
		country: record.country || candidate?.country || '',
		releaseDate: record.releaseDate || candidate?.releaseDate || ''
	};
}

// Сравнение с сохранённой строкой: меняем запись, только когда изменилось качество (тир) или
// появилась дата рипа. Порог качества не меняем — он решение от 2026-11-05.
function sameRecord(record, row) {
	const changed =
		String(record.playerVia || '') !== String(row.playerVia || '') ||
		Number(record.qualityTier) !== Number(row.qualityTier) ||
		String(record.quality || '') !== String(row.quality || '') ||
		String(record.playerAddedAt || '') !== String(row.playerAddedAt || '') ||
		// Дату улучшения тоже сравниваем: замер 2026-11-06 — пять карточек получили
		// qualityChangedAt = сегодня при создании, а по правилу для новой карточки она равна дате
		// рипа. Без этого сравнения исправление не записывается, и подсказка продолжает говорить
		// «улучшилось сегодня» там, где за сегодня ничего не выросло.
		String(record.qualityChangedAt || '') !== String(row.qualityChangedAt || '') ||
		// Строку обновляем и когда изменилась страна или дата релиза: их узнаёт запрос
		// /movie/{id}, и без этого сравнения поле осталось бы пустым, а порядок ленты — по
		// пустой дате.
		String(record.country || '') !== String(row.country || '') ||
		// Номер Kinopoisk тоже сравниваем: строки Alloha писались без него (ответ источника даёт
		// id_kp), и без этого сравнения поле осталось бы пустым, а кнопок «Смотрю» и
		// «Буду смотреть» в плеере нет — список профиля сохраняет только числовой ключ.
		String(record.kinopoiskId || '') !== String(row.kinopoiskId || '') ||
		// День строки тоже сравниваем: перенесённая карточка должна принадлежать сегодняшнему
		// проходу, иначе страница её не покажет (фильтр страницы — по дню самой свежей ленты).
		String(record.day || '') !== String(row.day || '') ||
		String(record.releaseDate || '') !== String(row.releaseDate || '');

	return !changed;
}

async function create(collection, row, dry) {
	if (dry) {
		console.log(`  + ${row.pos}. ${row.title} (${row.year}) тир ${row.qualityTier} ${row.quality || 'без качества'} ${row.playerVia}`);

		return { id: 'dry-run' };
	}

	try {
		return await pb.collection(collection).create(row);
	} catch (error) {
		console.warn(`  запись ${row.nameKey}: ${error?.message || error}`);

		return null;
	}
}

async function update(collection, id, row, dry) {
	// Печать dry-run для pos-обновления: туда приходит объект только с pos, и на нём нет ни
	// названия, ни качества — раньше dry-run печатал «undefined», и это читалось как пустая запись
	// в базе. Здесь то же самое сообщение, но без выдуманных полей.
	if (dry) {
		const what = row.title ? `${row.pos}. ${row.title}: качество ${row.quality || 'без качества'} тир ${row.qualityTier}` : `pos → ${row.pos}`;

		return console.log(`  ~ ${what}`);
	}

	await pb.collection(collection).update(id, row).catch((error) => console.warn(`  запись ${id}: ${error?.message || error}`));
}

// Строка карточки по числовому ключу или имени. Ошибка запроса — это не «строки нет»: при отказе
// проход не создаёт новую карточку. Замер 2026-11-07: поиск не прошёл, проход решил, что строки
// нет, и создал вторую строку для того же фильма — так в ленте появились дубли.
async function findByKey(collection, key, number, day) {
	const filter = number ? `day = "${day}" && (nameKey = "${key}" || kinopoiskId = "${number}")` : `day = "${day}" && nameKey = "${key}"`;

	try {
		const result = await pb.collection(collection).getList(1, 1, { filter });

		return { record: result.items?.[0] || null, failed: false };
	} catch (error) {
		console.warn(`  поиск строки ${key}: ${error?.status || 0} ${error?.message || error} — создание не делаем, чтобы не писать дубль`);

		return { record: null, failed: true };
	}
}

async function remove(id, why, dry) {
	if (dry) return console.log(`  - ${why}`);

	await pb.collection(MOVIE_COLLECTION).delete(id).catch((error) => console.warn(`  удаление ${id}: ${error?.message || error}`));
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

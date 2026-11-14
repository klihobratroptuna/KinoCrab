// Календарь выходов серий myshows.me (JSON-RPC v3) — список кандидатов для карусели «Сериалы».
//
// Зачем он в проекте: это единственный источник, который называет фактическую дату выхода
// серии. Kodik отдаёт даты добавления и обновления своей записи, у TMDB в выдаче поля
// last_air_date нет (замер 2026-11-04: выдача с sort=last_air_date.desc из 20 строк не дала
// ни одной строки окна), Kinopoisk списком имён не отвечает. Поэтому окно здесь читается
// одним запросом: за 30 дней до 2026-11-05 ответило 116 строк, 94 из них по странам этой
// карусели (us 53, ru 26, jp 8, uk 7, kr 5, cn 4, ua 3).
//
// Плеера здесь нет: onlineLinks — легальные сервисы, а не наш плеер. Источник даёт имена,
// даты, страну, статус, оценку и номера, а решение о карточке принимает проверка плеера в
// seriesSource (сначала Kodik, потом Alloha). Замер 2026-11-05 по 65 строкам окна: Alloha
// ответила на 52, Kodik — на 1, без плеера остались 12. Проверка по номеру важна: поиск по
// имени у Kodik путает тайтлы (замер: «Анатомия страсти» → «Анатомия хаоса»), а по номерам
// Kodik у тайтлов этого окна молчал (0 из 25), зато Alloha ответила на 24 из 25.
//
// Правила источника (docs myshows-scrobbler-api, разделы «Правила использования» и
// «Ошибки»): таймаут 5 секунд, до трёх попыток с паузами 1 и 2 секунды, на 4xx не повторять,
// приложение называть. Пакет — не больше 10 вызовов: 25 вызовов одним POST ответили ошибкой
// «max requests length in batch exceeded» (замер 2026-11-05), группа из 10 прошла за 173 мс.
// Поэтому на сутки — один запрос окна и до четырёх пакетов по 10, пауза только после пакета,
// который реально ушёл в сеть, и ответ дня лежит в netCache: повторный заход сети не трогает.
//
// robots.txt сайта обход обычным агентом запрещает, поэтому страниц здесь не читают: только
// документированный JSON-RPC и названное приложение в User-Agent. Чистый вариант — AppID,
// который выдают на api@myshows.me: для чтения он не обязателен, но с ним трафик отличают
// от чужого, и лимит для клиентов без AppID — около 100 запросов за 5 минут. Здесь их пять.
//
// Решение 2026-11-06: источник остаётся, AppID просим письмом на api@myshows.me (текст —
// scratch/myshows-appid-request.txt). Смысл перехода на TVmaze был бы не в законе, а в двух
// вещах: там условия использования публичные (бесплатный API, атрибуция и публичный лимит
// запросов — то есть разрешение есть словами), а здесь правила есть только для
// документированного JSON-RPC, и право на оценку — это право администрации на контент
// пользователей (п. 7.1 соглашения MyShows). Покрываемость при этом падает: по замеру
// 2026-11-06 все 13 карточек ленты пришли из myshows — там есть русское имя (на него работает
// приоритет), категория строки (show/anime/cartoon, на неё смотрит правило про мультсериалы) и
// фактическая дата серии; у TVmaze имени на русском нет, календаря по дате выхода тоже нет, и
// русские релизы (Нейровася, Таргет, Папины дочки) в индексе обычно отсутствуют. Если
// разрешение не дадут, оценку берём из TMDB/Kinopoisk, а от myshows остаётся только дата выхода
// серии — этого достаточно, чтобы окно собиралось одним запросом.

import netFetch, { netSummary } from '$lib/shared/net';
import netCache from '$lib/shared/netCache';
import { keyOf } from '$lib/shared/moscowDate';

const TIMEOUT_MS = 5000;
const ATTEMPTS = 3;
const BATCH_LIMIT = 10;   // правило пакета: больше 10 вызовов источник не принимает
const BATCH_PAUSE_MS = 1200;

// Название приложения — как просят правила: по нему источник отличает наш трафик.
const USER_AGENT = 'kinofree/1.0 (karusel "Series", JSON-RPC client)';

// Статусы, где за окно серия не выходила: это анонсы. Замер 2026-11-05: из 116 строк окна
// 80 Returning Series, 18 New Series, 9 Canceled/Ended (у закрытых шоу серии в окне всё равно
// были), 7 TBD/On The Bubble и 2 In Development. Последние два отсекаем — карусель показывает
// только то, что уже вышло.
const NOT_AIRIED = new Set(['TBD/On The Bubble', 'In Development']);

function pause(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(body) {
	const answer = await netFetch(
		['/api/myshows/', 'https://myshows.me/v3/rpc/'],
		{
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
			timeoutMs: TIMEOUT_MS,
			attempts: ATTEMPTS
		}
	);

	if (!answer.ok) return { ok: false, reason: netSummary('myshows', answer), data: null, cached: answer.cached };

	const data = answer.data;

	// Решение о повторе принимается по статусу ответа, тело ошибки показываем как есть.
	if (!Array.isArray(data) && data?.error) {
		return { ok: false, reason: `ответил ошибкой: ${data.error.message || 'ошибка'}`, data: null, cached: answer.cached };
	}

	return { ok: true, reason: '', data, cached: answer.cached };
}

// Строки окна выходов. Ответ дня кэшируется: строки приходят в порядке от самых свежих,
// поэтому очередь кандидатов можно строить прямо по ним, без отдельного поиска.
export async function windowRows(day, keys, force = false) {
	const body = {
		jsonrpc: '2.0',
		method: 'entity.releases',
		params: { entityType: 'show', startDate: keys.back, endDate: keys.day },
		id: 1
	};

	const answer = await netCache(`myshows:releases:${day}`, () => rpc(body), force);

	if (!answer.ok) return { ok: false, reason: answer.reason, rows: [] };

	const rows = [];

	// День выхода читаем из result: одиночный вызов JSON-RPC отвечает не самим днём, а
	// конвертом «{jsonrpc, id, result: [...]}» (замер 2026-11-05 через наш прокси — первый
	// элемент ответа содержит result, а releaseDate лежит внутри него). Без этого дня строка
	// окна теряла дату, не проходила отбор по странам, и календарь вообще не давал кандидатов:
	// замер 2026-11-05 — 119 строк окна, 95 по нужным странам, но в проходе ни одной, потому что
	// keyOf смотрел releaseDate у конверта и получал пусто. Поэтому каждый элемент сначала
	// разворачиваем, как это делает showsByIds.
	for (const item of Array.isArray(answer.data) ? answer.data : [answer.data]) {
		// result — список дней, а не один день: замер 2026-11-05, элемент ответа содержит result
		// с массивом «{releaseDate, shows}». Разбираем и массив, и одиночный объект, и случай,
		// когда прокси отдаёт уже готовый список дней.
		const entries = Array.isArray(item?.result) ? item.result : [item?.result || item];

		for (const entry of entries) {
			const releaseDay = keyOf(entry?.releaseDate);

			for (const show of entry?.shows || []) {
				if (!show?.id) continue;

				if (NOT_AIRIED.has(cleanText(show.status))) continue;

				rows.push({
					showId: show.id,
					day: releaseDay,
					title: cleanText(show.title),
					// В строке календаря имя оригинала называется titleOriginal (замер 2026-11-05),
					// поэтому берём и его, и короткое имя originalName — как в других ответах.
					titleOrig: cleanText(show.titleOriginal || show.originalName),
					year: cleanText(show.year),
					country: cleanText(show.country),
					status: cleanText(show.status),
					genre: genreName(show.genres?.[0]),
					// Список жанров и категория нужны правилу про мультипликационные сериалы:
					// первый жанр этой строки — «Боевик», и по нему тайтл не опознать.
					genres: genreList(show.genres),
					category: cleanText(show.category),
					rating: cleanText(show.rating),
					voted: cleanText(show.voted),
					alias: cleanText(show.alias)
				});
			}
		}
	}

	return { ok: rows.length > 0, reason: rows.length ? '' : 'окно пустое', rows, cached: answer.cached };
}

// Номера и серии по id шоу. Берём группами по 10 — больше пакет источник не принимает.
// withEpisodes нужен потому, что в строке календаря нет ни номера серии, ни номера Kinopoisk:
// номер серии берём из episodes по дате выхода, а плеер проверяем по номеру, а не по имени.
export async function showsByIds(day, ids, force = false) {
	const groups = [];

	for (let i = 0; i < ids.length; i += BATCH_LIMIT) groups.push(ids.slice(i, i + BATCH_LIMIT));

	const shows = new Map();
	const notes = [];

	for (const group of groups) {
		const body = group.map((id, index) => ({
			jsonrpc: '2.0',
			method: 'shows.GetById',
			params: { showId: id, withEpisodes: true },
			id: index + 1
		}));

		const answer = await netCache(`myshows:ids:${day}:${group.join(',')}`, () => rpc(body), force);

		if (!answer.ok) {
			notes.push(answer.reason);
			continue;
		}

		for (const item of Array.isArray(answer.data) ? answer.data : []) {
			const show = item?.result || item;

			if (!show?.id) continue;

			shows.set(show.id, {
				showId: show.id,
				title: cleanText(show.title),
				titleOrig: cleanText(show.originalName),
				alias: cleanText(show.alias),
				year: cleanText(show.year),
				country: cleanText(show.country),
				status: cleanText(show.status),
				genre: genreName(show.genres?.[0]),
				// Тот же полный список, что и в строке календаря: правило про мультсериалы
				// смотрит на все жанры тайтла, а не на первый.
				genres: genreList(show.genres),
				rating: cleanText(show.rating),
				kinopoiskId: cleanText(show.kinopoiskId),
				imdbId: cleanText(show.imdbId),
				tvrageId: cleanText(show.tvrageId),
				malId: cleanText(show.malId),
				episodes: Array.isArray(show.episodes) ? show.episodes : []
			});
		}

		// Пауза только после реальной сетевой работы: кэш дня отвечает мгновенно, и сон
		// при повторном заходе был бы лишним.
		if (!answer.cached && groups.length > 1) await pause(BATCH_PAUSE_MS);
	}

	return { ok: shows.size > 0, reason: notes.join('; '), shows };
}

// Серия, вышедшая в день строки календаря. В episodes номер есть только у рядовой серии,
// у спецвыпусков episodeNumber может быть пустым — такие строки не берём.
export function episodeOfShow(show, dayKey) {
	if (!show) return null;

	const aired = show.episodes.filter((episode) => keyOf(episode?.airDate) === dayKey && cleanText(episode?.episodeNumber));

	if (!aired.length) return null;

	const season = cleanText(aired[0].seasonNumber);

	return {
		season,
		number: cleanText(aired[0].episodeNumber),
		total: show.episodes.filter((episode) => cleanText(episode?.seasonNumber) === season).length,
		isSpecial: Boolean(aired[0].isSpecial)
	};
}

function cleanText(value) {
	return String(value ?? '').trim();
}

// Имя жанра. В ответах API жанры — список объектов {id, title, alias} (замер 2026-11-05 по
// showId 81574: genres[0] = {id: 4, title: 'Боевик', alias: 'action'}). cleanText(obj)
// превращает объект в "[object Object]", и это слово оседало в поле genre записей снимка:
// на карточке без строки серии блок печатает поле как есть. Поэтому имя берём из title,
// name оставляем запасным — в других ответах модуля жанр называется genre.
function genreName(value) {
	if (value && typeof value === 'object') return cleanText(value.title || value.name || value.genre);

	return cleanText(value);
}

// Полный список жанров строки, а не первый. Решение пользователя 2026-11-06: мультипликационные
// сериалы из «Сериалов» убираем совсем, и по первому жанру такой тайтл не опознать. Замер
// 2026-11-06 по строке календаря «Леди Баг и Супер-кот» (showId 44689): жанры — «Боевик, Детский,
// Комедия», первый жанр «Боевик», мультсериала в списке нет. Поэтому правило смотрит на весь
// список и на категорию строки (замер того же дня по 116 строкам окна: show 109, anime 6,
// cartoon 1 — у «Леди Баг» категория show, то есть одного myshows для таких карточек не хватает).
function genreList(value) {
	return (Array.isArray(value) ? value : []).map((item) => genreName(item)).filter(Boolean);
}

// Открытая база Shikimori: публичный API работает без ключей, и в нём есть дорамы.
// Ходим через nginx-прокси /api/shikimori/ (браузер не может читать ответ Shikimori
// напрямую из-за CORS, и API требует пользовательского агента).
import netFetch from './net';
import netCache from './netCache';
//
// Рабочее имя — shikimori.io: с этой машины shikimori.one не разрешается (NXDOMAIN),
// поэтому адрес берётся из прокси, а не из письма/документации.
//
// Про совпадение. Shikimori ищет по своим названиям, и имя дорамы в его базе редко
// совпадает с названием на doramatv: по запросу «Дом удобрений» Shikimori даёт «Дом, мой
// дом» — это другое произведение. Поэтому сравниваем три варианта имени — название
// плитки, оригинальное название из карточки и название без номера сезона («Тысячелетний
// господин 3» — «Тысячелетний господин») — и принимаем результат только когда одно из них
// совпадает или когда Shikimori выдал ровно одну запись. Иначе плеер показал бы чужое.
//
// Лимит Shikimori — 5 запросов в секунду и 90 в минуту, поэтому между запросами
// держим паузу: страница дорамы делает один запрос на ненайденное имя, и он не должен
// превратиться в серию быстрых запросов при переходах между плитками.
// Кэш держит только удачные ответы: неудача на холодном старте не должна решать за
// страницу, повтор после старта может пройти.
const MIN_INTERVAL_MS = 1200;

// Kodik отвечает только на аниме-записи Shikimori. Та же дорама бывает в базе как манга
// или манхва (kind cm, manhwa, manhua), и по такому id плеер ничего не покажет — поэтому
// берем только аниме-виды. Проверено живым запросом: 59005 (kind=ona) — found=true,
// 40016 (kind=cm) — found=false.
export const ANIME_KINDS = ['tv', 'movie', 'ova', 'oa', 'ona', 'special'];

let lastRequest = 0;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Название для сравнения: без регистра и пунктуации. */
function normalizeTitle(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** Название без номера сезона: «Тысячелетний господин 3» — «тысячелетний господин». */
function baseTitle(value) {
	return normalizeTitle(value).replace(/\s+(?:\d{1,3}|[ivxl]{1,5})$/, '');
}

/** Варианты имени, по которым сравниваем: тот же набор, что и в scripts/scrape-doramas.mjs. */
function titleCandidates(record) {
	const candidates = [{ value: normalizeTitle(record.title), label: 'название плитки' }];

	if (record.originalTitle) {
		candidates.push({
			value: normalizeTitle(record.originalTitle),
			label: 'оригинальное название'
		});
	}

	const base = baseTitle(record.title);
	if (base && base !== candidates[0].value) {
		candidates.push({ value: base, label: 'название без номера сезона' });
	}

	return candidates;
}

/**
 * Поиск по названию дорамы. Принимает запись ({ title, originalTitle }) или просто строку.
 * Возвращает { ok, label, id, name, kind, exact, note }. ok — только когда одно из имён
 * совпало или Shikimori выдал одну запись; при близком результате id не отдаём, чтобы
 * плеер не показал чужое произведение.
 */
export async function shikimoriSearchByTitle(input, force = false) {
	const record = typeof input === 'string' ? { title: input } : input || {};
	const candidates = titleCandidates(record);
	const cacheKey = candidates.map((candidate) => candidate.value).join('|');

	if (!candidates[0].value) return null;

	return netCache(`shikimoriTitle:${cacheKey}`, () => run(candidates), force);
}

async function run(candidates) {
	const wait = MIN_INTERVAL_MS - (Date.now() - lastRequest);
	if (wait > 0) await sleep(wait);
	lastRequest = Date.now();

	try {
		// Ищем по первому варианту; оригинальное название — второй запрос, только если
		// первый ничего не дал и он действительно отличается.
		const results = await search(candidates[0].value);

		if (!results.length && candidates.length > 1) {
			const byOriginal = await search(candidates[1].value);
			if (byOriginal.length) return pick(byOriginal, candidates);
		}

		return pick(results, candidates);
	} catch (error) {
		return {
			ok: false,
			label: 'сеть',
			retry: true,
			note: `Shikimori API ${error?.message || 'не ответил'} (сеть или DNS)`
		};
	}
}

async function search(term) {
	// Таймаут обязателен: без него висящий запрос оставлял страницу дорамы со статусом
	// «поиск» навсегда, и плеер никогда не показывал результат.
	const answer = await netFetch(`/api/shikimori/animes?search=${encodeURIComponent(term)}&limit=3`, {
		timeoutMs: 12000,
		attempts: 3
	});

	if (!answer.ok) throw new Error(answer.notes?.join(' · ') || answer.reason || 'не ответил');

	return Array.isArray(answer.data) ? answer.data : [];
}

/**
 * Оценка и постер из ответа поиска. Добавляем их и в отказах: карусель AnimeGO открывает
 * то, что дал поиск (по условию пользователя), и эти поля ей нужны даже когда совпадение
 * не точное. ok при этом не меняем — поведение страницы дорамы остаётся прежним.
 */
function extra(hit) {
	// В ответе Shikimori оценка приходит строкой («7.76»), поэтому приводим к числу:
	// поле PocketBase number и сравнение цветов работают с числом.
	return {
		score: Number.isFinite(Number(hit.score)) ? Number(hit.score) : 0,
		// Постер в ответе — относительный путь; без origins браузер его не покажет.
		poster: hit.image?.preview ? `https://shikimori.io${hit.image.preview}` : ''
	};
}

function pick(results, candidates) {
	if (!results.length) {
		return { ok: false, label: 'не найден', note: 'Shikimori не нашёл дораму по названию' };
	}

	const hit = results.find((item) => {
		const names = [normalizeTitle(item.russian), normalizeTitle(item.name)];
		return candidates.some((candidate) => names.includes(candidate.value));
	});

	const candidate = hit
		? candidates.find((item) =>
				[normalizeTitle(hit.russian), normalizeTitle(hit.name)].includes(item.value)
			)
		: null;

	if (!hit) {
		const best = results[0];
		return {
			ok: false,
			label: 'не найден',
			// id и поля ответа сохраняем: карусель по этому id открывает первое, что
			// нашёл поиск; dorama-страница по-прежнему смотрит на ok.
			id: String(best.id),
			kind: best.kind || '',
			...extra(best),
			note: `Shikimori предложил «${best.russian || best.name}» — это другая запись, её не используем`
		};
	}

	// Имя совпало, но запись может быть мангой или манхвой: Kodik её не играет, и плеер
	// показал бы пустую вкладку. Об этом и пишет скрипт scrapedb (совпало но не аниме).
	if (!ANIME_KINDS.includes(hit.kind)) {
		return {
			ok: false,
			label: 'не найден',
			// kind здесь не аниме — по такому id плеер ничего не покажет, поэтому
			// карусель использует id только при совместимом kind.
			id: String(hit.id),
			kind: hit.kind || '',
			...extra(hit),
			note: `Shikimori предложил «${hit.russian || hit.name}» — это не аниме (${hit.kind}), Kodik такие записи не играет`
		};
	}

	const result = {
		ok: true,
		label: 'ok',
		id: String(hit.id),
		name: hit.russian || hit.name,
		kind: hit.kind || '',
		...extra(hit),
		exact: candidate?.label === 'название плитки',
		note: `${candidate?.label || 'совпадение'}: ${hit.russian || hit.name}`
	};

	// Кэш держит caller (netCache) и только удачные ответы.
	return result;
}

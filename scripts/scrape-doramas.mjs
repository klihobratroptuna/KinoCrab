#!/usr/bin/env node
/**
 * Скрапер дорам -> PocketBase (коллекция `dorama_releases`).
 *
 * Источник — страница списка https://2.doramatv.red/list?sortType=DATE_CREATE. Автоматическим
 * запросам этот домен отвечает «NOT FOUND», поэтому скрипт ходит на рабочее зеркало того же
 * сайта — https://m.doramatv.one (ссылка на него есть в шапке сайта). Зеркало меняется через
 * DORAMATV_URL или --base.
 *
 * Про даты. На странице списка даты нет: там только плитки (id, slug, постер, название) и
 * порядок сортировки по дате добавления. Дату релиза берём из карточки дорамы — блок
 * cr-frequency-details со строкой «Дата начала». Значит на одну новую дораму приходится
 * два запроса: список (1 запрос = 50 плиток) и карточка (1 запрос = 1 дорама). Дату пишем
 * один раз — записям с датой карточку больше не читаем, поэтому дежурный режим стоит почти
 * ничего: только действительно новые дорамы.
 *
 * Сохраняем только факты: id, slug, название, ссылка на постер, дата, статус и тип. Тексты
 * описаний с сайта скрипт не читает и не пишет.
 *
 * Про id для плееров. Номера фильма в Kinopoisk у дорам в источнике нет, поэтому Alloha и
 * Collaps их не находят. Id даёт Shikimori, который считает дорамы обычными записями аниме:
 * по названию находим id записи, а в её externalLinks вид `kinopoisk` — это ссылка вида
 * https://www.kinopoisk.ru/series/382731/, номер из неё и есть kinopoiskId. По id Shikimori
 * работает и Kodik (get-player), поэтому поле shikimoriId тоже полезно. Поля заполняем только
 * там, где их ещё нет (--fill-ids), и отдельным бюджетом: Shikimori разрешает 5 запросов в
 * секунду и 90 в минуту, шаг стоит ровно один запрос на дораму.
 *
 * Про id Kodik (--fill-kodik). Shikimori знает только те работы, которые сам описывает, и
 * дорамы из списка doramatv часто отсутствуют в его базе — для них шаг --fill-ids ничего не
 * даёт. Kodik же находит материал по названию: результат поиска — это id записи вида
 * serial-77852, и по нему get-player отвечает плеером. Этот id и есть kodikId, и он работает
 * даже там, где Shikimori ничего не знает (проверено: поиск по названию -> get-player ->
 * found=true). Поиск Kodik принимает только личный токен KODIK_TOKEN, поэтому шаг нужен
 * скраперу; сама страница по kodikId играет без поиска.
 *
 * Про совпадение имени. Shikimori ищет по своим названиям, и имя дорамы в его базе редко
 * совпадает с названием на doramatv, поэтому сравниваем три варианта: имя из плитки,
 * оригинальное название из карточки («Оригинальное название», фактическое поле) и имя без
 * номера сезона («Тысячелетний господин 3» -> «Тысячелетний господин»). Принимаем только
 * совпадение или единственный результат и пишем, как именно совпало (matchNote). Поиск по
 * оригинальному имени — второй запрос, только если первый по имени источника ничего не дал.
 * Это же правило держим для поиска Kodik: единственный результат поиска мог бы быть чужой
 * дорамой с похожим названием, поэтому без совпадения имени id не пишем.
 *
 * Про ключ по имени (--fill-name-key). Поле nameKey — имя в виде сравнения (тот же
 * normalizeTitle, что в $lib/shared/nameIndex.js), и по нему работает индекс
 * dorama_releases_name_key_idx. Фильтр `title~"..."` — это LIKE '%значение%', а индекс для LIKE
 * не используется, поэтому точное равенство nameKey="..." — тот путь, который его реально
 * применяет. Скрипт пишет ключ для каждой новой записи и отдельным шагом чинит ключи у старых:
 * 157 записей ключа не имели, шаг --fill-name-key заполнил их (2026-10-31). Шаг только читает
 * и пишет в PocketBase, к сайту не обращается, поэтому его можно держать в дежурном цикле.
 *
 * Почему совпадений мало. Список источника смешивает сериалы с вебтунами, и Shikimori знает
 * эти работы как мангу/манхву, а не как аниме. Kodik играет только аниме-записи: по id манхвы
 * get-player отвечает found=false (проверено на двух id), поэтому искать по разделу mangas
 * бессмысленно — совпадение было бы, а плеера бы не было. Поэтому шаг --fill-ids принимает
 * только аниме-вид записей и пишет в лог, где имя совпало, но запись не аниме.
 *
 * Использование:
 *   node --env-file=.env scripts/scrape-doramas.mjs --dry-run                 # только разбор
 *   node --env-file=.env scripts/scrape-doramas.mjs --pages 2                 # один проход
 *   node --env-file=.env scripts/scrape-doramas.mjs --watch --pages 2 --interval 900
 *   node --env-file=.env scripts/scrape-doramas.mjs --limit 20                # максимум записей
 *   node --env-file=.env scripts/scrape-doramas.mjs --fill-ids --shikimori-limit 25   # id Shikimori/Kinopoisk для записей без них
 *   node --env-file=.env scripts/scrape-doramas.mjs --fill-ids --original-limit 10    # карточки ради оригинального названия
 *   node --env-file=.env scripts/scrape-doramas.mjs --fill-only --fill-ids            # только шаг id, список не читаем
 *   node --env-file=.env scripts/scrape-doramas.mjs --fill-kodik --kodik-limit 30    # id Kodik по названию (нужен KODIK_TOKEN)
 *   node --env-file=.env scripts/scrape-doramas.mjs --fill-only --fill-ids --fill-kodik  # оба шага, список не читаем
 *   node --env-file=.env scripts/scrape-doramas.mjs --fill-only --fill-name-key           # только ключи по имени (PocketBase, сети не трогает)
 *
 * Авторизация в PocketBase (для записи): PB_EMAIL / PB_PASSWORD, PB_URL по умолчанию http://localhost:8090.
 */
const BASE = (process.env.DORAMATV_URL || 'https://m.doramatv.one').replace(/\/+$/, '');
const UA =
	process.env.DORAMATV_USER_AGENT ||
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const PB_URL = process.env.PB_URL || 'http://localhost:8090';
const COLLECTION = 'dorama_releases';
const CAROUSEL = 'drama_carousel';
// На странице списка ровно 50 плиток, дальше — offset=50, offset=100 и так далее.
const PER_PAGE = 50;
// Kodik API: токен берём из KODIK_TOKEN (тот же, что подставляет nginx-прокси /api/kodik/).
const KODIK_API = (process.env.KODIK_API_URL || 'https://kodik-api.com').replace(/\/+$/, '');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
	const i = args.indexOf(flag);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const pages = clampInt(valueOf('--pages', 2), 1, 40);
const delayMs = clampInt(valueOf('--delay', 1200), 0, 60000);
const limit = clampInt(valueOf('--limit', 0), 0, 500);
const dryRun = has('--dry-run');
const watch = has('--watch');
const intervalMin = clampInt(valueOf('--interval', 900), 1, 1440);
// Запросов к сайту за один цикл: страницы списка + карточки новых дорам.
const budget = clampInt(valueOf('--budget', 60), 1, 300);
const dailyBudget = clampInt(valueOf('--daily-budget', 200), 1, 1000);
// Шаг id для плееров (--fill-ids): отдельный бюджет, потому что это запросы к Shikimori,
// а не к doramatv. Shikimori разрешает 5 запросов в секунду и 90 в минуту.
// --shikimori-limit: записей за цикл, --shikimori-budget: запросов за цикл,
// --shikimori-daily: запросов за сутки (на этот шаг).
const fillIds = has('--fill-ids');
const fillOnly = has('--fill-only');
const shikimoriLimit = clampInt(valueOf('--shikimori-limit', 25), 1, 200);
const shikimoriBudget = clampInt(valueOf('--shikimori-budget', 25), 1, 300);
const shikimoriDaily = clampInt(valueOf('--shikimori-daily', 60), 1, 300);
// Карточек ради оригинального названия за цикл: это запросы к doramatv, поэтому отдельный
// маленький лимит — дежурный цикл не должен вычитать по одной карточке на каждую запись.
const originalLimit = clampInt(valueOf('--original-limit', 10), 0, 100);
// Шаг Kodik (--fill-kodik): поиск по названию по личному токену KODIK_TOKEN — тот путь,
// который работает для дорам без записи Shikimori. Своего лимита Kodik не объявляет, поэтому
// бюджет держим сами: записей за цикл, записей за сутки и пауза между запросами.
const fillKodik = has('--fill-kodik');
const kodikLimit = clampInt(valueOf('--kodik-limit', 20), 1, 200);
const kodikDaily = clampInt(valueOf('--kodik-daily', 60), 1, 500);
const kodikDelayMs = clampInt(valueOf('--kodik-delay', 700), 0, 60000);
// --fill-name-key: заполняет nameKey — поле-ключ по имени, по которому работает индекс
// dorama_releases_name_key_idx. Пишет только в PocketBase, к doramatv не обращается.
const fillNameKey = has('--fill-name-key');
// Регистрация в календаре тайтлов карусели, которых нет у источника. Шаг включён по
// умолчанию: если дорамы нет в списке doramatv, карточка карусели — единственное, что о ней
// известно, и без записи на нашем сайте у тайтла индекса нет (карточка ведёт на сторонний
// сайт). --no-register выключает шаг.
const registerCarousel = !has('--no-register');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clampInt(value, min, max) {
	const number = Number.parseInt(value, 10);
	return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

/** Сколько миллисекунд ждать до полуночи — там же обнуляется суточный счётчик запросов. */
function msUntilMidnight(now = new Date()) {
	const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
	const midnight = Date.parse(`${tomorrow}T00:00:00Z`);
	return Math.max(0, midnight - now.getTime());
}

/** Суточный счётчик запросов: при исчерпании цикл останавливается и ждёт полуночи. */
let requestsToday = 0;
let quotaHit = false;
let quotaDay = new Date().toISOString().slice(0, 10);

function countRequest() {
	const day = new Date().toISOString().slice(0, 10);
	if (day !== quotaDay) {
		quotaDay = day;
		requestsToday = 0;
		quotaHit = false;
	}
	requestsToday++;
	if (requestsToday >= dailyBudget) quotaHit = true;
}

/* ---------------------- Shikimori: id для страниц плеера ---------------------- */

// Домен shikimori.one автоматическим запросам здесь не отвечает (NXDOMAIN), работает
// shikimori.io — тот же API, что использует scripts/scrape-anime.mjs. Shikimori просит
// названный User-Agent, поэтому его можно задать через SHIKIMORI_USER_AGENT.
const GRAPHQL_URL = 'https://shikimori.io/api/graphql';
const SHIKI_UA = process.env.SHIKIMORI_USER_AGENT || 'kinofree/1.0 (scripts/scrape-doramas.mjs)';

// Суточный счётчик запросов к Shikimori — отдельный, чтобы не смешивать его с doramatv.
let shikiToday = 0;
let shikiQuotaHit = false;
let shikiDay = new Date().toISOString().slice(0, 10);

function countShiki() {
	const day = new Date().toISOString().slice(0, 10);
	if (day !== shikiDay) {
		shikiDay = day;
		shikiToday = 0;
		shikiQuotaHit = false;
	}
	shikiToday++;
	if (shikiToday >= shikimoriDaily) shikiQuotaHit = true;
}

/** Название для сравнения: без регистра и пунктуации, чтобы «Истинная красота» совпала. */
function normalizeTitle(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Имя без номера сезона: «Тысячелетний господин 3» -> «тысячелетний господин». Shikimori
 * часто ведёт всё произведение одной записью, и номер сезона в названии дорамы мешает
 * совпадению. Римские номера тоже срезаем («... II»). Год срезаем первым: имена Kodik
 * приходят без года («Идеальная работа»), а карусельное имя с годом и сезоном
 * («Идеальная работа 1 Сезон (2026)») без среза года не совпадает.
 */
function baseTitle(value) {
	return normalizeTitle(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s+(?:\d{1,3}|[ivxl]{1,5})$/, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Имя карточки карусели без суффикса сезона и года: «Баларао 1 Сезон (2026)» -> «баларао».
 * Правило то же, что в $lib/shared/nameIndex.js (shortNameOf), иначе ключ скрапера не
 * совпадёт с ключом, по которому ищет фронтенд, и индекс не будет использован.
 */
function shortNameKey(value) {
	return normalizeTitle(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Транслитерация родного названия в латиницу — третий вариант имени для поиска. Kodik
 * хранит оригинальные названия в транслитерации, поэтому запрос родным письмом ему ничего
 * не даёт: «Левиафан» находит запись, «레비아판» — пусто, «Leviathan» находит ту же запись
 * (проверено запросами). Здесь только корейский (RRK) и японский (Хепбёрн): китайский без
 * словаря пиньинь не превратить, поэтому иероглифы пропускаем. Возвращает пустую строку,
 * если транслитерировать нечего (название уже латиницей).
 */
// Порядок совпадает с блоками Unicode: начальные ᄀ–ᄒ (19), средние ᅡ–ᅵ (21),
// конечные ᆧ–ᇂ (28, первый — без финали). Значения по RRK.
const KO_INITIAL = [
	'g', 'kk', 'n', 'd', 'dd', 'r', 'm', 'b', 'pp', 's', 'ss', 'ng', 'j', 'jj', 'ch',
	'k', 't', 'p', 'h'
];
const KO_MEDIAL = [
	'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo',
	'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'
];
const KO_FINAL = [
	'', 'k', 'kk', 'k', 'n', 'n', 'h', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'l', 'l',
	'p', 'p', 's', 's', 'ng', 'n', 'm', 'ng', 'ng', 'ng', 'ng', 'h'
];

// Отдельные знаки хангыля без слога (блок совместимости U+3131–U+318E).
const KO_JAMO = {
	'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 't', 'ㄸ': 'dd', 'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b',
	'ㅃ': 'pp', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': 'ng', 'ㅈ': 'j', 'ㅉ': 'jj', 'ㅊ': 'ch', 'ㅋ': 'k',
	'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h',
	'ㅏ': 'a', 'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo', 'ㅔ': 'e', 'ㅕ': 'yeo',
	'ㅖ': 'ye', 'ㅗ': 'o', 'ㅘ': 'wa', 'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅛ': 'yo', 'ㅜ': 'u',
	'ㅝ': 'wo', 'ㅞ': 'we', 'ㅟ': 'wi', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅢ': 'ui', 'ㅣ': 'i'
};

const JA = {
	あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
	か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
	が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
	さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
	ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
	た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
	だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
	な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
	は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
	ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
	ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
	ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
	や: 'ya', ゆ: 'yu', よ: 'yo',
	ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
	わ: 'wa', ん: 'n',
	'ゎ': 'wa', 'ゕ': 'ka', 'ゖ': 'ke', 'ヴ': 'bu'
};

function romanize(value) {
	const text = String(value || '');
	const parts = [];

	for (const ch of text) {
		const code = ch.codePointAt(0);

		// Слог хангыля — это формула из начального, среднего и конечного джамо.
		if (code >= 0xac00 && code <= 0xd7a3) {
			const syllable = code - 0xac00;
			const initial = Math.floor(syllable / 588);
			const medial = Math.floor((syllable % 588) / 28);
			const final = syllable % 28;
			parts.push(
				(KO_INITIAL[initial] ?? '') + (KO_MEDIAL[medial] ?? '') + (KO_FINAL[final] ?? '')
			);
			continue;
		}

		// Отдельные джамо (без слога), как в «오가»: смотрим в таблицу согласных и гласных.
		if (KO_JAMO[ch]) {
			parts.push(KO_JAMO[ch]);
			continue;
		}

		// Катакана — тот же ряд, что и хирагана, со сдвигом блока 0x60: приводим к хирагане
		// и смотрим в таблицу.
		const hiragana = code >= 0x30a1 && code <= 0x30fa ? String.fromCodePoint(code - 0x60) : ch;
		if (JA[hiragana]) {
			parts.push(JA[hiragana]);
			continue;
		}

		// Долгая гласная в катакане: удваиваем предыдущую, иначе просто u.
		if (ch === 'ー') {
			const previous = parts.length ? parts[parts.length - 1].slice(-1) : '';
			parts.push('aeiou'.includes(previous) ? previous : 'u');
			continue;
		}

		// Сёто (小つ) читают как t перед согласной.
		if (ch === 'っ' || ch === 'ッ') {
			parts.push('t');
			continue;
		}

		parts.push(ch);
	}

	const roman = parts.join('');
	return roman === text ? '' : roman;
}

/**
 * Набор названий, по которым сравниваем: имя из плитки, оригинальное название из карточки
 * и имя без номера сезона. Возвращает вариант с подписью — matchNote пишется в запись, чтобы
 * на странице было видно, насколько совпадение надёжное.
 */
function titleCandidates(record, originalTitle) {
	const candidates = [{ value: normalizeTitle(record.title), label: 'имя из списка' }];

	if (originalTitle)
		candidates.push({ value: normalizeTitle(originalTitle), label: 'оригинальное название' });

	const base = baseTitle(record.title);
	if (base && base !== candidates[0].value) {
		candidates.push({ value: base, label: 'имя без номера сезона' });
	}

	// Четвёртый вариант — транслитерация родного названия. Он нужен для поиска Kodik,
	// который хранит оригинальные имена латиницей.
	const roman = romanize(originalTitle);
	if (roman) {
		const value = normalizeTitle(roman);
		if (value && !candidates.some((candidate) => candidate.value === value)) {
			candidates.push({ value, label: 'транслитерация' });
		}
	}

	return candidates;
}

function kinopoiskIdFromLinks(links) {
	const link = (links || []).find((item) => item?.kind === 'kinopoisk');
	return link?.url?.match(/(?:film|series|cartoon|tv_show)\/(\d+)/)?.[1] ?? '';
}

async function gql(query) {
	for (let attempt = 1; attempt <= 4; attempt++) {
		if (shikiQuotaHit) throw new Error('лимит Shikimori на сутки исчерпан');

		const res = await fetch(GRAPHQL_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': SHIKI_UA },
			body: JSON.stringify({ query })
		});
		countShiki();

		if (res.status === 429) {
			console.warn(`  Shikimori rate limit (попытка ${attempt}), пауза 15 c`);
			await sleep(15000);
			continue;
		}

		if (!res.ok)
			throw new Error(`GraphQL -> HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);

		const data = await res.json().catch(() => null);
		if (data?.errors?.length) throw new Error(`GraphQL: ${data.errors[0].message}`);
		return data?.data?.animes || [];
	}

	throw new Error('GraphQL Shikimori: слишком много попыток из-за rate limit');
}

/**
 * Результат поиска по названию принимаем, если он совпадает с одним из наших вариантов
 * (или Shikimori выдал ровно одну запись): иначе можно получить чужое произведение и
 * записать неверный id, по которому плеер покажет не то. JSON.stringify здесь вместо
 * кавычек GraphQL-строки — он же экранирует кавычки внутри названий.
 */
// Kodik отвечает плеером только на аниме-записи Shikimori. Проверено запросом: id 40016
// (kind=cm, манга) -> found=false, id 59005 (kind=ona) -> found=true. Поэтому запись
// другого вида не принимаем: id был бы записан, а плеер по нему ничего не нашёл.
const ANIME_KINDS = ['tv', 'movie', 'ova', 'oa', 'ona', 'special'];

function pickMatch(found, candidates) {
	if (!found.length) return null;

	for (const item of found) {
		const names = [normalizeTitle(item.russian), normalizeTitle(item.name)];
		const hit = candidates.find((candidate) => names.includes(candidate.value));

		if (hit) return { item, note: `совпало: ${hit.label}` };
	}

	return found.length === 1 ? { item: found[0], note: 'единственный результат' } : null;
}

async function shikimoriMatch(searchTerm, candidates) {
	// kind обязателен в выборке: без него pickMatch не видит вид записи (manhwa/манга
	// приходят как anime-записи Shikimori), и Kodik по такому id ничего не отдаёт.
	const query = `{ animes(search: ${JSON.stringify(searchTerm)}, limit: 3) { id name russian url kind externalLinks { kind url } } }`;
	return pickMatch(await gql(query), candidates);
}

/* --------------------------- Kodik: id записи для плеера --------------------------- */

// Kodik просит токен в query и выдаёт id записи вида serial-77852. По такому id get-player
// отвечает плеером даже по публичному токену скрипта, поэтому поиск нужен только здесь —
// один раз, чтобы записать id, а страница играет без поиска.
const KODIK_UA = process.env.KODIK_USER_AGENT || 'kinofree/1.0 (scripts/scrape-doramas.mjs)';
// Отметка в kodikNote: Kodik проверяли и такой записи нет. Без неё дежурный цикл каждый раз
// искал бы дораму заново.
const KODIK_MISS = 'Kodik: проверяли, записи нет';

// Суточный счётчик запросов к Kodik — отдельный от doramatv и Shikimori.
let kodikToday = 0;
let kodikQuotaHit = false;
let kodikDay = new Date().toISOString().slice(0, 10);

function countKodik() {
	const day = new Date().toISOString().slice(0, 10);
	if (day !== kodikDay) {
		kodikDay = day;
		kodikToday = 0;
		kodikQuotaHit = false;
	}
	kodikToday++;
	if (kodikToday >= kodikDaily) kodikQuotaHit = true;
}

/**
 * Поиск Kodik по названию. Параметр называется ровно `title`: keyword, name, q, search и
 * query API отвечает 400 «Не указан хотя бы один параметр для поиска» — проверено запросом.
 * Фильтр types не ставим: dorama — неверный тип («Неправильный тип»), дорамы лежат в
 * foreign-serial и foreign-movie, поэтому ищем без фильтра по всем типам. Поиск принимает
 * только личный токен: публичный токен скрипта плееров отвечает на search 401.
 */
async function kodikSearchByTitle(searchTerm) {
	const token = process.env.KODIK_TOKEN || '';

	if (!token) throw new Error('Kodik search: KODIK_TOKEN не задан');

	const url = `${KODIK_API}/search?${new URLSearchParams({ token, title: searchTerm, limit: '3' })}`;

	for (let attempt = 1; attempt <= 4; attempt++) {
		if (kodikQuotaHit) throw new Error('лимит Kodik на сутки исчерпан');

		let res;

		try {
			res = await fetch(url, {
				headers: { Accept: 'application/json', 'User-Agent': KODIK_UA },
				signal: AbortSignal.timeout(30000)
			});
			countKodik();
		} catch (error) {
			// Соединение до kodik-api.com из контейнера рвётся (замер 2026-10-31:
			// UND_ERR_CONNECT_TIMEOUT на большинстве запросов). Это не «не найдено»,
			// поэтому повторяем попытку и ничего не записываем.
			console.warn(`  Kodik network (попытка ${attempt}): ${error.message || error}`);
			await sleep(1500 * attempt);
			continue;
		}

		if (res.status === 429) {
			console.warn(`  Kodik rate limit (попытка ${attempt}), пауза 5 c`);
			await sleep(5000);
			continue;
		}

		if (res.status === 401) throw new Error('Kodik search: HTTP 401 — токен не подходит для поиска');

		if (!res.ok)
			throw new Error(`Kodik search -> HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);

		const data = await res.json().catch(() => null);
		return data?.results || [];
	}

	throw new Error('Kodik search: слишком много попыток из-за rate limit');
}

/** Имена записи Kodik для сравнения: title, original_title (он же title_orig) и
 * other_title. Other_title — список альтернативных названий через слеш, и наше имя часто
 * стоит именно там: замер 2026-10-31, «Спасительный рецепт маленького города» (kp 14730352)
 * → запись Kodik названа «Рецепт для маленького городка», а наше имя — вариант в other_title.
 * Значит список нужно разбирать, а не сравнивать целиком. */
function kodikNames(item) {
	const names = [];

	for (const value of [item?.title, item?.original_title || item?.title_orig, item?.other_title]) {
		for (const part of String(value || '').split('/')) {
			const name = normalizeTitle(part);

			if (name) names.push(name);
		}
	}

	return names;
}

/**
 * Совпадение с Kodik: принимаем только совпадение имени. Раньше здесь был второй путь —
 * «единственный результат», и он давал чужие записи: замер по живому дню карусели
 * 2026-10-31, «Богатое будущее 1 Сезон (2026)» -> movie-33039 (мультфильм «Мирай из
 * будущего», 2018), «Любовь со львом 1 Сезон (2026)» -> movie-62690 («Остров», 2022).
 * Поисковый ответ Kodik близкий, поэтому одиночный результат без совпадения имени — это
 * угадывание, и мы его не принимаем: возвращаем, что именно предложил поиск.
 */
function pickKodikMatch(found, candidates) {
	if (!found.length) return null;

	for (const item of found) {
		const names = kodikNames(item);
		const hit = candidates.find((candidate) => names.includes(candidate.value));

		if (hit) return { item, note: `совпало: ${hit.label}` };
	}

	const best = found[0];

	return {
		offer: `Kodik предложил «${best.title || 'без названия'}» (${best.year || 'год неизвестен'}, kp ${best.kinopoisk_id || 'нет'}) — это другая запись, её не используем`
	};
}

async function fetchHtml(url) {
	if (quotaHit) throw new Error('суточный лимит запросов исчерпан');

	const res = await fetch(url, {
		headers: {
			'User-Agent': UA,
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'ru-RU,ru;q=0.9'
		}
	});
	countRequest();

	if (res.status === 429) throw new Error(`rate limit: HTTP ${res.status}`);
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);

	return res.text();
}

/**
 * Плитка списка: class="tile col-sm-6 el_<id>", внутри ссылка на slug, постер в data-original
 * (картинка подгружается по lazy) и короткие подписи статуса/типа в span class="manga...".
 * Возвращаем только атрибуты — текст описания плитки нас не интересует.
 */
function parseTiles(html) {
	const tiles = [];

	for (const chunk of html.split(/class=["']tile col-sm-6[^"']*["']/g).slice(1)) {
		const id = chunk.match(/el_(\d+)/)?.[1] || chunk.match(/data-id=["'](\d+)["']/)?.[1];
		const slug = chunk.match(/href=["'](\/[a-z0-9_]{4,})["']/)?.[1] || '';
		const poster = chunk.match(/data-original=["']([^"']+)["']/)?.[1] || '';
		const img = chunk.match(/<img[^>]{0,300}/)?.[0] || '';
		// Название — alt постера (это имя произведения). Атрибут title= на плитке занят
		// рейтингом вида title="0.0", поэтому на него опираться нельзя.
		const title = img.match(/alt=["']([^"']{1,120})["']/)?.[1] || '';
		const signs = [...chunk.matchAll(/class=["']manga[A-Za-z]+["'][^>]*>([^<]{1,40})/g)]
			.map((match) => match[1].trim())
			.filter(Boolean);

		if (!id || !slug || !title) continue;

		tiles.push({
			doramatvId: id,
			slug: slug.replace(/^\//, ''),
			title,
			poster,
			// Первая подпись — статус перевода, вторая — тип (фильм, онгоинг и так далее).
			status: signs[0] || '',
			kind: signs[1] || '',
			sourceUrl: `${BASE}${slug}`
		});
	}

	return tiles;
}

/**
 * Дата из карточки: блок cr-frequency-details со строкой «Дата начала». Класс пишется с
 * модификаторами (например cr-frequency-details__item--days), поэтому ищем начало класса,
 * а не точное совпадение. Если такого блока нет, берём первое значение dd.mm.yyyy где-нибудь
 * в карточке, потом ISO-дату. Запись без даты всё равно полезна (id, постер, ссылка), но в
 * недельный календарь она не попадёт.
 */
function parseCardDate(html) {
	const block =
		html.match(/class=["']cr-frequency-details__item[^"']*["'][^>]*>([\s\S]{0,200})/)?.[1] || '';
	const ru = block.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
	if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;

	const anywhere = html.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
	if (anywhere) return `${anywhere[3]}-${anywhere[2]}-${anywhere[1]}`;

	// На случай, если карточка отдаёт дату в ISO-формате.
	return html.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)?.[0] || '';
}

/**
 * Оригинальное название из карточки — блок «Оригинальное название» и значение в div class="py-1".
 * Это фактическое поле карточки, не описание: описание скрипт по-прежнему не читает и не пишет.
 */
function parseCardOriginal(html) {
	const value =
		html.match(/Оригинальное название<\/h5>\s*<div class="py-1">([^<]{1,120})<\/div>/i)?.[1] || '';

	return value.replace(/\s+/g, ' ').trim();
}

/* ----------------------------- PocketBase-часть ------------------------------ */

/** PocketBase отдаёт дату как "YYYY-MM-DD HH:mm:ss", сравниваем только день. */
function dateOnly(value) {
	return String(value || '').slice(0, 10);
}

function sameRecord(existing, data) {
	if (!existing) return false;

	return (
		(existing.title || '') === data.title &&
		(existing.poster || '') === data.poster &&
		dateOnly(existing.date) === data.date &&
		(existing.slug || '') === data.slug &&
		(existing.status || '') === data.status &&
		(existing.kind || '') === data.kind &&
		(existing.originalTitle || '') === (data.originalTitle || '') &&
		(existing.sourceUrl || '') === data.sourceUrl &&
		(existing.nameKey || '') === (data.nameKey || '')
	);
}

async function main() {
	let pb = null;
	if (!dryRun) {
		// Импорт только когда реально пишем: dry-run работает и без node_modules.
		const PocketBase = (await import('pocketbase')).default;
		pb = new PocketBase(PB_URL);

		if (!process.env.PB_EMAIL || !process.env.PB_PASSWORD) {
			throw new Error('Для записи нужны PB_EMAIL и PB_PASSWORD (учётка superuser PocketBase)');
		}
		// С 0.23 superuser — это коллекция "_superusers"; старые namespace уже не работают.
		await pb
			.collection('_superusers')
			.authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);
	}

	const stats = {
		created: 0,
		updated: 0,
		skipped: 0,
		processed: 0,
		requests: 0,
		shikiRequests: 0,
		shikiFilled: 0,
		shikiMissed: 0,
		shikiNotAnime: 0,
		originalFetched: 0,
		kodikRequests: 0,
		kodikFilled: 0,
		kodikMissed: 0,
		nameKeyUpdated: 0,
		registered: 0
	};

	function report(label) {
		console.log(
			`\n${label}: создано ${stats.created}, обновлено ${stats.updated}, пропущено ${stats.skipped}` +
				` (запросов ${stats.requests})` +
				`${dryRun ? ' — dry-run, ничего не записано' : ''}` +
				` — за сутки ${requestsToday} из ${dailyBudget}`
		);
	}

	/** Значение для фильтра в одинарных кавычках: экранируем кавычку внутри имени. */
	function q(value) {
		return String(value || '').replace(/'/g, "\\'");
	}

	/**
	 * Одна дорама. PocketBase 0.40.6 не отвечает на /records/first — проверено живым
	 * запросом: этот путь клиента pocketbase 0.21.5 отвечает 404 даже без фильтра,
	 * поэтому ищем список с фильтром и perPage: 1. Параметр называется ровно `perPage`:
	 * с `per_page` сервер отвечает perPage=30, то есть игнорирует его. Строковые значения
	 * держим в одинарных кавычках — так описан строковый литерал в синтаксисе фильтров.
	 */
	async function findRecord(id) {
		const list = await pb
			.collection(COLLECTION)
			.getFullList({ filter: `doramatvId='${id}'`, perPage: 1 });
		return list[0] ?? null;
	}

	/** Запись по ключу имени (работает индекс); используется, чтобы не плодить дубликаты. */
	async function findRecordByKeys(keys) {
		for (const key of keys.filter(Boolean)) {
			const hits = await pb
				.collection(COLLECTION)
				.getFullList({ filter: `nameKey = '${q(key)}'`, perPage: 5 })
				.catch(() => []);

			const hit = hits.find((record) => normalizeTitle(record.title) === key);

			if (hit) return hit;
		}

		return null;
	}

	async function upsert(data) {
		// Ключ по имени для индекса dorama_releases_name_key_idx: тот же normalizeTitle, что
		// использует поиск по имени в $lib/shared/nameIndex.js, иначе ключ не совпадёт.
		data.nameKey = normalizeTitle(data.title);

		if (dryRun) {
			console.log(`  ${data.date || 'без даты'}  ${data.title}`);
			return;
		}

		const existing = await findRecord(data.doramatvId);
		const byName = existing ? null : await findRecordByKeys([data.nameKey, shortNameKey(data.title)]);
		const target = existing || byName;

		if (!target) {
			await pb.collection(COLLECTION).create(data);
			stats.created++;
			console.log(`  new ${data.date || 'без даты'}  ${data.title}`);
			return;
		}

		// Запись могли создать из карусели: тайтла тогда у источника не было. Дубликата не
		// будет, а пометку о происхождении сохраняем — по ней видно, что запись создавал шаг
		// регистрации, а не список doramatv.
		const fromCarousel = !existing && String(target.matchNote || '').startsWith('запись создана из карусели');

		if (fromCarousel) data.matchNote = target.matchNote;

		if (sameRecord(target, data)) {
			stats.skipped++;
			return;
		}

		await pb.collection(COLLECTION).update(target.id, { ...data, doramatvId: data.doramatvId });
		stats.updated++;
		console.log(
			`  upd  ${data.date || 'без даты'}  ${data.title}${fromCarousel ? ' · была запись из карусели' : ''}`
		);
	}

	/**
	 * Заполняет shikimoriId, kinopoiskId и matchNote там, где их ещё нет. К Shikimori — ровно
	 * один запрос на дораму по имени из списка, и второй по оригинальному названию, только если
	 * первый ничего не дал. Карточку читаем, если оригинального названия ещё нет в записи: не
	 * больше --original-limit карточек за цикл, и эти запросы считаются общим лимитом doramatv.
	 */
	async function fillPass(label) {
		if (!fillIds) return;

		stats.shikiRequests = 0;
		stats.originalFetched = 0;

		// В dry-run PocketBase нет, поэтому список записей взять нечем: пропускаем шаг.
		if (dryRun) {
			console.log('  dry-run: шаг --fill-ids пропускаем');
			return;
		}

		// Без sort: PocketBase 0.40 отвечает ошибкой на сортировку по created (индекса на это
		// поле нет), а без сортировки список работает — проверено запросом.
		const records = await pb.collection(COLLECTION).getFullList({ per_page: 100 });
		const targets = records.filter((record) => !record.shikimoriId).slice(0, shikimoriLimit);

		if (!targets.length) {
			console.log(`${label}: id Shikimori есть у всех записей — шага нет`);
			return;
		}

		console.log(`${label}: Shikimori — ${targets.length} записей без id`);

		for (const record of targets) {
			if (shikiQuotaHit || stats.shikiRequests >= shikimoriBudget) break;

			let originalTitle = record.originalTitle || '';

			// Оригинальное название берём из карточки один раз; запись уже читалась раньше —
			// не перечитываем её каждый цикл.
			if (!originalTitle && originalLimit && stats.originalFetched < originalLimit && !quotaHit) {
				try {
					originalTitle = parseCardOriginal(await fetchHtml(record.sourceUrl));
					stats.originalFetched++;

					if (originalTitle) {
						await pb.collection(COLLECTION).update(record.id, { originalTitle });
					}
				} catch (error) {
					console.warn(`  карточка ${record.slug}: ${error.message || error}`);
				}

				if (delayMs) await sleep(delayMs);
			}

			const candidates = titleCandidates(record, originalTitle);
			let match = null;

			try {
				match = await shikimoriMatch(record.title, candidates);
				stats.shikiRequests++;

				// Второе имя имеет смысл, когда по первому совпадения нет и оно отличается.
				if (!match && originalTitle && normalizeTitle(originalTitle) !== candidates[0].value) {
					if (shikiQuotaHit || stats.shikiRequests >= shikimoriBudget) {
						console.log(`  ${record.title}: по имени источника не совпало, на второй запрос лимит`);
						continue;
					}

					match = await shikimoriMatch(originalTitle, candidates);
					stats.shikiRequests++;
				}
			} catch (error) {
				console.warn(`  ${record.title}: ${error.message || error}`);
				continue;
			}

			if (!match) {
				stats.shikiMissed++;
				console.log(`  ${record.title}: совпадения на Shikimori нет`);
				if (delayMs) await sleep(delayMs);
				continue;
			}

			// Совпадение по имени ещё не значит, что дорама играется: Shikimori знает эти
			// работы и как мангу/манхву, а Kodik отвечает только на аниме-записи.
			if (!ANIME_KINDS.includes(match.item.kind)) {
				stats.shikiNotAnime++;
				console.log(
					`  ${record.title}: совпало «${match.item.russian || match.item.name}» (${match.item.kind}) — Kodik играет только аниме-записи, не пишем`
				);
				if (delayMs) await sleep(delayMs);
				continue;
			}

			const kinopoiskId = kinopoiskIdFromLinks(match.item.externalLinks);

			await pb.collection(COLLECTION).update(record.id, {
				shikimoriId: String(match.item.id),
				kinopoiskId,
				matchNote: match.note
			});
			stats.shikiFilled++;
			console.log(
				`  ${record.title} -> Shikimori ${match.item.id}` +
					(kinopoiskId ? `, Kinopoisk ${kinopoiskId}` : '') +
					` (${match.note})`
			);
			if (delayMs) await sleep(delayMs);
		}

		console.log(
			`${label}: Shikimori — заполнено ${stats.shikiFilled}, без совпадения ${stats.shikiMissed}, ` +
				`совпало но не аниме ${stats.shikiNotAnime}, ` +
				`запросов за цикл ${stats.shikiRequests} из ${shikimoriBudget}, за сутки ${shikiToday} из ${shikimoriDaily}` +
				`, карточек на оригинальные имена ${stats.originalFetched} из ${originalLimit}`
		);
	}

	/**
	 * Заполняет kodikId там, где его ещё нет: поиск Kodik по названию (личный токен).
	 * Kodik знает и те дорамы, которых нет в базе Shikimori, поэтому этот шаг даёт id там,
	 * где --fill-ids бессильна. Найденный id (вид serial-77852) страница /watch использует
	 * напрямую: get-player отвечает по нему и без поиска. Имена те же три варианта, что и на
	 * Shikimori, и то же правило: принимаем только совпадение имени или единственный результат.
	 * Плюс третий заход поиска — транслитерация родного названия (корейский, японский):
	 * Kodik хранит оригинальные имена латиницей, поэтому хангыль и кано сами по себе ничего
	 * не находят. Правило совпадения от этого не меняется.
	 */
	async function kodikPass(label) {
		if (dryRun || !fillKodik) return;

		if (!process.env.KODIK_TOKEN) {
			console.log(`${label}: Kodik — KODIK_TOKEN не задан (нужен для поиска), шаг пропускаем`);
			return;
		}

		const records = await pb.collection(COLLECTION).getFullList({ perPage: 100 });
		// Без id — обычные кандидаты. С id, но без подтверждения именем — тоже: раньше id
		// принимали как «единственный результат» близкого поиска, и два таких id
		// оказались чужими записями (замер 2026-10-31 по живому дню карусели: «Богатое
		// будущее» -> movie-33039, «Любовь со львом» -> movie-62690). Такие id сверяем
		// одним поиском по имени.
		const targets = records.filter(
			(record) =>
				(!record.kodikId && record.kodikNote !== KODIK_MISS) ||
				(record.kodikId && !String(record.kodikNote || '').startsWith('совпало'))
		);

		if (!targets.length) {
			console.log(`${label}: Kodik — записей без подтверждённого имени не осталось (всего ${records.length})`);
			return;
		}

		let processed = 0;

		for (const record of targets) {
			if (kodikQuotaHit || processed >= kodikLimit) break;

			processed++;
			const originalTitle = record.originalTitle || '';
			const candidates = titleCandidates(record, originalTitle);
			const firstTerm = record.title || originalTitle;
			const roman = romanize(originalTitle);
			let found = null;

			try {
				found = pickKodikMatch(await kodikSearchByTitle(firstTerm), candidates);

				// Второе имя, только если по первому совпадения нет и оно отличается.
				if (
					!found?.item &&
					originalTitle &&
					normalizeTitle(originalTitle) !== normalizeTitle(firstTerm) &&
					!kodikQuotaHit
				) {
					found = pickKodikMatch(await kodikSearchByTitle(originalTitle), candidates);
				}

				// Третий заход — транслитерация. Родным письмом Kodik не находит ничего,
				// латиницей находит ту же запись, поэтому она нужна, когда оригинальное
				// название написано хангылем или каной. Китайский romanize() пропускает.
				if (
					!found?.item &&
					roman &&
					normalizeTitle(roman) !== normalizeTitle(originalTitle) &&
					normalizeTitle(roman) !== normalizeTitle(firstTerm) &&
					!kodikQuotaHit
				) {
					found = pickKodikMatch(await kodikSearchByTitle(roman), candidates);
				}
			} catch (error) {
				console.warn(`  ${record.title}: Kodik — ${error.message || error}`);
				continue;
			}

			if (!found?.item) {
				stats.kodikMissed++;
				const patch = { kodikNote: found?.offer || KODIK_MISS };

				// Id без подтверждения именем убираем: страница показала бы по нему чужое
				// произведение. Если поиск ничего не вернул, судить не о чем — id оставляем.
				if (found?.offer && record.kodikId) {
					patch.kodikId = '';
					console.log(`  ${record.title}: ${found.offer} — id ${record.kodikId} убран`);
				} else {
					console.log(`  ${record.title}: ${found?.offer || 'записи Kodik нет'}`);
				}

				// Отметка о пустом результате — чтобы не искать эту дораму каждый цикл.
				await pb.collection(COLLECTION).update(record.id, patch);
				if (kodikDelayMs) await sleep(kodikDelayMs);
				continue;
			}

			const wasUnconfirmed = record.kodikId && String(record.kodikId) !== String(found.item.id);

			await pb
				.collection(COLLECTION)
				.update(record.id, { kodikId: String(found.item.id), kodikNote: found.note });
			stats.kodikFilled++;
			console.log(
				`  ${record.title} -> Kodik ${found.item.id} (${found.note})` +
					(wasUnconfirmed ? `, было ${record.kodikId} — сверили по имени` : '')
			);
			if (kodikDelayMs) await sleep(kodikDelayMs);
		}

		console.log(
			`${label}: Kodik — заполнено ${stats.kodikFilled}, без записи ${stats.kodikMissed}, ` +
				`дорам обработано ${processed} из ${kodikLimit}, запросов ${stats.kodikRequests} (за сутки ${kodikToday} из ${kodikDaily})`
		);
	}

	/**
	 * Заполняет nameKey у записей, где ключа ещё нет или он устарел (например, изменилось
	 * название). Сети не трогает — только PocketBase, поэтому шаг можно включать в дежурный
	 * цикл: он чинит ключи, которые появились до индекса.
	 */
	/**
	 * Регистрация в календаре тайтлов карусели (drama_carousel), которых нет в списке
	 * doramatv. Шаг читает только PocketBase — сети не трогает, лимиты не тратит.
	 *
	 * Почему шаг нужен (замер живыми запросами, 2026-10-31): карточка «Баларао 1 Сезон
	 * (2026)» в карусели есть (pos 1, kinovibeId 39296, kinopoiskId 14328310, doramatvId
	 * пусто), но в dorama_releases её нет ни по kinopoiskId=14328310, ни по nameKey
	 * «баларао», ни LIKE по title. Причина простая: календарь дорам собирается из списка
	 * doramatv, а Баларао на doramatv отсутствует — первые 3 страницы списка (165 плиток)
	 * тайтла не содержат, пути поиска сайта отвечают 404. Значит найти запись по id нельзя,
	 * и индекс на нашем сайте для такого тайтла даёт только сама карточка карусели.
	 *
	 * Порядок на карточку самого свежего дня карусели:
	 *   1. doramatvId карточки — запись уже найдена, ничего не делаем;
	 *   2. nameKey по полному имени, потом по короткому (без сезона и года) — работает
	 *      индекс dorama_releases_name_key_idx; если нашли и у карточки своего id нет,
	 *      дополняем его id найденной записи, чтобы карточка вела на внутреннюю страницу;
	 *   3. ничего нет — создаём запись из карточки: имя, постер, ссылка источника,
	 *      kinopoiskId, nameKey, дата — день карусели. Повтор цикла ничего не создаёт:
	 *      шаг находит такую запись по nameKey и пропускает её.
	 *
	 * Записи из карусели не подменяют записи из списка: как только тайтл появляется у
	 * источника, upsert находит его по nameKey и дописывает doramatvId вместо создания
	 * дубликата.
	 */
	async function registerPass(label) {
		if (dryRun || !registerCarousel) return;

		const cards = await pb
			.collection(CAROUSEL)
			.getFullList({ sort: 'pos', perPage: 100 })
			.catch((error) => {
				console.log(`${label}: карусель дорам не читается (${error?.message || error}) — шага нет`);
				return [];
			});

		if (!cards.length) {
			console.log(`${label}: карусель дорам пуста — шага нет`);
			return;
		}

		const days = [...new Set(cards.map((card) => String(card.day || '').slice(0, 10)))]
			.filter(Boolean)
			.sort()
			.reverse();
		const day = days[0] || '';
		const snapshot = cards.filter((card) => String(card.day || '').slice(0, 10) === day);

		for (const card of snapshot) {
			const full = normalizeTitle(card.title);

			if (!full) continue;

			const short = shortNameKey(card.title);

			if (card.doramatvId) {
				const existing = await findRecord(card.doramatvId);

				if (existing) continue;
			}

			let found = null;

			for (const key of [full, short].filter(Boolean)) {
				const hits = await pb
					.collection(COLLECTION)
					.getFullList({ filter: `nameKey = '${q(key)}'`, perPage: 5 })
					.catch(() => []);

				found = hits.find((record) => normalizeTitle(record.title) === key) || null;

				if (found) break;
			}

			if (found) {
				if (!card.doramatvId && found.doramatvId) {
					await pb
						.collection(CAROUSEL)
						.update(card.id, { doramatvId: found.doramatvId })
						.catch((error) => console.log(`  карточка ${card.id}: ${error?.message || error}`));

					stats.registered++;
					console.log(`  карточка ${card.title} -> dorama_releases ${found.id} по имени`);
				}

				continue;
			}

			const data = {
				doramatvId: '',
				slug: `carousel-${card.kinovibeId || card.id}`,
				title: card.title,
				nameKey: full,
				poster: card.poster || '',
				date: day,
				year: Number(card.year || 0),
				status: 'в карусели',
				kind: 'дорама',
				sourceUrl: card.sourceUrl || '',
				kinopoiskId: card.kinopoiskId || '',
				kodikId: card.kodikId || '',
				matchNote: 'запись создана из карусели: тайтла нет в списке doramatv'
			};

			await pb.collection(COLLECTION).create(data);
			stats.registered++;
			console.log(`  new ${day}  ${data.title} · из карусели`);
		}

		console.log(`${label}: регистрация дорам — карточек дня ${day} ${snapshot.length}, новых записей ${stats.registered}`);
	}

	async function nameKeyPass(label) {
		if (!fillNameKey || dryRun) return;

		stats.nameKeyUpdated = 0;
		const all = await pb.collection(COLLECTION).getFullList({ sort: 'id' });

		for (const record of all) {
			const key = normalizeTitle(record.title);

			if (!key || record.nameKey === key) continue;

			await pb.collection(COLLECTION).update(record.id, { nameKey: key });
			stats.nameKeyUpdated++;
		}

		console.log(`${label}: nameKey — записей ${all.length}, обновили ${stats.nameKeyUpdated}`);
	}

	/**
	 * Дата известна только из карточки, поэтому читаем её для дорам, которых ещё нет в
	 * базе, и для записей без даты. Записям с датой карточку не читаем — дежурный цикл
	 * тратит запросы только на новые дорамы.
	 */
	async function runCycle(label) {
		stats.processed = 0;
		stats.requests = 0;

		for (let page = 1; page <= pages; page++) {
			if (limit && stats.processed >= limit) break;
			if (quotaHit || stats.requests >= budget) break;

			const url = `${BASE}/list?sortType=DATE_CREATE&offset=${(page - 1) * PER_PAGE}`;
			let html;

			try {
				html = await fetchHtml(url);
			} catch (error) {
				console.warn(`  ${error.message || error}`);
				break;
			}
			stats.requests++;

			const tiles = parseTiles(html);
			console.log(`Страница ${page}: плиток ${tiles.length}`);
			if (!tiles.length) break;

			for (const tile of tiles) {
				if (limit && stats.processed >= limit) break;
				if (stats.requests >= budget) break;

				stats.processed++;
				const data = { ...tile, year: 0 };
				const existing = dryRun ? null : await findRecord(tile.doramatvId);

				// Дату и оригинальное название берём из карточки, только когда их ещё нет.
				if (!existing || !dateOnly(existing.date)) {
					let card;

					try {
						card = await fetchHtml(tile.sourceUrl);
					} catch (error) {
						console.warn(`  карточка ${tile.slug}: ${error.message || error}`);
						continue;
					}
					stats.requests++;
					data.date = parseCardDate(card);
					data.originalTitle = parseCardOriginal(card);
				} else {
					data.date = dateOnly(existing.date);
					data.originalTitle = existing.originalTitle || '';
				}

				data.year = Number(String(data.date).slice(0, 4) || 0);

				await upsert(data);
				if (delayMs) await sleep(delayMs);
			}

			if (tiles.length < PER_PAGE) break;
			if (delayMs) await sleep(delayMs);
		}

		report(label);
	}

	if (!fillOnly) await runCycle('Проход');
	await nameKeyPass('Проход');
	await registerPass('Проход');
	await fillPass('Проход');
	await kodikPass('Проход');

	if (!watch) return;

	console.log(
		`\nДежурный режим (doramatv): страниц ${pages} за цикл, каждые ${intervalMin} мин, ` +
			`не больше ${budget} запросов за цикл и ${dailyBudget} за сутки. Задержка ${delayMs} мс. ` +
			`Карточку читаем только для новых дорам и для записей без даты. ` +
			(fillKodik
				? `Kodik: записей за цикл ${kodikLimit}, за сутки ${kodikDaily}, пауза ${kodikDelayMs} мс. `
				: '') +
			(registerCarousel
				? 'Шаг регистрации: карточку карусели, которой нет в списке источника, записываем в календарь. '
				: 'Шаг регистрации карусели выключен (--no-register). ') +
			`Ctrl+C — остановить.`
	);

	while (true) {
		await runCycle('Обновление');
		await registerPass('Обновление');
		await fillPass('Обновление');
		await kodikPass('Обновление');

		if (quotaHit) {
			const waitMs = msUntilMidnight();
			console.log(
				`Суточный лимит (${requestsToday} из ${dailyBudget}) исчерпан — пауза ${Math.round(waitMs / 60000)} мин, до полуночи.`
			);
			await sleep(waitMs);
			quotaDay = new Date().toISOString().slice(0, 10);
			requestsToday = 0;
			quotaHit = false;
			continue;
		}

		await sleep(intervalMin * 60000);
	}
}

main().catch((error) => {
	console.error(error.message || error);
	process.exitCode = 1;
});

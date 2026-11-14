// Клиент API ПоискКино (api.poiskkino.dev/v1.5) для карточек поиска: запасной постер с
// яндексового CDN и платформы, где тайтл смотрят официально.
//
// Запрос идёт только через прокси nginx (/api/poiskkino/): ключ нельзя показывать в
// сборке браузера, токен подставляет контейнер. Прямой путь из браузера не пробуем —
// без ключа API отвечает 401 («В запросе не указан токен!»), а прокси отвечает всегда.
//
// Почему с запасом квоты. У этого ключа 200 запросов в сутки, и почти все они уходят
// фоновому синку графика премьер (--daily-budget 180). Если страница будет запрашивать
// карточку для каждого тайтла, синк останется без запросов и календарь перестанет
// обновляться. Поэтому страница тратит запрос только когда остаток больше запаса
// (RESERVE) и только по тайтлам, которых ещё нет в кэше.
//
// Проверено живыми запросами 2026-10-31: /v1.5/token суточный лимит не списывает —
// requestsUsed не изменился за два вызова (42 до и 42 после), поэтому остаток смотрим
// бесплатно. Ответ /movie/search при этом считает отдельную строгую квоту (5 запросов
// в секунду), поэтому карточку просим один раз и держим в localStorage: повторный визит
// на страницу запроса не делает.
//
// selectFields работает только на списочном маршруте /movie — на карточке по id API его
// игнорирует (проверено: 6336 байт и с ним, и без него), а вложенные имена (rating.kp,
// genres.name) не принимает вообще. Поэтому просим карточку списочным маршрутом с одним
// id= и простыми именами полей: 2427 байт против 6195 без selectFields.

import netFetch from './net.js';
import netCache from './netCache.js';
import { todayKey } from './moscowDate.js';

const PROXY = '/api/poiskkino/v1.5';

// Запас суточной квоты для фонового синка: страница не делает запрос, пока остаток
// не больше этого числа.
export const RESERVE = 40;

// Сколько запросов может сделать одна страница за сутки. Без этого просмотр списка из
// тридцати карточек мог бы съесть весь остаток, даже когда API позволяет больше.
export const MAX_TODAY = 60;

const FIELDS = 'id,name,year,type,genres,poster,watchability,networks';

const KEY = 'poiskkino_cache';
const MAX = 300;
const QUOTA_TTL_MS = 10 * 60 * 1000;

const memory = new Map();
let loaded = false;
let quota = null;
let quotaAt = 0;
let usedToday = 0;
let usedDay = '';

function hasStorage() {
	return typeof localStorage !== 'undefined';
}

function stored() {
	if (!loaded) {
		loaded = true;

		if (hasStorage()) {
			try {
				const data = JSON.parse(localStorage.getItem(KEY) || '{}');
				Object.entries(data).forEach(([id, entry]) => memory.set(id, entry));
			} catch (error) {
				console.error(error);
			}
		}
	}

	return memory;
}

function save() {
	if (!hasStorage()) return;

	try {
		localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(stored())));
	} catch (error) {
		console.error(error);
	}
}

// В ответе API и платформы (watchability), и сети (networks) лежат списком items; у
// аниме и дорам на демо-токене платформы бывают пустые, тогда строку не показываем.
function names(list) {
	return (Array.isArray(list?.items) ? list.items : []).map((item) => item?.name).filter(Boolean);
}

function entryFrom(doc) {
	return {
		id: String(doc.id || ''),
		name: doc.name || doc.alternativeName || '',
		year: doc.year || '',
		type: doc.type || '',
		genres: names(doc.genres),
		posterPreview: doc.poster?.previewUrl || doc.poster?.url || '',
		platforms: names(doc.watchability),
		networks: names(doc.networks)
	};
}

function setEntry(id, entry) {
	stored().set(id, entry);

	if (stored().size > MAX) {
		// Кэш не должен расти бесконечно: при переполнении убираем самые старые записи.
		const ids = [...stored().keys()];
		ids.slice(0, ids.length - MAX).forEach((key) => stored().delete(key));
	}

	save();
}

function countPageRequest(cached) {
	if (cached) return;

	const day = todayKey();

	if (day !== usedDay) {
		usedDay = day;
		usedToday = 0;
	}

	usedToday++;
}

export function cachedCard(id) {
	if (!id) return null;

	return stored().get(String(id)) || null;
}

/**
 * Остаток суточной квоты: { limit, used, remaining, resetAt, reason }. Значение держим
 * десять минут — читать остаток можно бесплатно, но не на каждую карточку.
 */
export async function quotaInfo(force = false) {
	if (!force && quota && Date.now() - quotaAt < QUOTA_TTL_MS) return quota;

	const answer = await netCache(
		'poiskkino:quota',
		() => netFetch(`${PROXY}/token`, { timeoutMs: 8000, attempts: 2 }),
		force
	);

	if (answer.ok && answer.data) {
		quota = {
			limit: Number(answer.data.requestsLimit ?? 0),
			used: Number(answer.data.requestsUsed ?? 0),
			remaining: Number(answer.data.requestsRemaining ?? 0),
			resetAt: answer.data.resetAt || '',
			reason: '',
			via: answer.via
		};
		quotaAt = Date.now();

		return quota;
	}

	if (quota) return { ...quota, reason: answer.reason };

	// 401 — ключ не работает: это не сетевая ошибка, и повтор её не меняет.
	quota = {
		limit: 0,
		used: 0,
		remaining: 0,
		resetAt: '',
		reason: answer.reason,
		via: answer.via
	};

	return quota;
}

/**
 * Карточка тайтла: постер с яндексового CDN и платформы, где тайтл смотрят официально.
 * Запрос делаем, только если тайтла ещё нет в кэше и квота позволяет (остаток больше
 * запаса для синка). Удачный ответ кэшируем; неудачу не запоминаем — карточка может
 * повторить запрос, когда квота появится.
 */
export async function cardDoc(id, force = false) {
	const key = String(id || '');

	if (!key) return null;

	const hit = stored().get(key);

	if (hit && !force) return hit;

	const headroom = await quotaInfo(force);

	if (!headroom || !headroom.limit) {
		return { id: key, failed: true, reason: headroom?.reason || 'квоту не проверили' };
	}

	if (headroom.remaining <= RESERVE) {
		return { id: key, failed: true, reason: `квота: остаток ${headroom.remaining}, запас ${RESERVE} для синка` };
	}

	if (usedToday >= MAX_TODAY) {
		return { id: key, failed: true, reason: `страница сделала ${usedToday} запросов за сутки` };
	}

	const answer = await netCache(
		`poiskkino:${key}`,
		() => netFetch(`${PROXY}/movie?id=${key}&limit=1&selectFields=${FIELDS}`, { timeoutMs: 8000, attempts: 2 }),
		force
	);

	if (!answer.ok) {
		return { id: key, failed: true, reason: `ПоискКино ${answer.reason || 'не ответил'}` };
	}

	countPageRequest(answer.cached);

	const docs = Array.isArray(answer.data?.docs) ? answer.data.docs : [];
	const doc = docs.find((item) => String(item.id) === key) || docs[0];

	if (!doc) return { id: key, failed: true, reason: 'ПоискКино ничего не нашёл по этому id' };

	const entry = entryFrom(doc);
	setEntry(key, entry);

	return entry;
}

export function pageRequestsToday() {
	return usedToday;
}

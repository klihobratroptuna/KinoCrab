// Старый путь плеера Alloha (/?token=...&kp=...) больше не работает: источник отвечает 404
// на любую строку адреса. Работает его API — https://api.alloha.tv/?token=...&kp=<id>.
// Он отвечает JSON, и в ответе есть адрес фактической страницы плеера: data.iframe.
// Проверка читается из браузера: у api.alloha стоит access-control-allow-origin: *.
// Запрос делаем простым GET без заголовков: на preflight (OPTIONS) alloha отвечает 405,
// а простой запрос проходит. Страница плеера отвечает 200 только с Referer — в iframe
// Referer добавляет браузер (адрес страницы приложения), поэтому кадр собирается
// из data.iframe, а не из адреса API.
//
// Прямой адрес страницы плеера — запасной путь: проверку API читает браузер, и если её
// не пропустил блокировщик, кадр всё равно можно собрать по прямой ссылке. Раньше кадр
// строился именно так: когда стали брать только адрес из API, плеер перестал открываться
// при неуспешной проверке. Хост проверен запросом: 404 без referrer, 200 с ним.
// Тот же хост, что был в коде до правки.
//
// Проверка идёт сначала через прокси nginx (/api/alloha/), где токен подставляет nginx:
// на холодном старте первый запрос браузера к api.alloha.tv висит 12 секунд и обрывается,
// а тот же запрос через контейнер проходит за 200-250 мс. Неудачу не запоминаем — иначе
// сообщение «не ответил» висело до перезагрузки страницы.

import { isKinopoiskId } from './collaps';
import netFetch, { netSummary } from './net';
import netCache from './netCache';

const TOKEN = 'a3fd119d8a9418f6c3f6a7ae628a41';
const BASE = `https://api.alloha.tv/?token=${TOKEN}`;
const PLAYER_HOST = 'https://attractive-as.allarknow.online';

// Код IMDb: вид tt20597468. Alloha принимает его отдельным параметром imdb — проверено
// запросом 2026-10-31 через прокси: /api/alloha/?imdb=tt20597468 отвечает 200 success тем же
// материалом, что и ?kp=4859012 («Рождение империи»). Это нужно тайтлам, у которых номера
// фильма в Kinopoisk нет, но код IMDb есть: без него проверять было бы нечем.
export function isImdbId(id) {
	return /^tt\d{6,10}$/.test(String(id ?? ''));
}

function paramFor(id) {
	return isImdbId(id) ? 'imdb' : 'kp';
}

function directPlayerLink(id) {
	return `${PLAYER_HOST}/?token=${TOKEN}&${paramFor(id)}=${id}`;
}

export async function allohaEmbed(kinopoiskId, force = false) {
	if (!isKinopoiskId(kinopoiskId) && !isImdbId(kinopoiskId)) {
		return {
			ok: false,
			label: 'bad id',
			note: 'id в адресе не похож ни на номер фильма в Kinopoisk, ни на код IMDb'
		};
	}

	return netCache(`alloha:${kinopoiskId}`, () => check(kinopoiskId), force);
}

async function check(id) {
	const param = paramFor(id);

	// Без токена: его подставит nginx из ALLOHA_TOKEN. Если переменная пустая, ниже
	// будет запасная попытка прямым запросом с токеном из этого файла.
	const proxyPath = `/api/alloha/?${param}=${id}`;
	let answer = await netFetch([proxyPath, `${BASE}&${param}=${id}`], { timeoutMs: 8000, attempts: 3 });

	let data = answer.ok ? answer.data : null;

	// Прокси отвечает JSON-ошибкой, если ALLOHA_TOKEN в .env не задан — тогда нужен
	// прямой запрос, где токен есть в адресе. Повтор делаем один, чтобы не долбить источник.
	if (answer.ok && answer.via === 'через контейнер' && data?.status === 'error' && !data.data) {
		answer = await netFetch(`${BASE}&${param}=${id}`, { timeoutMs: 8000, attempts: 1 });
		data = answer.ok ? answer.data : null;
	}

	if (data?.status === 'success' && data.data) {
		const translations = Object.values(data.data.translation_iframe || {});
		const player = translations[0]?.iframe || data.data.iframe || directPlayerLink(id);

		return {
			ok: true,
			label: translations.length > 1 ? `${translations.length} озвучек` : 'ok',
			note:
				`Alloha нашёл материал: ${data.data.name || data.data.original_name || 'без названия'}` +
				(translations.length ? `, озвучка — ${translations[0].name}` : ''),
			// Номер фильма в Kinopoisk. Замер 2026-11-07: запрос по коду IMDb
			// (?imdb=tt20597468) отвечает success и в строке есть id_kp = 4859012, то есть номер
			// известен даже тогда, когда проверяли по коду. Без него кнопки «Смотрю» и
			// «Буду смотреть» в плеере не появляются: список профиля сохраняет числовое поле
			// film_id, и числовой ключ — только номер Kinopoisk (код IMDb в него не записать).
			kpId: String(data.data.id_kp || ''),
			link: player,
			translations
		};
	}

	if (data?.status === 'error') {
		return {
			ok: false,
			label: 'нет фильма',
			note: `Alloha ответил "${data.error_info}": у источника нет материала с номером ${id}`,
			link: directPlayerLink(id)
		};
	}

	if (answer.ok) {
		return {
			ok: false,
			label: 'пусто',
			note: 'Alloha API ответил 200, но не JSON: страницу плеера собрать не из чего, кадр по прямой ссылке мог бы открыться, если фильм у них есть',
			link: directPlayerLink(id)
		};
	}

	return {
		ok: false,
		label: 'сеть',
		note: `Alloha API ${netSummary('не ответил', answer)}. Кадр собран по прямой ссылке плеера: проверка из браузера не прошла, но саму страницу это не отменяет`,
		link: directPlayerLink(id),
		retry: true
	};
}

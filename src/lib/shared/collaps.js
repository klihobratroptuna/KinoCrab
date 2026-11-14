// Collaps отдаёт embed-страницу без токена, но сейчас часто отвечает пустым телом
// с кодом 422 — iframe тогда выглядит как белая область. Поэтому состояние источника
// проверяем заранее, так же как у Kodik: код ответа + непустое тело.
// Ответ читается из браузера, у api.tobaco.ws стоит access-control-allow-origin: *.
//
// Проверка идёт через прокси nginx (/api/collaps/) и только потом напрямую из браузера:
// на холодном старте первый запрос браузера к этому хосту висит и обрывается, а тот же
// запрос через контейнер проходит за 200-300 мс. iframe собираем по прямому адресу
// страницы, потому что источник отвечает 200 только с Referer — его добавляет браузер.
// Неудачу не запоминаем: иначе первая сетевая ошибка решала за всю страницу.

import netFetch, { netSummary } from './net';
import netCache from './netCache';

const BASE = 'https://api.tobaco.ws/embed/kp/';

// Источник закрыт. Замер 2026-11-07: embed отвечает 422 пустым телом на все запросы
// (20 id из снимка каталога, браузерные заголовки, referrer, любые параметры, POST),
// а корень хоста отдаёт только CONTACT_EMAIL. В архиве тот же адрес работал до 2025-10-22,
// то есть источник перестал отдавать страницы плеера, а не потерял отдельные тайтлы.
// Строку плеера и проверки отключаем этим переключателем: если источник оживёт,
// вернуть можно одной строкой — адрес и код проверки трогать не нужно.
export const COLLAPS_ENABLED = false;

export function isKinopoiskId(id) {
	return /^\d{3,10}$/.test(String(id ?? ''));
}

export async function collapsEmbed(kinopoiskId, force = false) {
	if (!COLLAPS_ENABLED) return null;

	if (!isKinopoiskId(kinopoiskId)) {
		return {
			ok: false,
			label: 'bad id',
			note: 'id в адресе не похож на номер фильма в Kinopoisk'
		};
	}

	return netCache(`collaps:${kinopoiskId}`, () => check(kinopoiskId), force);
}

async function check(kinopoiskId) {
	const link = BASE + kinopoiskId;
	const answer = await netFetch([`/api/collaps/embed/kp/${kinopoiskId}`, link], { timeoutMs: 8000, attempts: 3 });

	if (answer.ok && answer.text) {
		return { ok: true, label: 'ok', note: '', link, via: answer.via, ms: answer.ms };
	}

	// 422 проверяли на нескольких фильмах, включая старые и с referrer — источник
	// сейчас отказывает всем запросам, поэтому это не «нет фильма», а ответ сервера.
	return {
		ok: false,
		label: answer.status ? `ошибка ${answer.status}` : 'сеть',
		note: answer.status === 422
			? `Collaps сейчас отвечает 422 на все запросы, включая фильмы, у которых плеер раньше работал — ${netSummary('источник', answer)}`
			: `Collaps ${netSummary('не дошёл', answer)} — повторить можно кнопкой «повторить»`,
		link,
		retry: !answer.status || answer.status >= 500
	};
}

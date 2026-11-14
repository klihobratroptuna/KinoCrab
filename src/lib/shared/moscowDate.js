// Даты премьер сравниваем как строки YYYY-MM-DD.
// «Сегодня» считается по московскому времени — независимо от часового пояса браузера,
// иначе посетитель из другого пояса видит соседний день.

export const TIMEZONE = 'Europe/Moscow';

const MONTHS = [
	'января',
	'февраля',
	'марта',
	'апреля',
	'мая',
	'июня',
	'июля',
	'августа',
	'сентября',
	'октября',
	'ноября',
	'декабря'
];

function pad(value) {
	return String(value).padStart(2, '0');
}

// YYYY-MM-DD из значения PocketBase («2026-10-29 00:00:00.000Z» или «2026-10-29»).
export function keyOf(value) {
	const match = /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''));
	return match ? match[0] : '';
}

export function todayKey(now = new Date()) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);

	const pick = (type) => parts.find((part) => part.type === type).value;
	return [pick('year'), pick('month'), pick('day')].join('-');
}

export function addDaysKey(key, days) {
	const [year, month, day] = String(key).split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCDate(date.getUTCDate() + days);

	return [date.getUTCFullYear(), pad(date.getUTCMonth() + 1), pad(date.getUTCDate())].join('-');
}

// Понедельник недели, в которой находится дата (для «Релизы недели»).
export function startOfWeekKey(value) {
	const key = keyOf(value) || todayKey();
	const [year, month, day] = key.split('-').map(Number);
	const offset = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;

	return addDaysKey(key, -offset);
}

// «26 октября» или «1 ноября 2026 г.» — без привязки к часовому поясу браузера.
export function formatRu(key, withYear = false) {
	const [year, month, day] = String(key).split('-').map(Number);
	if (!year || !month || !day || Number.isNaN(month) || Number.isNaN(day)) return String(key);

	const text = `${day} ${MONTHS[month - 1]}`;
	return withYear ? `${text} ${year} г.` : text;
}

// «23:59» по Москве — время сброса суточного лимита API (значение приходит в UTC).
export function formatTimeRu(value) {
	const date = new Date(value);

	if (!Number.isFinite(date.getTime())) return '';

	return new Intl.DateTimeFormat('ru-RU', {
		timeZone: TIMEZONE,
		hour: '2-digit',
		minute: '2-digit'
	}).format(date);
}

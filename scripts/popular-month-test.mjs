#!/usr/bin/env node
/*
 * scripts/popular-month-test.mjs — тестовая карусель из «популярного за месяц».
 *
 * Собирает кандидатов по популярности, прогоняет их через те же правила, что и карусель
 * «Сериалы» (src/lib/shared/seriesSource): страны, обязательный плеер, приоритет русского
 * названия, не больше трёх карточек одной страны. Ничего не пишет в базу, пока не передан
 * --write; с --write пишет снимок в series_carousel и сохраняет прежние записи в
 * scratch/popular-month-backup.json, чтобы их можно было вернуть.
 *
 * Источники популярности проверяются живыми запросами через прокси nginx:
 *   TMDB discover?sort_by=popularity.desc — счёт популярности, окно не документировано;
 *   TMDB trending/tv/week — единственное документированное окно (7 дней);
 *   Kodik — сортировки по популярности нет (sort=popular даёт тот же порядок, что created_at);
 *   Kinopoisk — подборки за месяц нет, есть только TOP_POPULAR_ALL и TOP_POPULAR_MOVIES;
 *   Alloha — отвечает только по номеру материала, списков нет;
 *   IMDb — с сервера отвечает 202 и пустое тело, список читается только из браузера.
 *
 * Порядок проверки карточки — тот же, что в модуле: Lookup по имени даёт номер Kinopoisk или
 * код IMDb, потом Kodik по этому id, и только потом Alloha по тому же номеру.
 *
 *   node scripts/popular-month-test.mjs                       # посчитать и показать
 *   node scripts/popular-month-test.mjs --pool 40             # больше кандидатов
 *   node scripts/popular-month-test.mjs --write              # записать снимок в базу
 *   node scripts/popular-month-test.mjs --restore            # убрать строки теста и вернуть backup
 *
 * Замер 2026-11-04, кандидатов 40 (TMDB popularity.desc + trending/tv/week):
 *   вне правила стран — 8, серия вышла раньше месяца — 21, плеера нет — 32,
 *   до карусели дошло 3 карточки: «Чёрная материя», «Братья», «Дочь Люпена».
 *   Без правила «карточка без плеера не пишется» было бы 13 плиток, но игрались бы те же 3.
 *   Для сравнения: окно новинки за 30 дней даёт 20 карточек, из них с плеером 4.
 *   Проверка в живую: блок на главной показал ровно эти 3 карточки, клик по плитке открыл
 *   /watch и плеер запустился (ссылка осталась внутри сайта).
 *
 * Опасность, которую показал тест: имя — ненадёжный ключ. TMDB «Brothers» (2026) по имени
 * совпал с Kinopoisk «Братья» (841807, 2015), и плитка показала 2026, а страница плеера — 2015.
 */

import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';

const args = process.argv.slice(2);

function flag(name, dflt) {
	const named = args.find((a) => a.startsWith(`--${name}=`));

	if (named) return named.split('=').slice(1).join('=');

	const bare = args.indexOf(`--${name}`);

	if (bare >= 0) {
		const next = args[bare + 1];

		// Флаг без значения — это true; если следующим аргументом стоит число, оно и есть значение.
		return next && /^\d+$/.test(next) ? Number(next) : true;
	}

	return dflt;
}

const BASE = flag('base', 'http://localhost:3000');
const PB_URL = flag('pb', 'http://localhost:8090');
const POOL = Number(flag('pool', 20));
const LOOKUP_CAP = Number(flag('lookup', 20));
const CARD_LIMIT = 20;
const PER_COUNTRY_CAP = 3;
const PAUSE_MS = Number(flag('delay', 1100));
const WRITE = Boolean(flag('write', false));
const RESTORE = Boolean(flag('restore', false));
const BACKUP = flag('backup', 'scratch/popular-month-backup.json');
const CACHE = flag('cache', 'scratch/popular-month-test.json');
const COLLECTION = 'series_carousel';

// Список стран для «Сериалов» взят из src/lib/shared/seriesSource (строки 201-247):
// Европа, США, Канада, СНГ, Австралия и Новая Зеландия; Турция исключена 2026-11-04,
// азиатские страны — это вкладка «Дорамы».
const ASIAN = new Set(['kr', 'cn', 'jp', 'th', 'ph', 'vn', 'id', 'my', 'sg', 'hk', 'mo', 'tw', 'mn', 'in', 'bd', 'np', 'kh', 'mm']);
const ALLOWED = new Set([
	'us', 'ca', 'ru', 'by', 'kz', 'uz', 'kg', 'tj', 'am', 'az', 'md', 'ua', 'ge',
	'gb', 'ie', 'fr', 'de', 'es', 'it', 'nl', 'be', 'ch', 'at', 'cz', 'sk', 'pl', 'se', 'no', 'dk', 'fi', 'is',
	'pt', 'hr', 'si', 'rs', 'bg', 'hu', 'mt', 'cy', 'lu', 'gr', 'au', 'nz'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normName(value) {
	return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s{2,}/g, ' ').trim();
}

function hasCyrillic(value) {
	return /[Ѐ-ӿ]/u.test(String(value || ''));
}

async function get(url) {
	const answer = await fetch(url, { signal: AbortSignal.timeout(12000) });
	const text = await answer.text();

	if (!answer.ok) return { ok: false, status: answer.status, note: `HTTP ${answer.status}` };

	try {
		return { ok: true, data: JSON.parse(text) };
	} catch {
		return { ok: false, status: answer.status, note: 'не JSON' };
	}
}

// Сравнение имён — те же правила, что в src/lib/shared/kodik.js (строки 138-187): полное
// имя, имя без года и суффикса сезона, начало имени. Kodik отвечает близкими названиями,
// поэтому совпадение проверяем, а не берём первую строку.
function shortName(value) {
	return normName(value)
		.replace(/\s+\d{4}$/gu, '')
		.replace(/\s+\d{1,2}\s+(сезон|сезоны|season|seasons)$/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

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

function nameMatch(query, item) {
	const full = normName(query);
	const short = shortName(query);
	const names = nameSet(item);

	if (!full || !names.length) return false;

	if (names.includes(full)) return true;

	if (short && names.some((name) => name === short || name.startsWith(`${short} `))) return true;

	return false;
}

// Параметр поиска Kodik — title, не search: с search= он отвечает 400 (проверено 2026-11-04
// через прокси). Значение types тоже берём из его списка: serial не принимается,
// foreign-serial отвечает 200.
async function kodikBy(param, value, name) {
	const url = `${BASE}/api/kodik/search?${param}=${encodeURIComponent(value)}&types=foreign-serial&limit=3`;
	const answer = await get(url);

	if (!answer.ok) return { found: false, note: `Kodik ${param}: ${answer.note}` };

	const rows = answer.data?.results || [];

	if (!rows.length) return { found: false, note: `Kodik по ${param} ${value} не ответил` };

	const hit = rows.find((row) => !name || nameMatch(name, row));

	if (!hit) return { found: false, note: `Kodik по ${param} ${value}: имена не совпали (${rows.length} строк)` };

	return { found: true, row: hit, note: `Kodik: ${normName(hit.translation) || 'без озвучки'}` };
}

// Lookup по имени — тот же путь, что в модуле: он даёт номер Kinopoisk, русское имя и страну.
async function kpLookup(name) {
	if (kpUsed >= LOOKUP_CAP) return { note: `бюджет Kinopoisk исчерпан (${kpUsed} из ${LOOKUP_CAP})` };

	kpUsed++;

	const answer = await get(`${BASE}/api/kinopoisk/v2.2/films?keyword=${encodeURIComponent(name)}&limit=3`);

	if (!answer.ok) return { note: `Kinopoisk: ${answer.note}` };

	const key = normName(name);
	const items = answer.data?.items || [];
	const hit = items.find((item) => normName(item.nameRu) === key || normName(item.nameOriginal) === key) || items[0];

	if (!hit) return { note: 'Kinopoisk по имени: пусто' };

	return {
		kp: hit.kinopoiskId,
		ru: hit.nameRu || '',
		country: (hit.countries || []).map((c) => normName(c)),
		genre: (hit.genres || [])[0]?.genre || '',
		note: `Kinopoisk: ${hit.nameRu || hit.nameOriginal} (${hit.kinopoiskId})`
	};
}

async function allohaBy(kp) {
	const answer = await get(`${BASE}/api/alloha/?kp=${kp}`);

	if (!answer.ok) return { found: false, note: `Alloha: ${answer.note}` };

	return { found: Boolean(answer.data?.iframe), note: answer.data?.iframe ? 'Alloha: плеер есть' : 'Alloha: материал не нашли' };
}

// Страна кандидата: коды TMDB, а если строка Kodik или ответ Kinopoisk назвал страну — она же
// оттуда. Тот же разбор, что в модуле: оба варианта должны быть в одном списке.
function pickCountry(codes, extra) {
	const list = (codes || []).map((code) => String(code).toLowerCase());

	if (list.some((code) => ASIAN.has(code))) return { code: list.join(','), here: false };

	const hit = list.find((code) => ALLOWED.has(code)) || (extra || []).find((word) => ALLOWED.has(word));

	return { code: hit || list.join(','), here: Boolean(hit) };
}

let kpUsed = 0;

// Результаты пишем в scratch/popular-month-test.json и перечитываем при записи в базу,
// чтобы второй проход не делал заново все запросы к TMDB и Kinopoisk.
function saveCache(data) {
	fs.mkdirSync(path.dirname(CACHE), { recursive: true });
	fs.writeFileSync(CACHE, JSON.stringify(data, null, 1));
}

async function main() {
	const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

	// Возврат снимка: убираем строки этого теста и, если backup не пустой, ставим их обратно.
	if (RESTORE) {
		const pb = new PocketBase(PB_URL);

		await pb.collection('_superusers').authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);

		const written = await pb.collection(COLLECTION).getFullList({ filter: 'via = "test-month"' });

		for (const record of written) await pb.collection(COLLECTION).delete(record.id);

		console.log(`убрали тестовые строки: ${written.length}`);

		const saved = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : [];

		for (const record of saved) {
			const copy = { ...record };

			delete copy.id;
			delete copy.created;
			delete copy.updated;

			await pb.collection(COLLECTION).create(copy);
		}

		console.log(`вернули из backup: ${saved.length}`);

		return;
	}

	const rows = [];
	let candidates = 0;
	let excluded = 0;
	let outsideWindow = 0;
	let noPlayer = 0;

	if (WRITE && fs.existsSync(CACHE)) {
		const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

		candidates = cache.counts.candidates;
		excluded = cache.counts.excluded;
		outsideWindow = cache.counts.outsideWindow;
		noPlayer = cache.counts.noPlayer;
		kpUsed = cache.counts.kpUsed;

		for (const card of cache.rows) rows.push(card);
	} else {
		// Два списка: счёт популярности (окно не документировано) и недельное тренд-окно TMDB.
		const scoreList = (await get(`${BASE}/api/tmdb/3/discover/tv?sort_by=popularity.desc&page=1`)).data?.results || [];
		const weekList = (await get(`${BASE}/api/tmdb/3/trending/tv/week?page=1`)).data?.results || [];

		const seen = new Map();

		for (const row of [...weekList, ...scoreList].slice(0, POOL)) {
			if (!seen.has(row.id)) seen.set(row.id, row);
		}

		candidates = seen.size;

		for (const row of seen.values()) {
		const detail = await get(`${BASE}/api/tmdb/3/tv/${row.id}`);
		const imdb = detail.data?.external_ids?.imdb_id || '';
		const aired = detail.data?.last_air_date || '';

		let country = pickCountry(row.origin_country, detail.data?.origin_country);
		let player = null;
		let notes = [];
		let kodikId = '';
		let ru = '';
		let via = '';
		let kp = '';
		let poster = detail.data?.poster_path || '';

		// Проверка плеера по порядку модуля: сначала по id, потом по имени.
		if (imdb) {
			const byId = await kodikBy('imdb_id', imdb, '');

			if (byId.found) {
				player = true;
				kodikId = byId.row.id;
				ru = byId.row.title || '';
				via = 'kodik:imdb';
				country = pickCountry(row.origin_country, (byId.row.material_data?.countries || []).map((c) => normName(c)));
				notes.push(byId.note);
			} else {
				notes.push(byId.note);
			}
		}

		if (!player) {
			const byName = await kodikBy('title', row.original_name, row.original_name);

			if (byName.found) {
				player = true;
				kodikId = byName.row.id;
				ru = byName.row.title || '';
				via = 'kodik:name';
				country = pickCountry(row.origin_country, (byName.row.material_data?.countries || []).map((c) => normName(c)));
				notes.push(byName.note);
			} else {
				notes.push(byName.note);
			}
		}

		// Имя, по которому ищем, могло быть английским, а плеер лежать под русским названием:
		// тогда нужен Lookup по имени, он даёт номер Kinopoisk и русское имя.
		if (!player && kpUsed < LOOKUP_CAP) {
			const lookup = await kpLookup(row.original_name);

			notes.push(lookup.note);

			if (lookup.kp) {
				ru = lookup.ru || ru;
				country = pickCountry(row.origin_country, lookup.country);

				const byKp = await kodikBy('kinopoisk_id', lookup.kp, '');

				if (byKp.found) {
					player = true;
					kodikId = byKp.row.id;
					via = 'kodik:kp';
					notes.push(byKp.note);
				} else {
					notes.push(byKp.note);

					// Подстроку Kodik не чинит: поиск по-русски — отдельная попытка, как в модуле.
					if (lookup.ru) {
						const byRu = await kodikBy('title', lookup.ru, lookup.ru);

						notes.push(byRu.note);

						if (byRu.found) {
							player = true;
							kodikId = byRu.row.id;
							via = 'kodik:ru';
							ru = lookup.ru;
						}
					}

					if (!player) {
						const alloha = await allohaBy(lookup.kp);

						if (alloha.found) {
							player = true;
							via = 'alloha';
							notes.push(alloha.note);
						} else {
							notes.push(alloha.note);
						}
					}
				}

				if (!ru) ru = lookup.ru;

				if (lookup.kp) kp = lookup.kp;
			}

			await sleep(PAUSE_MS);
		}

		if (!player) noPlayer++;

		// «За месяц» — это тайтл, у которого серия вышла внутри последних тридцати дней:
		// у TMDB нет окна месяца, и это единственное, чем его можно заменить.
		if (!aired || aired < monthAgo) outsideWindow++;

		if (!country.here) excluded++;

		rows.push({
			id: row.id,
			kp: kp || '',
			title: (hasCyrillic(ru) ? ru : row.original_name),
			orig: row.original_name,
			country: country.code,
			here: country.here,
			pop: Number(row.popularity).toFixed(1),
			air: aired || 'нет даты',
			inWindow: Boolean(aired && aired >= monthAgo),
			player,
			kodikId,
			via,
			poster,
			genre: (detail.data?.genres?.[0]?.name || '').toString(),
			year: (aired || '').slice(0, 4),
			note: notes.join('; ')
		});
		}
	}

	saveCache({ counts: { candidates, excluded, outsideWindow, noPlayer, kpUsed }, rows });

	const ordered = rows.filter((card) => card.here).sort(
		(a, b) => (hasCyrillic(a.title) ? 0 : 1) - (hasCyrillic(b.title) ? 0 : 1) || (a.air < b.air ? 1 : -1)
	);

	const playable = ordered.filter((card) => card.player && card.inWindow);
	const perCountry = new Map();
	const shown = [];

	for (const card of playable) {
		const used = perCountry.get(card.country) || 0;

		if (used >= PER_COUNTRY_CAP) continue;

		perCountry.set(card.country, used + 1);
		shown.push(card);

		if (shown.length >= CARD_LIMIT) break;
	}

	console.log(`кандидатов: ${candidates} (TMDB popularity + trending/week)`);
	console.log(`вне правила стран: ${excluded}; без плеера: ${noPlayer}; серия вышла раньше месяца: ${outsideWindow}`);
	console.log(`Lookup по имени: ${kpUsed} из ${LOOKUP_CAP}`);
	console.log(`карточек, которые прошли бы все правила: ${shown.length}`);
	console.log('');

	for (const [index, card] of ordered.entries()) {
		console.log(
			`${String(index + 1).padStart(2)}. ${card.title} | ${card.country} | pop ${card.pop} | серия ${card.air}` +
				`${card.inWindow ? ' (в окне месяца)' : ' (вне окна)'} | плеер ${card.player ? 'есть, ' + (card.kodikId || card.via) : 'нет'} | ${card.note}`
		);
	}

	console.log('');
	console.log('то, что попало бы в карусель:');

	for (const [index, card] of shown.entries()) {
		const href = card.kp ? `/watch?kp=${card.kp}&type=series` : card.kodikId ? `/watch?id=${card.kodikId}&type=series` : `/watch?title=${encodeURIComponent(card.title)}&type=series`;

		console.log(`${String(index + 1).padStart(2)}. ${card.title} (${card.country}, ${card.year}, ${card.genre}) — ${href}`);
	}

	if (!WRITE) {
		console.log('');
		console.log('в базу ничего не писали: передайте --write, чтобы проверить карусель в живую.');

		return;
	}

	const pb = new PocketBase(PB_URL);

	await pb.collection('_superusers').authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);

	const existing = await pb.collection(COLLECTION).getFullList({ sort: 'pos' });

	fs.mkdirSync(path.dirname(BACKUP), { recursive: true });

	// Backup не перезаписываем, если в нём уже есть записи: второй проход иначе затирает
	// прежний снимок пустым списком (так случилось 2026-11-04 при первом записывающем прогоне).
	if (!fs.existsSync(BACKUP) || !JSON.parse(fs.readFileSync(BACKUP, 'utf8')).length) {
		fs.writeFileSync(BACKUP, JSON.stringify(existing, null, 1));

		console.log(`прежние записи сохранили: ${BACKUP} (${existing.length})`);
	} else {
		console.log(`backup уже был: ${BACKUP} — не трогали`);
	}

	const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

	for (const record of existing) await pb.collection(COLLECTION).delete(record.id);

	for (const [index, card] of shown.entries()) {
		await pb.collection(COLLECTION).create({
			day,
			pos: index + 1,
			nameKey: normName(card.title),
			windowDay: day,
			title: card.title,
			year: card.year,
			genre: card.genre,
			episode: '',
			poster: card.poster ? (card.poster.startsWith('http') ? card.poster : `https://image.tmdb.org/t/p/w300/${card.poster}`) : '',
			kinopoiskId: card.kp,
			imdbId: '',
			kodikId: card.kodikId,
			player: true,
			via: 'test-month',
			sourceUrl: `https://www.themoviedb.org/tv/${card.id}`,
			checkNote: 'тест: популярность за месяц',
			checkDay: day,
			country: card.country
		});
	}

	console.log(`записали ${shown.length} карточек в ${COLLECTION}`);
}

main().catch((error) => console.error(error?.message || error));

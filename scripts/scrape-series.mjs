#!/usr/bin/env node
/*
 * scripts/scrape-series.mjs — фоновый наполнитель карусели «Сериалы».
 *
 *   node --env-file=.env --import ./scripts/alias-register.mjs ./scripts/scrape-series.mjs --once
 *   node --env-file=.env --import ./scripts/alias-register.mjs ./scripts/scrape-series.mjs --watch --interval 30
 *
 * Почему сервис, а не страница. До 2026-11-05 проход запускал блок главной: каждое
 * открытие вкладки «Сериалы» обращалось к Kodik, Alloha, TMDB, Kinopoisk и myshows.
 * Замеры 2026-11-05:
 *   чтение готового снимка из PocketBase — 5 мс (см. шапку src/lib/shared/net.js);
 *   один проход отбора — до 150 проверок кандидатов, сетевых ответов на это уходит
 *   около двух минут: с бюджетом 150 он принёс 12 карточек. Посетитель ждал именно эти
 *   минуты, и каждое повторное открытие страницы повторяло ожидание и расходовало квоту
 *   источников (Kinopoisk 500 запросов в сутки, у TMDB и myshows свои потолки).
 *   Теперь страница читает только базу, а проверки делает этот сервис.
 *
 * Проход вызывает ту же функцию отбора, что вызывал блок (refreshSeriesSnapshot), поэтому
 * правила остались одни: окно 30 дней по Москве, round-robin по странам, 20 мест,
 * не больше 3 от одной страны, и карточка без плеера в снимок не пишется. Реализация
 * одна — алиас $lib для Node разрешает scripts/alias-loader.mjs.
 *
 * Повторный проход в тот же день почти не сетевит: ответы источников лежат в netCache на
 * сутки, а кандидат, проверенный сегодня (checkDay == день), повторно не проверяется.
 * Получасовой смысл в том, что первый проход дня случается сам, а не когда кто-то открыл
 * страницу, и новые серии, появившиеся у источников в течение дня, добираются в тот же день.
 */
import pb from '$lib/shared/pocketbase';
import { todayKey } from '$lib/shared/moscowDate';
import { refreshSeriesSnapshot } from '$lib/shared/seriesSource';

const args = process.argv.slice(2);

function flag(name, dflt) {
	const named = args.find((a) => a.startsWith(`--${name}=`));

	if (named) return named.split('=').slice(1).join('=');

	const bare = args.indexOf(`--${name}`);

	if (bare >= 0) {
		const next = args[bare + 1];

		if (next && !next.startsWith('--')) return next;

		return true;
	}

	return dflt;
}

const WATCH = Boolean(flag('watch', false));
const INTERVAL_MIN = Number(flag('interval', 30));
const COLLECTION = 'series_carousel';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function clock() {
	return new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
}

// Вход в базу с повтором. Замер 2026-11-06: с 04:20 до 06:51 по Москве PocketBase отвечал
// ошибкой «Something went wrong while processing your request» — восемь проходов подряд
// ничего не записали, хотя выборка была готова (по порогу оценки 40 кандидатов). Правила
// тут ни при чём: отказывало соединение с базой. Поэтому вход пробуем ещё раз через 5 секунд
// и в строке лога показываем код ответа — по нему видно, что именно отказало, база или отбор.
async function auth() {
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			await pb.collection('_superusers').authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);

			return;
		} catch (error) {
			console.log(`[series] ${clock()}: вход в базу, попытка ${attempt}: ${error?.status || 0} ${error?.message || error}`);

			if (attempt < 2) await sleep(5000);
			else throw error;
		}
	}
}

async function run() {
	if (!pb.authStore.isValid) {
		await auth();
	}

	const day = todayKey();
	const result = await refreshSeriesSnapshot();

	// Снимок по состоянию на сегодня: его читает блок главной.
	const cards = await pb
		.collection(COLLECTION)
		.getList(1, 1, { filter: `day = "${day}" && player = true` })
		.catch(() => null);

	const parts = [
		`карточек ${(cards?.totalItems ?? 0)}`,
		`добавлено ${result.added}`,
		`обновлено ${result.updated}`,
		`убрано ${result.removed}`,
		`проверено ${result.checked}`,
		`по имени ${result.looked}`,
		`без плеера ${result.noPlayer}`,
		`не проверили ${result.unchecked}`,
		`не в наших странах ${result.excluded}`,
		`сверх лимита страны ${result.skipped}`,
		// Качество: сколько кандидатов попало в каждую группу. Числа нужны, чтобы видеть, не
		// пустеет ли лента из-за порога: замер 2026-11-05 — в топ-100 только 6 тайтлов окна из
		// 111 строк myshows. Замер 2026-11-06: 319 кандидатов — 3 в топ-100, 36 по порогу
		// (свежие и старые разделены решением от этого же дня), 278 ниже порога. Последние два
		// числа показывают, работает ли заполнение: «пропущено» — это те, кого не пустили в
		// карусель, когда тайтлов порогу хватило на все места.
		`в топе популярного ${result.tiers?.q1 ?? 0}`,
		`по порогу свежие ${result.tiers?.q2 ?? 0}`,
		`по порогу старые ${result.tiers?.q3 ?? 0}`,
		`ниже порога ${result.tiers?.q4 ?? 0}, пропущено ${result.lowQuality}`
	];

	console.log(`[series] ${day} ${clock()}: ${result.ok ? 'проход' : result.reason} — ${parts.join(', ')}`);
}

run()
	.then(async () => {
		if (!WATCH) return;

		while (true) {
			await sleep(INTERVAL_MIN * 60000);

			try {
				await run();
			} catch (error) {
				console.log(`[series] ${clock()}: ${error?.status || 0} ${error?.message || error}`);
			}
		}
	})
	.catch((error) => console.log(`[series] ${error?.status || 0} ${error?.message || error}`));

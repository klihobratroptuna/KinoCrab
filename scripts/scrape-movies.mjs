#!/usr/bin/env node
/*
 * scripts/scrape-movies.mjs — фоновый наполнитель карусели «Фильмы».
 *
 *   node --env-file=.env --import ./scripts/alias-register.mjs ./scripts/scrape-movies.mjs --once
 *   node --env-file=.env --import ./scripts/alias-register.mjs ./scripts/scrape-movies.mjs --watch --interval 30
 *   node --env-file=.env --import ./scripts/alias-register.mjs ./scripts/scrape-movies.mjs --once --dry-run
 *
 * Почему сервис, а не страница. До 2026-11-06 каждое открытие вкладки «Фильмы» обращалось к
 * источнику, а правило-гейт требовало проверки каждого кандидата: в ленте только тайтлы,
 * найденные нашими плеерами. Замер 2026-11-06: чтение готового снимка — 5 мс, проход пула
 * (~150 кандидатов, пауза 700 мс между запросами Kodik) — около трёх минут. Посетитель ждал
 * эти минуты, и каждое повторное открытие страницы расходовало квоту источников. Теперь
 * страница читает базу, а проверки делает этот сервис.
 *
 * Проход вызывает ту же функцию отбора, что реализована в $lib/shared/movieSource.js, —
 * правила одна: пул TMDB popular страницы 1–3 плюс окно премьер 2025-01-01…сегодня,
 * зрительский порог (6.0 и 50 голосов, внутри окна 10), гейт Kodik по имени, тир рипа, и
 * карточка без плеера не пишется. Алиас $lib для Node разрешает scripts/alias-loader.mjs.
 *
 * Kodik-поиск требует личный токен: публичный отвечает 401, его подставляет nginx. Поэтому
 * сервис работает через прокси — NET_BASE, как остальные cron-обёртки.
 *
 * --dry-run показывает, что проход собрал бы, и ничего не пишет: строки карусели при первом
 * проходе образуются только из тайтлов, прошедших гейт, и по замеру 2026-11-06 таких в пуле
 * единицы. Это и есть следствие правила, а не ошибка прохода.
 */
import pb from '$lib/shared/pocketbase';
import { todayKey } from '$lib/shared/moscowDate';
import { refreshMovieSnapshot } from '$lib/shared/movieSource';

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
const DRY = Boolean(flag('dry-run', false));

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function clock() {
	return new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
}

// Вход в базу с повтором — тот же подход, что в scrape-series.mjs: PocketBase отвечал ошибкой
// «Something went wrong while processing your request» несколько проходов подряд, хотя выборка
// была готова. В строке лога показываем код ответа, чтобы было видно, отказало соединение или
// отбор.
async function auth() {
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			await pb.collection('_superusers').authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);

			return;
		} catch (error) {
			console.log(`[movies] ${clock()}: вход в базу, попытка ${attempt}: ${error?.status || 0} ${error?.message || error}`);

			if (attempt < 2) await sleep(5000);
			else throw error;
		}
	}
}

async function run() {
	if (!DRY && !pb.authStore.isValid) {
		await auth();
	}

	const day = todayKey();
	const result = await refreshMovieSnapshot(false, { dryRun: DRY });

	if (!result.ok) {
		console.log(`[movies] ${day} ${clock()}: ${result.reason}`);

		return;
	}

	const parts = [
		`карточек ${result.feed}`,
		`добавлено ${result.added}`,
		`обновлено ${result.updated}`,
		`убрано ${result.removed}`,
		// Лишние ряды одного и того же фильма: проход оставляет один, остальные убирает.
		`дублей убрано ${result.duplicates}`,
		// Числа отбора: проверка не чаще одного раза в сутки (checkDay), поэтому повторный
		// проход в тот же день почти не сетевит. «ниже порога» — кандидаты, которых не пустил
		// зрительский порог; «без плеера» — прошедшие порог, но не найденные Kodik: по замеру
		// 2026-11-06 таких большинство, и лента короткая, пока рипы не появятся.
		`проверено ${result.checked}`,
		`без плеера ${result.noPlayer}`,
		`ниже порога ${result.lowQuality}`
	];

	console.log(`[movies] ${day} ${clock()}: проход — ${parts.join(', ')}`);
}

run()
	.then(async () => {
		if (!WATCH) return;

		while (true) {
			await sleep(INTERVAL_MIN * 60000);

			try {
				await run();
			} catch (error) {
				console.log(`[movies] ${clock()}: ${error?.status || 0} ${error?.message || error}`);
			}
		}
	})
	.catch((error) => console.log(`[movies] ${error?.status || 0} ${error?.message || error}`));

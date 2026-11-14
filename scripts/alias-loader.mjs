/*
 * scripts/alias-loader.mjs — алиасы SvelteKit для Node.
 *
 * Зачем: фоновый сервис «Сериалы» (scripts/scrape-series.mjs) вызывает ту же функцию
 * отбора, что и блок главной страницы — src/lib/shared/seriesSource. Node про алиас $lib
 * ничего не знает, а держать две реализации отбора нельзя: правила (окно 30 дней,
 * round-robin по странам, обязательный плеер) живут в одном месте, и как только появится
 * вторая копия, они разойдутся — страница будет показывать одно, скрипт писать другое.
 * Поэтому алиас разрешаем здесь, и реализация остаётся одна.
 *
 * Вторая задача: SvelteKit разрешает импорт без расширения ('./net' из kodik.js,
 * '$lib/shared/pocketbase' — папка с index.js), Node — нет. Поэтому смотрим, что
 * действительно лежит по пути, и добавляем .js или index.js.
 *
 * $app/environment отвечает browser = false: в Node нет window, и это честно. Кэш дня
 * (preSearch) там живёт в памяти процесса, а кэш снимков (snapshotCache) просто не
 * работает — ровно то же поведение, что на сервере.
 *
 * Запуск (регистрирует scripts/alias-register.mjs):
 *   node --import ./scripts/alias-register.mjs ./scripts/scrape-series.mjs --once
 */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LIB = new URL('../src/lib/', import.meta.url);
const SRC = new URL('../src/', import.meta.url);
const ENV = new URL('./alias-env.mjs', import.meta.url).href;

// Добавляем расширение там, где SvelteKit его допускает, а Node — нет.
// Возвращает null, если трогать не нужно (файл уже на месте или это не наш src).
function fixedUrl(rawUrl) {
	const url = new URL(rawUrl);

	if (!url.href.startsWith(SRC.href)) return null;

	const path = fileURLToPath(url);

	if (existsSync(path) && statSync(path).isFile()) return url.href;

	if (existsSync(`${path}/index.js`)) {
		// Base без косой черты URL понимает как файл, поэтому папку нужно писать
		// с чертой: иначе index.js встал бы рядом с папкой, а не внутри неё.
		return new URL('index.js', new URL(`${url.href}/`)).href;
	}

	if (existsSync(`${path}.js`)) return `${url.href}.js`;

	return null;
}

export async function resolve(specifier, context, nextResolve) {
	if (specifier === '$app/environment') {
		return { url: ENV, format: 'module', shortCircuit: true };
	}

	if (specifier.startsWith('$lib/')) {
		const fixed = fixedUrl(new URL(specifier.slice('$lib/'.length), LIB));

		if (fixed) return { url: fixed, format: 'module', shortCircuit: true };
	}

	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		const parent = context.parentURL;

		if (parent?.startsWith('file://')) {
			const fixed = fixedUrl(new URL(specifier, parent));

			if (fixed) return { url: fixed, format: 'module', shortCircuit: true };
		}
	}

	return nextResolve(specifier, context);
}

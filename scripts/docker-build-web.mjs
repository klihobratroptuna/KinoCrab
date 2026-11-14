// Помощник сборки web-образа. Причина прошлых неудач: BuildKit перед сборкой
// обращается к auth.docker.io за метаданными базового образа («load metadata for
// nginx:alpine»), и при сбое DNS/TLS сборка падает, даже если образ уже скачан
// локально и интернет в целом работает. Тут: проверяем доступность хаба, пробуем
// сборку несколько раз, и подсказываем запасной путь (legacy-сборщик, который
// берёт базовый образ из локального кэша и не лезет в реестр).

import { spawnSync } from 'node:child_process';

const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 20000);
const BASE_IMAGES = ['node:20-alpine', 'nginx:alpine'];

function run(args, env = process.env) {
	return spawnSync('docker', args, { stdio: 'inherit', env }).status ?? 1;
}

function cached(image) {
	return spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
}

async function hubCheck() {
	const started = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10000);
	try {
		const res = await fetch(
			'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/nginx:pull',
			{ signal: controller.signal }
		);
		console.log(`Docker Hub: HTTP ${res.status} за ${Date.now() - started} мс`);
		return res.ok;
	} catch (error) {
		console.log(`Docker Hub не отвечает: ${error.message} (ждём ${Date.now() - started} мс)`);
		return false;
	}
}

if (process.argv.includes('--legacy')) {
	console.log('Собираем legacy-сборщиком (без запроса метаданных у реестра)...');
	for (const image of BASE_IMAGES) {
		if (!cached(image)) {
			console.log(`Нет локального кэша для ${image} — офлайн-сборка невозможна.`);
			process.exit(1);
		}
	}
	const legacyEnv = { ...process.env, DOCKER_BUILDKIT: '0' };
	const status = run(['build', '-t', 'kinofree-login-modal-web:latest', '.'], legacyEnv);
	if (status === 0) run(['compose', 'up', '-d', 'web']);
	process.exit(status);
}

const hub = await hubCheck();
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
	console.log(`Попытка ${attempt} из ${ATTEMPTS}: docker compose build web`);
	if (run(['compose', 'build', 'web']) === 0) {
		run(['compose', 'up', '-d', 'web']);
		process.exit(0);
	}
	if (attempt < ATTEMPTS) {
		console.log(`Пауза ${RETRY_DELAY_MS / 1000} с перед повтором.`);
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
	}
}

console.log('Сборка не удалась. Базовые образы в локальном кэше:');
for (const image of BASE_IMAGES) {
	console.log(`  ${image}: ${cached(image) ? 'есть' : 'нет'}`);
}
console.log(
	hub
		? 'Хаб отвечает — скорее всего временный сбой, повтори позже.'
		: 'Хаб сейчас не отвечает — это сетевой путь Docker (DNS/TLS), а не сам проект.'
);
console.log('Запасной вариант: node scripts/docker-build-web.mjs --legacy');
console.log('(он берёт базовые образы из локального кэша; npm-зависимости всё равно нужны из сети)');
process.exit(1);

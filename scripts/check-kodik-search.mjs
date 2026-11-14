// Проверка: чем может публичный токен, который парсится из скрипта плееров Kodik
// (то же, что делает kodikwrapper.getPublicToken). Сравниваем search и get-player
// на хосте, который использует проект (kodik-api.com).
const UA = 'kinofree-anime-sync/1.0 (https://kinofree.su)';
const TOKEN_RE = /token\s*[=:]\s*["'](?<token>[0-9a-f]+)["']/i;

async function get(url) {
	const res = await fetch(url, { headers: { 'User-Agent': UA } });
	return { status: res.status, text: await res.text() };
}

let token = '';
for (const url of [
	'https://kodik-add.com/add-players.min.js?v=2',
	'https://kodik.info/callback/3'
]) {
	try {
		const answer = await get(url);
		const found = answer.text.match(TOKEN_RE)?.groups?.token ?? '';
		console.log(`${url} -> HTTP ${answer.status} | токен: ${found || 'не найден'}`);
		if (found) {
			token = found;
			break;
		}
	} catch (error) {
		console.log(`${url} -> ошибка: ${error.message}`);
	}
}

if (!token) {
	console.log('Токен получить не удалось — проверки поиска пропущены.');
} else {
	const tests = [
		`https://kodik-api.com/search?token=${token}&types=anime&limit=2&shikimori_id=21`,
		`https://kodik-api.com/search?token=${token}&types=anime&limit=2&keyword=Vagabond`,
		`https://kodik-api.com/get-player?token=${token}&kinopoiskID=382731`
	];

	for (const url of tests) {
		try {
			const answer = await get(url);
			console.log(
				`${url.replace(token, 'TOKEN')} -> HTTP ${answer.status} | ${answer.text.slice(0, 260)}`
			);
		} catch (error) {
			console.log(`ошибка: ${error.message}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
}

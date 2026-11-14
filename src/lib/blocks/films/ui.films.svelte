<script>
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { apiSearchFilm, apiPopularFilms, apiRecomendFilms } from '$lib/shared/api';
	import { ResultList } from '$lib/elements/result';
	import watchHistory from '$lib/shared/scripts/watchHistory';
	import pb from '$lib/shared/pocketbase';
	import { confirmSession } from '$lib/shared/auth';
	import { normTitle, numberFromAddress, profileCard, searchLocal } from '$lib/shared/localSearch';
	import filmCache from '$lib/shared/scripts/filmCache';
	import { browser } from '$app/environment';

	export let type = 'search';

	$: LoadFilms(type);

	let nothing = { disable: true };
	let params;
	let currentPage = 1;
	let films = [];
	let listName = '';
	let canDelete = false;
	let lastSignature = '';

	// Блок показываем не больше десяти карточек. Без ограничения на одном тайтле их
	// выходит 20+, и каждая карточка, попавшая в экран, делает запрос к Kinopoisk ради
	// года и типа (см. resultCard: данные дозаполняются при появлении карточки).
	// Ограничение — на то, что показываем; ответ endpoint остаётся полным.
	const CARD_CAP = 10;

	// Повтор без Ctrl+F5: неудачный ответ нигде не запоминается, поэтому следующая
	// попытка действительно может пройти — на замере первая попытка висела, а те же
	// адреса в следующем раунде отвечали за 1-250 мс. Кнопку показываем только там,
	// где повтор имеет смысл: сетевая ошибка или 5xx (отказ 4xx даст то же самое).
	let canRetry = false;
	let retryBusy = false;

	async function retry() {
		if (retryBusy) return;

		retryBusy = true;
		await LoadFilms(type, true);
		retryBusy = false;
	}

	// Причина по фактическому ответу: раньше текст всегда был про 12 секунд, даже когда
	// источник ответил 429 (лимит запросов на ключ) или 400 (неверный параметр запроса).
	// where показывает путь запроса: через контейнер или из браузера — на холодном старте
	// контейнер отвечает, а маршрут браузера падает, и это видно по строке.
	function failText(reason, status, notes) {
		const where = notes?.length ? ` (${notes.join(' · ')})` : '';

		if (status === 429) {
			return `Kinopoisk API ответил 429: лимит запросов для ключа — подожди и обнови страницу${where}`;
		}
		if (status) {
			return `Kinopoisk API ответил ${status}${where}`;
		}
		return `Kinopoisk API ${reason || 'не ответила'}${where}: мешает сеть или прокси nginx`;
	}

	async function getSearch() {
		if (!browser) return;
		params = Object.fromEntries($page.url.searchParams);
		let failed = false;
		let reason = '';
		let status = 0;
		let notes = [];
		let localNote = '';
		let localFailed = false;

		if (params.key) {
			listName = 'Вот что нашли';

			// Сначала свои карусели: PocketBase отвечает сразу, и карточка появляется,
			// даже когда маршрут к Kinopoisk висит — на замере первая попытка к нему
			// висит до 12 секунд, а повторные проходят за 100-900 мс.
			const local = currentPage == 1 ? await searchLocal(params.key) : { items: [], failed: false, reason: '' };
			localNote = local.failed ? `PocketBase не ответил (${local.reason}): свои карусели не проверили` : '';
			films = local.items;

			let searched = await apiSearchFilm(params.key, currentPage);
			failed = searched.failed;
			reason = searched.reason || '';
			status = searched.status || 0;
			notes = searched.notes || [];

			// Дубликат не показываем: если Kinopoisk назвал тот же тайтл или тот же id,
			// карточка одна — та, что из карусели (она ведёт на источник карусели).
			const localKeys = new Set(films.map((film) => film.key));
			const localIds = new Set(films.map((film) => String(film.filmId || '')).filter(Boolean));
			films = [...films, ...(searched.films || []).filter((film) => {
				const title = normTitle(film.nameRu || film.nameEn || film.nameOriginal || '');
				const id = String(film.film_id || film.filmId || film.kinopoiskId || '');
				return !localKeys.has(title) && !localIds.has(id);
			})];

			localFailed = local.failed;
		}
		if (params.popular == '') {
			let populars = await apiPopularFilms(currentPage);
			films = populars.items || [];
			failed = populars.failed;
			reason = populars.reason || '';
			status = populars.status || 0;
			notes = populars.notes || [];
			listName = 'Популярное';
		}

		// Если запрос не прошёл, список всё равно показываем пустым и говорим причину:
		// без этого блок показывал только загрузку, потому что запрос висел без таймаута.
		// Если не нашли ничего, видно, что проверили и Kinopoisk, и свои карусели.
		nothing = {
			title: 'Ничего не найдено',
			text: failed
				? failText(reason, status, notes)
				: localNote || 'Попробуйте другой запрос: искали в Kinopoisk и в своих каруселях',
			disable: false
		};
		// Повтор имеет смысл и при отказе Kinopoisk, и когда не ответила база: на холодном
		// старте первая попытка падает, следующая проходит за 1-250 мс.
		canRetry = (failed && (!status || status >= 500)) || localFailed;
	}

	async function getHistory() {
		// На сервере localStorage нет: без проверки сборка ругается и страница
		// профиля рисуется уже в браузере. В браузере история работает как раньше.
		if (!browser) return;

		films = watchHistory.get();
		nothing = {
			title: 'История пуста',
			text: 'Здесь будет список фильмов, которые вы смотрели на своём устройстве',
			disable: false
		};
		canDelete = true;
	}

	async function getBase(status) {
		if (!browser) return;

		// Вход подтверждаем обращением к базе: токен из localStorage может быть жив по сроку,
		// когда запись пользователя уже удалена (замер 2026-11-07: чтение списка молча
		// вернуло 0 строк, запись списка — 400). Без проверки блок профиля висел с пустым
		// списком и без объяснения, хотя выглядело это как успешный вход.
		const session = await confirmSession();
		if (!session) {
			films = [];
			nothing = {
				title: 'Список пуст',
				text: 'Сессия не подтверждена: пользователя нет в базе — войдите в аккаунт заново',
				disable: false
			};
			return;
		}

		// PocketBase отвечает по localhost почти сразу, но на холодном старте контейнер
		// может ещё не подняться: без исключения здесь блок оставался с загрузкой.
		try {
			films = await pb.collection('lists').getFullList({
				filter: `status = "${status}"`
			});
		} catch (error) {
			films = [];
			canRetry = true;
			nothing = {
				title: 'Список пуст',
				text: `PocketBase не ответил (${error?.message || error?.name || 'сеть'}): возможно, контейнер ещё не поднялся`,
				disable: false
			};
			return;
		}

		// Список хранит только числовой ключ (поле film_id числовое), поэтому карточка раньше
		// разрешалась только через Kinopoisk: аниме с числовым id Shikimori показывалось чужим
		// фильмом (замер: 63293 → «Jaali Note» 1960). Сначала смотрим в своих коллекциях — если
		// тайтл там есть, карточка берётся из своей записи теми же полями, что у карточек
		// карусели, и ссылка ведёт на нашу страницу. Дизайн карточки тот же, что у фильмов.
		//
		// Если тайтла в своих коллекциях нет, берём то, что уже лежит в filmCache — это тот же
		// источник, который карточка читала сама. Замер: когда данные приходили через
		// асинхронный путь карточки, на первом рендере показывались только рейтинг и постер,
		// а заголовок оставался «Фильм 7378605»; название появлялось только после
		// перерисовки. Здесь данные попадают в record до рендера, поэтому карточка фильма
		// сразу показывает то, что была бы показала после перерисовки.
		films = await Promise.all(
			films.map(
				async (record) =>
					Object.assign(record, (await profileCard(record.film_id)) || filmCache.get(record.film_id) || {})
			)
		);

		console.log(films);
		// Успешный ответ: сообщение о проблеме не нужно, остаётся только «список пуст».
		// Раньше это сообщение писал блок ниже и затирал причину, если база не ответила.
		nothing = { title: 'Список пуст', text: '', disable: false };
		canDelete = false;
	}

	async function getRecomends() {
		if (!browser) return;
		params = Object.fromEntries($page.url.searchParams);
		listName = 'Связанное';

		// Endpoint связей понимает только номер материала в Kinopoisk. В адресе /watch номер
		// бывает не всегда: карточка карусели ведёт по номеру в параметре kp, по id Shikimori,
		// по id Kodik или по id записи календаря. Поэтому номер сначала ищем в самом адресе,
		// а если его там нет — в своей коллекции того вида, которым открыта страница: у
		// большинства записей номер лежит в поле kinopoiskId. Без настоящего номера блок не
		// грузим: без него он висел с загрузкой и писал причину, которой нет в ответе.
		const key = params.kp || params.id;
		const target = await numberFromAddress(key, params.type);

		if (!target.number) {
			films = [];
			// Если ничего не нашлось, блока на странице нет совсем: пустое состояние с
			// иконкой и заголовком тоже убрано (просьба 2026-11-10). Показываем блок
			// только когда запрос действительно не прошёл — там есть причина и кнопка повтора.
			nothing = {
				title: 'Связанного нет',
				text: target.failed ? `PocketBase ${target.reason}` : '',
				disable: !target.failed
			};
			canRetry = Boolean(target.failed);
			return;
		}

		// Ошибку запроса не пускаем дальше: иначе films остаётся пустым и список
		// бесконечно показывает загрузку. Причина — фактический ответ, а не заученная
		// строка про 12 секунд: на холодном старте чаще всего не отвечает маршрут
		// браузера, а прокси контейнера в этот же момент отвечает за 200-300 мс.
		const answer = await apiRecomendFilms(Number(target.number)).catch((error) => ({
			items: [],
			failed: true,
			status: 0,
			reason: error?.message || error?.name || 'не дошёл',
			notes: [],
			retry: true
		}));

		films = answer.items.slice(0, CARD_CAP);

		// Заголовок остаётся коротким («Связанное») на всех страницах: счёт карточек
		// на страницу не выносим, по просьбе 2026-11-10. Ограничение при этом никуда
		// не девается — просто оно не видно на экране.

		nothing = {
			title: 'Связанного нет',
			// Пустой ответ API — блока на странице нет: ни заголовка, ни строки. Блок
			// остаётся только при неудачном запросе (там причина и кнопка повтора).
			text: answer.failed ? failText(answer.reason, answer.status, answer.notes) : '',
			disable: !answer.failed
		};
		canRetry = Boolean(answer.retry);
	}

	async function LoadFilms(t, force = false) {
		// Двойной запуск на одной странице: $: вызывает LoadFilms при монтировании, а
		// afterNavigate — после навигации, и при первой загрузке это одно и то же.
		// Замер 2026-11-10: каждый запрос уходил дважды, и для блока связей это два
		// обращения к Kinopoisk на одну открытую страницу при суточном бюджете ключа.
		// Повтор того же набора пропускаем; кнопка «повторить» зовёт LoadFilms с force
		// и обходит пропуск.
		// searchParams трогаем только в браузере: на prerender SvelteKit запрещает
		// читать url.searchParams, и сборка падает (замер: Error «Cannot access
		// url.searchParams on a page with prerendering enabled» на странице /profile).
		const signature = browser ? `${t}|${[...$page.url.searchParams.entries()].sort().join('&')}` : '';

		if (browser && !force && signature === lastSignature) return;

		lastSignature = signature;

		films = undefined;
		canRetry = false;
		switch (type) {
			case 'search':
				await getSearch();
				break;
			case 'history':
				await getHistory();
				break;
			case 'planned':
				await getBase('planned');
				break;
			case 'view':
				await getBase('view');
				break;
			case 'recomends':
				await getRecomends();
				break;
			default:
				break;
		}
	}

	afterNavigate(async () => {
		LoadFilms(type);
	});
</script>

<ResultList list={films} lable={listName} {nothing} {canDelete} />

{#if canRetry}
	<!-- Тот же смысл, что кнопка на странице фильма: неудачу не запоминаем, поэтому
		 следующая попытка может пройти — чаще всего падает только первая. -->
	<button class="retry" on:click={retry} disabled={retryBusy}>
		{retryBusy ? 'повторяем…' : 'повторить'}
	</button>
{/if}

<style>
	.retry {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		border: 1px solid var(--gray);
		border-radius: 8px;
		background: none;
		color: var(--yellow, #fce802);
		font-family: inherit;
		font-size: 13px;
		padding: 5px 10px;
		cursor: pointer;
	}

	.retry:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>

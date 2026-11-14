<script>
	import { afterNavigate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/elements/button';
	import { page } from '$app/stores';
	import { apiGetFilm } from '$lib/shared/api';
	import filmCache from '$lib/shared/scripts/filmCache';
	import watchHistory from '$lib/shared/scripts/watchHistory';
	import pb from '$lib/shared/pocketbase';
	import { confirmSession } from '$lib/shared/auth';
	import { CheckboxGroup } from '$lib/elements/checkbox';
	import { ExternalIcon } from '$lib/shared/icons';
	import { ErrorTemplate } from '$lib/elements/error';
	import { CrossIcon, RefreshIcon, WifiProblemIcon } from '$lib/shared/icons';
	import blocked from '$lib/shared/stores/blocked';
	import {
		kodikEmbed,
		kodikSearch,
		kodikPlayerByShikimoriId,
		kodikPlayerByKodikId,
		isKinopoiskId,
		isKodikId
	} from '$lib/shared/kodik';
	import { shikimoriSearchByTitle } from '$lib/shared/shikimori';
	import { COLLAPS_ENABLED, collapsEmbed } from '$lib/shared/collaps';
	import { allohaEmbed, isImdbId } from '$lib/shared/alloha';
	import { carouselCardByTitle, calendarRecordByTitle } from '$lib/shared/kinovibe';
	import { cardByTitle, nameType, nameTypes } from '$lib/shared/seriesSource';
	import { KODIK_TYPE } from '$lib/shared/movieSource';
	import { cardByTitleFor } from '$lib/shared/kodikFeed';
	import { playlistForCard } from '$lib/shared/kinovibe/playlist';
	import { animeRecordByName, nameKeyOf } from '$lib/shared/nameIndex';
	import ComplexSubHeder from '$lib/pages/watch/complex.subHeader.svelte';

	// Типы Kodik для дорам. Одно слово «dorama» API считает неверным типом (см. начало
	// kodik.js), дорамы лежат в foreign-serial и foreign-movie. Список через запятую API
	// принимает: проверено живым запросом 2026-11-11 — search?title=Идеальная ложь&
	// types=foreign-serial,foreign-movie ответил тремя своими записями, все foreign-serial.
	// Без фильтра по тому же имени первым мог идти чужой фильм.
	const DORAMA_TYPES = 'foreign-serial,foreign-movie';

	export let film = '';

	// Подпись для строки с типом тайтла в левой колонке. Ничего не выдумываем:
	// берем type из карточки источника, как это делает карточка поиска.
	function showType(type) {
		switch (type) {
			case 'FILM':
				return 'Фильм';
			case 'TV_SERIES':
				return 'Сериал';
			case 'MINI_SERIES':
				return 'Мини-сериал';
			case 'VIDEO':
				return 'Короткометражка';
			default:
				return '';
		}
	}

	// Аниме-режим: в адресе номер аниме на Shikimori, а не номер фильма в Kinopoisk
	// (плитка календаря добавляет type=anime). Плееры привязаны к номеру фильма, по id
	// Shikimori ищет только Kodik, и только по личному токену, поэтому карточку для аниме
	// берём из PocketBase, а плеер — из результата поиска Kodik.
	let animeMode = false;
	let animeRecord = null;

	// Дорамы: в адресе id записи календаря (doramatvId) и type=dorama. Номер фильма в
	// Kinopoisk приходит из Shikimori (externalLinks), его заполняет скрапер; Kodik умеет
	// искать дораму и по id Shikimori. Текст описания с источника мы не сохраняем и не
	// показываем: на странице только фактические поля записи (год, тип, статус).
	let doramaMode = false;
	let doramaRecord = null;
	// Карточка снимка карусели по названию: когда записи в календаре нет, оттуда берём номер
	// фильма, id Kodik и отметку суточной проверки («проверяли, записи нет» или «не ответил»).
	let doramaCard = null;
	// Снимок карусели аниме по имени: когда записи в календаре нет, оттуда берём номер фильма —
	// по нему Kodik отвечает записью франшизы, а не одним сезоном.
	let animeCard = null;

	// Сериалы: в адресе номер фильма (?kp=), id записи Kodik (?id=) или только имя (?title=) —
	// так ведёт карточка карусели, где суточный проход не нашёл ни номера, ни id. По одному
	// имени ищет только Kodik: Alloha и Collaps работают по номеру материала, поэтому в этом
	// режиме проверка одна, как в ветке дорам.
	let seriesMode = false;
	let seriesCard = null;

	// По этому id работают Alloha и Collaps: для аниме и дорамы это номер материала в
	// Kinopoisk из externalLinks Shikimori. Подставлять в него id календаря нельзя: по нему
	// источники показывают первый материал с таким номером — на id дорамы 34641 Alloha выдаёт
	// чужой фильм, это видно на странице. Без номера фильма id остаётся пустым.
	// Адрес может прийти двумя путями: ?id=<id источника> — как раньше, или ?kp=<номер фильма>
	// — путь, который нужен карусели: по номеру фильма Alloha и Collaps работают без поиска по
	// названию, а Kodik через get-player. Оба вида принимаем, номер фильма важнее.
	// Значение считается внутри реактивного выражения: params заполняется в load(), поэтому
	// const, вычисленный один раз при инициализации компонента, остался бы пустым.
	$: playerId =
		animeMode
			? params?.kp || animeRecord?.kinopoiskId || animeCard?.kinopoiskId || ''
			: doramaMode
				? animeRecord?.kinopoiskId ||
					doramaRecord?.kinopoiskId ||
					doramaCard?.kinopoiskId ||
					params?.kp ||
					''
				: params?.kp || params?.id;

	// Краткая строка для дорамы из фактических полей записи: оригинальное название, тип, год,
	// статус. Описания с сайта тут нет — только то, что хранится в записи.
	function doramaSummary(record) {
		return [record?.originalTitle, record?.kind, record?.year, record?.status]
			.filter(Boolean)
			.join(' · ');
	}

	$: rating = {
		score: film?.ratingKinopoisk || film?.ratingImdb || animeRecord?.score || seriesCard?.rating,
		platform: film?.ratingKinopoisk
			? 'Кинопоиск'
			: film?.ratingImdb
				? 'IMDB'
				: animeRecord?.score
					? 'Shikimori'
					: seriesCard?.rating
						? 'TMDB'
						: ''
	};

	// Карточка на Kinopoisk: у фильма страница /film/, у сериала и аниме — /series/.
	// Тип приходит из API в поле type (FILM, TV_SERIES, CARTOON), id сам по себе
	// ничего не определяет, поэтому путь выбираем по типу. Для аниме без номера фильма
	// карточка в Kinopoisk есть только на Shikimori.
	function kpPath(type) {
		const value = String(type || '');
		if (/serial|series/i.test(value)) return 'series';
		if (/^cartoon$/i.test(value)) return 'cartoon';
		return 'film';
	}

	// Записи в календаре может не быть — тогда ссылку берём из карточки снимка карусели:
	// это страница источника, единственное, что есть о тайтле, если агрегаторы его не знают.
	// В карусели «Сериалы» карточка ведёт внутрь проекта, наружу ссылку даёт только этот значок
	// оценки: страница источника есть только там, где оценку взяла TMDB.
	$: kpCard = doramaMode
		? doramaRecord?.sourceUrl || doramaCard?.sourceUrl || ''
		: animeMode
			? animeRecord?.shikimoriUrl || ''
			: seriesMode
				? seriesCard?.sourceUrl || (playerId ? `https://www.kinopoisk.ru/series/${playerId}` : '')
				: `https://www.kinopoisk.ru/${kpPath(film?.type)}/${playerId}`;

	let isLogin;
	let isListed;
	// Замечание к блоку списка. Без него страница молчала: console.error в интерфейсе
	// не видно, а PocketBase отвечал 400, когда токен из localStorage жив, но записи
	// пользователя уже нет (замер 2026-11-07: чтение списка молча вернуло 0 строк,
	// запись списка — 400). Теперь причина показана здесь же, где галки.
	let listNote = '';
	// Ключ записи в списке «Смотрю»/«Буду смотреть». Поле film_id в PocketBase числовое,
	// поэтому ключом может быть только число: номер фильма в Kinopoisk или числовой id Shikimori
	// у аниме. Строковый id источника (serial-78450, movie-53796) в это поле не записать —
	// замер HTTP 400. Без числового ключа блок не показываем: сохранять нечем.
	let listKey = '';

	let players = [];
	let activePlayer = null;
	let activeList = '';
	let params;
	let isBlocked;
	let badId = false;

	// Причина, по которой источник не ответил: сеть (нет ответа) и «нет записи» —
	// это разные вещи. На холодном старте PocketBase ещё не поднялся, и писать
	// «дорамы нет в календаре» было нечестно: запись там есть, просто база не ответила.
	let pbNote = '';
	// Можно ли повторить этот же запрос: true только при сетевой ошибке или 5xx.
	let filmRetry = false;

	// Состояние источника у проверенных плееров (Kodik, Collaps, Alloha): Kodik берёт его из
	// API, Collaps — из кода ответа embed-страницы. Кадр просто открывается по id или по
	// ссылке из статуса: страница больше не пишет, загружился ли он.
	// Ответ источника хранится отдельно от списка плееров. Раньше список собирался заново
	// в начале каждой проверки, поэтому раунд повтора стирал уже полученный ответ: статус
	// становился «поиск», frameSrc пустым, кадр разрушался и плеер загружался заново —
	// при том же самом адресе. Замер 2026-11-10: тайтл находится с первого ответа, но
	// страница пересобирает кадр по три раза. Поэтому удачный ответ не перекрывается, и
	// повторная проверка того же источника кадр не пересобирает. После правки: повтор
	// проверки оставляет тот же iframe, загрузок кадра одна.
	let answered = {};
	let answerKey = '';

	function setStatus(name, value) {
		const previous = answered[name];

		// Уже отвечает — остаётся тот же адрес: новый объект статуса с той же ссылкой ничего
		// не меняет, и неудача не может перекрыть удачный ответ.
		if (previous?.ok && (!value?.ok || value.link === previous.link)) return;

		if (value?.ok) answered[name] = value;

		players = players.map((player) =>
			player.name === name ? { ...player, status: answered[name] || value } : player
		);

		if (activePlayer?.name === name) {
			activePlayer = players.find((player) => player.name === name);
		}
	}

	// Collaps выключен переключателем COLLAPS_ENABLED в $lib/shared/collaps (замер
	// 2026-11-07: источник отвечает 422 на все запросы). Когда он выключен, статус не
	// пишем: строки плеера в списке нет, и пустой кадр не появляется.
	function setCollapsStatus(value) {
		if (!COLLAPS_ENABLED || !value) return;

		setStatus('Collaps', value);
	}

	let lists = [
		{ id: 'planned', label: 'Буду смотреть' },
		{ id: 'view', label: 'Смотрю' }
	];

	// Числовой ключ записи — тот же, что читает профиль (ui.films.svelte и resultCard):
	// номер фильма в Kinopoisk, иначе числовой id Shikimori у аниме. Поле film_id в lists
	// числовое, поэтому для дорам подходит только числовое поле самой записи: строковый id
	// источника (serial-78450) сохранить нельзя. Замер на «Бионический след 1 Сезон (2026)»
	// (запись jds0cqmfowt7m36): kinopoiskId пустой, doramatvId пустой, kodikId = serial-79357,
	// числовой ключ один — kinovibeId 39275.
	function listKeyFor(p, record = null) {
		if (/^\d+$/.test(String(p.kp || ''))) return String(p.kp);

		if (doramaMode) {
			const entry = record || doramaRecord || doramaCard;

			for (const field of ['kinopoiskId', 'doramatvId', 'kinovibeId']) {
				const value = String(entry?.[field] || '');
				if (/^\d+$/.test(value)) return value;
			}

			// Запись календаря, созданная из карусели, номер источника хранит только в slug
			// (carousel-39275). Это тот же kinovibeId, по которому профиль находит запись в
			// drama_carousel, поэтому ключ с ним сходится.
			const slug = /^carousel-(\d+)$/.exec(String(entry?.slug || ''));

			return slug ? slug[1] : '';
		}

		if (seriesMode) {
			// В «Сериалах» ключ один — номер материала в Kinopoisk из карточки снимка. Id записи
			// Kodik (serial-79386) в список не подставляем: поле списка числовое.
			const value = String((record || seriesCard)?.kinopoiskId || '');

			return /^\d+$/.test(value) ? value : '';
		}

		if (/^\d+$/.test(String(p.id || ''))) return String(p.id);

		return '';
	}

	// Состояние списка для текущего ключа: одно чтение на всех режимах, чтобы страница аниме
	// и дорамы не зависела от того, дошла ли очередь источников до ветки фильмов.
	async function readList(key) {
		try {
			isListed = await pb.collection('lists').getFullList({
				filter: `film_id = "${key}"`
			});
			isListed = isListed[0];
			activeList = isListed?.status;
		} catch (error) {
			pbNote = `PocketBase не ответил (${error?.message || error?.name || 'сеть'}): возможно, контейнер ещё не поднялся`;
		}
	}

	// Зависимость от статуса нужна, чтобы iframe пересобрался, когда источник ответит.
	// У проверенных плееров адрес берётся из их статуса; если проверка не прошла, но
	// плеер можно открыть всё равно (softCheck), берём обычный адрес по id. Без номера
	// материала в Kinopoisk адрес не собираем: по id календаря источник показывает первый
	// материал с таким номером, то есть чужой фильм.
	$: frameSrc = activePlayer
		? activePlayer.dynamic
			? activePlayer.status?.link ||
				(playerId && activePlayer.iframe ? activePlayer.iframe + playerId : '')
			: playerId
				? activePlayer.iframe + playerId
				: ''
		: '';

	// softCheck — плеер остаётся кликабельным даже когда проверка не прошла:
	// статус только показывает состояние источника. Kodik без статуса открывать нельзя.
	// Переключение не блокируем: без номера материала в Kinopoisk кадр не строится, но
	// источник остаётся нажимаемым и показывает, почему он ничего не нашёл.
	function setActivePlayer(player) {
		if (player.dynamic && !player.status?.ok && !player.softCheck) return;

		activePlayer = player;
	}

	// Строку не переставляем, когда активный источник уже ответил: перестановка меняет
	// frameSrc, и кадр пересобирается, хотя адрес тот же. Источник открываем только когда
	// он ответил раньше активного — выбор пользователя идёт через setActivePlayer и тут
	// не блокируется.
	function openPlayer(name) {
		if (answered[activePlayer?.name]?.ok) return;

		const player = players.find((entry) => entry.name === name);

		if (player) activePlayer = player;
	}

	// Список серий источника (плейлист Playerjs): играет своим <video>, потому что
	// браузерного игрока из адресов kinovibe собрать нельзя — каждый embed отвечает 404
	// (замер восьми тайтлов снимка 2026-11-01). Эта ветка включается только для строки
	// Kinovibe, существующие источники и их кадры не трогает.
	let videoEl = null;
	let episode = 0;

	async function playEpisode(index) {
		episode = index;

		if (!videoEl) return;

		videoEl.load();

		// Запуск возможен по клику: клик — действие пользователя, без него браузер autoplay
		// не разрешает. Если запретит, пусть играет по кнопке play сам.
		try {
			await videoEl.play();
		} catch {
			// запуск не удался — серия всё равно выбрана, играется по кнопке play
		}
	}

	// Полоса просмотра. Реальное время знает только наш <video>: кросс-доменные iframe
	// его не отдают, поэтому для чужих плееров полоса остаётся нейтральной — без цифр.
	let watched = 0;
	let total = 0;
	let lastSaved = 0;

	function progressKey() {
		return `${params?.type || 'film'}|${params?.kp || params?.id || ''}`;
	}

	// Имя и id, по которым карточка «Последний просмотр» найдёт эту запись: в истории
	// просмотра у карточки снимка бывает только имя, поэтому сохраняем имя и все числовые
	// id, которые страница знает — адресный id, номер фильма, поля записи источника.
	function progressIds() {
		return [
			params?.kp,
			params?.id,
			doramaRecord?.kinopoiskId,
			doramaRecord?.doramatvId,
			doramaRecord?.kinovibeId,
			seriesCard?.kinopoiskId,
			animeRecord?.kinopoiskId,
			animeRecord?.shikimoriId,
			/^carousel-(\d+)$/.exec(String(doramaCard?.slug || seriesCard?.slug || ''))?.[1]
		].filter((value) => value !== null && value !== undefined && value !== '');
	}

	function progressInfo() {
		return {
			name: film?.nameRu || film?.nameEn || film?.nameOriginal || params?.title || '',
			ids: progressIds(),
			episodeName: activePlayer?.status?.playlist?.[episode]?.name || ''
		};
	}

	function clock(seconds) {
		const s = Math.max(0, Math.round(Number(seconds) || 0));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const r = s % 60;

		return h
			? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
			: `${m}:${String(r).padStart(2, '0')}`;
	}

	function percent() {
		if (!total) return 0;

		return Math.min(100, Math.round((watched / total) * 100));
	}

	function onLoadedMetadata() {
		if (!videoEl) return;

		total = videoEl.duration || 0;

		// Возобновляем только если просмотр был в середине: в самом конце
		// возобновлять нечего, а в самом начале полоса просто пустая.
		const saved = watchHistory.getProgress(progressKey(), episode);

		if (saved > 5 && total - saved > 30) {
			watched = saved;
			videoEl.currentTime = saved;
		} else {
			watched = 0;
		}
	}

	function onTimeUpdate() {
		if (!videoEl) return;

		watched = videoEl.currentTime || 0;
		total = videoEl.duration || total;

		// Событие идёт почти на каждую секунду, поэтому пишем не чаще, чем раз в 15 секунд
		if (total > 0 && watched > 5 && Date.now() - lastSaved > 15000) {
			watchHistory.saveProgress(progressKey(), episode, watched, total, progressInfo());
			lastSaved = Date.now();
		}
	}

	// Закрываем страницу — и записываем то, что уже посмотрели. Без этого последние
	// секунды серии теряются: таймер ещё не сработал.
	function flushProgress() {
		if (!videoEl || !total || watched <= 5) return;

		watchHistory.saveProgress(progressKey(), episode, watched, total, progressInfo());
		lastSaved = Date.now();
	}

	// beforeunload ловит только закрытие окна: переход по внутренним ссылкам ловит
	// onDestroy, иначе последние секунды серии не сохранялись и карточка молчала.
	onDestroy(flushProgress);

	async function updateLists(key, activeList) {
		if (!pb.authStore.isValid) {
			listNote = 'Вход не подтверждён: войдите в аккаунт, чтобы сохранять список';
			console.error('Пользователь не авторизован');
			return;
		}

		// Записываем ровно тот ключ, по которому страница читала список: number в lists,
		// поэтому строковый id источника сюда не помещается (PocketBase отвечает 400).
		if (!/^\d+$/.test(String(key || ''))) {
			console.error('updateLists: ключ не числовой:', key);
			return;
		}

		let data = {
			user: pb.authStore.model.id,
			film_id: key,
			status: activeList
		};

		try {
			if (!activeList && isListed) {
				await pb.collection('lists').delete(isListed.id);
			}

			if (isListed && activeList) {
				await pb.collection('lists').update(isListed.id, data);
			}
			if (!isListed && activeList) {
				await pb.collection('lists').create(data);
			}
		} catch (e) {
			// вот здесь будет точная причина 400
			const status = e?.status || 0;
			listNote = status
				? `Список не сохранён: PocketBase ответил ${status}${
						status === 400 ? ' — пользователя нет в базе, войдите заново' : ''
					}`
				: `Список не сохранён: PocketBase не ответил (${e?.message || 'сеть'})`;
			console.error('updateLists error:', JSON.stringify(e?.response?.data ?? e, null, 2));
			return;
		}

		const list = await pb.collection('lists').getFullList({
			filter: `film_id = "${key}"`
		});
		isListed = list[0];
	}

	// Проверки источников вынесены в функцию, чтобы их можно было повторить без
	// перезагрузки страницы. На холодном старте падает чаще всего первая попытка:
	// запросы, которые не прошли за 12 секунд, следующими проходили за 60-250 мс.
	// Повтор нужен и потому, что раньше неудача запоминалась в памяти страницы, и
	// Ctrl+F5 повторял именно её — сообщение висело, хотя маршрут уже работал.
	async function checkSources(force = false) {
		pbNote = '';
		filmRetry = false;

		params = Object.fromEntries($page.url.searchParams);

		// Ответы относятся к конкретной странице: при переходе на другой тайтл их стираем,
		// иначе статус предыдущего фильма остался бы на новой странице. При повторе того же
		// тайтла ответы остаются — именно они нужны, чтобы кадр не пересобирался.
		const key = `${params.type}|${params.kp || params.id}`;

		if (key !== answerKey) {
			answered = {};
			answerKey = key;
			activePlayer = null;
		}
		isBlocked = blocked.includes(params.kp || params.id);
		animeMode = params.type === 'anime';
		doramaMode = params.type === 'dorama';
		seriesMode = params.type === 'series';

		// В аниме-режиме id — это номер аниме на Shikimori, он не похож на номер фильма
		// в Kinopoisk, но по нему работает поиск Kodik, поэтому проверку id пропускаем.
		// В дорама-режиме id — номер записи на источнике, тоже не номер фильма. В режиме
		// фильмов id бывает и номером фильма в Kinopoisk, и id записи Kodik (вид movie-53796)
		// из карточки карусели, когда тайтла в Kinopoisk нет — эту проверку пропускаем для
		// обоих видов. Номер фильма из ?kp= может быть и кодом IMDb (вид tt20597468): по нему
		// отвечает Alloha, поэтому и этот вид считаем пригодным.
		// В «Сериалах» адрес бывает только с названием: карточка снимка без id ведёт по нему.
		// Такой адрес не считаем неверным — по имени Kodik тоже может найти запись, и страница
		// показывает, что плеера нет, а не ошибку адреса.
		badId =
			!animeMode &&
			!doramaMode &&
			!(seriesMode && params.title) &&
			!(
				isKinopoiskId(params.kp || params.id) ||
				isKodikId(params.id) ||
				isImdbId(params.kp || params.id)
			);

		// Вход и состояние списка проверяем до веток по режимам. Раньше isLogin присваивалась
		// только внутри ветки фильмов, поэтому на странице аниме и дорамы блок не появлялся,
		// а когда очередь доходила до фильмов, переключатель показывал состояние с предыдущей
		// страницы и клик правил чужую запись (замер: клик на странице аниме изменил запись
		// фильма 7378605). Ключ для чтения и записи один — readList и updateLists работают по
		// нему же.
		listNote = '';
		listKey = listKeyFor(params);

		// Токен жив по сроку, даже когда записи пользователя уже нет: без проверки блок
		// выглядел как вход, а галки сохраняли список в никуда (замер 2026-11-07: чтение
		// вернуло 0 строк без ошибки, запись списка — 400). Сессию подтверждаем обращением
		// к своей записи; нет записи — сбрасываем вход и пишем причину здесь же.
		const storedUser = pb.authStore.model?.id;
		isLogin = Boolean(await confirmSession());

		if (isLogin && listKey) {
			await readList(listKey);
		} else if (!isLogin && storedUser && listKey) {
			listNote = 'Сессия не подтверждена: пользователя нет в базе — войдите в аккаунт заново';
		}

		const search = { ok: false, label: 'поиск', note: '' };

		// Статус строки берётся из уже полученного ответа: иначе повторная проверка
		// возвращает её в состояние «поиск», frameSrc становится пустым и кадр разрушается.
		const statusFor = (name) => answered[name] || search;

		players = [
			// Alloha: адрес кадра не собирается из id — страницу плеера отдаёт хост из ответа API
			// (data.iframe), и только когда проверка прошла. Без статуса открывать нечего:
			// по адресу API iframe показал бы JSON вместо игрока.
			// frameOnly: страница хоста проверяет, что её открыли во фрейме, и отвечает 404 без
			// referrer, поэтому ссылка «открыть в новой вкладке» для неё не работает.
			{ name: 'Alloha', iframe: '', dynamic: true, status: statusFor('Alloha'), softCheck: true, frameOnly: true },
			// Collaps: строка появляется только когда переключатель включён. Сейчас он
			// выключен — источник закрыт (замер 2026-11-07), кадр собирать не из чего.
			...(COLLAPS_ENABLED
				? [
						{
							name: 'Collaps',
							iframe: 'https://api.tobaco.ws/embed/kp/',
							dynamic: true,
							status: statusFor('Collaps'),
							softCheck: true
						}
				  ]
				: []),
			{ name: 'Kodik', iframe: '', dynamic: true, status: statusFor('Kodik') }
		];

		// Четвёртая строка — только для дорам. Показываем её только когда первые три ничего
		// не нашли (фильтр visiblePlayers), поэтому карточки, где плеер есть, выглядят ровно
		// как раньше. Кадром эту строку собрать нельзя: embed источника отвечает 404 (замер
		// восьми тайтлов снимка 2026-11-01), играет список серий из плейлиста страницы,
		// поэтому у неё нет iframe и нет link в статусе.
		if (doramaMode) {
			players.push({
				name: 'Kinovibe',
				dynamic: true,
				status: statusFor('Kinovibe'),
				softCheck: true,
				fallbackOnly: true
			});
		}

		if (doramaMode) {
			// Клиент версии 0.21 в getFirstListItem обращается к /records/first, которого в
			// сервере PocketBase 0.40 уже нет (он отвечает 404). Поэтому берём список с
			// ограничением в одну запись — этот путь проверен запросом к API.
			let records = [];

			try {
				// Ищем по id источника, как раньше; когда в адресе номер фильма (?kp=, путь
				// карусели), ищем по этому номеру — его пишет суточный проход карусели. Тот же
				// номер позволяет Alloha и Kodik работать без поиска по названию.
				const field = params.kp ? 'kinopoiskId' : 'doramatvId';
				const needle = params.kp || params.id;

				records = await pb
					.collection('dorama_releases')
					.getFullList({ filter: `${field}="${needle}"`, per_page: 1 });
			} catch (error) {
				pbNote = `PocketBase не ответил (${error?.message || error?.name || 'сеть'}): возможно, контейнер ещё не поднялся`;
			}

			doramaRecord = records[0] ?? null;

			// Записи по id нет — пробуем найти по имени: точное равенство по индексу nameKey,
			// LIKE по title только как запасной путь для записей без ключа. Имя сравниваем в
			// двух видах, потому что карточка карусели названа «Баларао 1 Сезон (2026)», а в
			// календаре имя без суффикса сезона. Замер на живых данных (2026-10-31): точный
			// запрос находит запись, когда тайтл в календаре есть («дом удобрений» → 1 запись
			// по nameKey); сегодняшние карточки карусели в календаре отсутствуют, поэтому тут
			// ничего не находится и работает путь карточки снимка.

			if (!doramaRecord) doramaRecord = await calendarRecordByTitle(params.title || '');

			// Записи в календаре нет — берём карточку снимка карусели по названию: оттуда номер
			// фильма, id Kodik и отметка суточной проверки. По отметке видно, что тайтл проверяли
			// и записки нет, а не то, что запрос не ответил: это разные строки.
			doramaCard = doramaRecord ? null : await carouselCardByTitle(params.title || '', force);

			// Для дорамы ключ появляется только здесь — он берется из числовых полей записи или
			// карточки снимка. Читаем состояние по тому же ключу, по которому профиль собирает
			// карточку (profileCard смотрит doramatvId и kinovibeId).

			if (isLogin && !listKey) {
				listKey = listKeyFor(params, doramaRecord || doramaCard);

				if (listKey) await readList(listKey);
			}

			// Заголовок страницы строится из film, поэтому для дорамы подставляем поля записи.
			// Когда записи в календаре нет, берём название из адреса карусели — иначе шапка
			// остаётся пустой.
			film = doramaRecord
				? { nameRu: doramaRecord.title, year: doramaRecord.year }
				: doramaCard?.title || params.title
					? { nameRu: doramaCard?.title || params.title, year: doramaCard?.year || '' }
					: '';

			// В дорама-режиме открытый плеер — Kodik: он единственный умеет искать по названию.
			openPlayer('Kodik');

			if (!doramaRecord) {
				// Карточка карусели дорам ведёт сюда по id Kodik, когда тайтла в календаре нет.
				// Раньше страница останавливалась на «нет записи» и ничего не проверяла. По id
				// Kodik get-player отвечает плеером без поиска и по публичному токену
				// (проверено на тайтлах карусели).
				//
				// Порядок такой же, как в поиске: сначала номер материала в Kinopoisk, потом id
				// конкретной записи, потом имя. По номеру get-player отвечает записью всего
				// материала, а id из карточки — записью того дня, который скрапер выбрал из
				// списка, и серий в ней меньше. Замер живыми запросами по 22 карточкам карусели
				// дорам 2026-11-11: где были оба ключа, номер ответил на 18 и на 9 из них дал
				// больше серий, чем id записи («Идеальная ложь» 4 против 3, «Любовь под
				// прикрытие» 7 против 2, «Сделано в Корее» 12 против 6, «Общий дом» 12 против 6);
				// на 8 карточках пути совпали, меньше номер не дал ни разу. На четырёх карточках
				// с номером ответил только id записи («Летние каникулы»: по номеру пусто),
				// поэтому id записи остаётся запасным, но идёт после номера.
				// Поиск по имени — последний: он требует токен из .env (по публичному search
				// отвечает 401) и с фильтром типов берёт свой материал, а не чужой фильм.
				const kodikId = isKodikId(params.id) ? params.id : doramaCard?.kodikId || '';
				const number = doramaCard?.kinopoiskId || params.kp || '';
				const notes = [];

				// Код IMDb (вид tt20597468) — отдельный точный параметр Kodik и Alloha,
				// проверенный 2026-10-31: /api/alloha/?imdb=tt20597468 ответил тем же
				// материалом, что и ?kp=4859012.
				if (isKinopoiskId(number) || isImdbId(number)) {
					const [byNumber, allohaByNumber, collapsByNumber] = await Promise.all([
						isKinopoiskId(number)
							? kodikEmbed(number, force)
							: kodikSearch({ imdbId: number, types: DORAMA_TYPES }, force),
						allohaEmbed(number, force),
						isKinopoiskId(number) ? collapsEmbed(number, force) : Promise.resolve(null)
					]);

					if (allohaByNumber) setStatus('Alloha', allohaByNumber);
					if (collapsByNumber) setCollapsStatus(collapsByNumber);

					if (byNumber?.ok) {
						setStatus('Kodik', {
							...byNumber,
							note: [byNumber.note, doramaCard?.checkNote, 'записи в календаре нет']
								.filter(Boolean)
								.join(' · ')
						});

						return;
					}

					notes.push(`по номеру ${number} Kodik не ответил`);
				}

				if (kodikId) {
					const byId = await kodikPlayerByKodikId(kodikId, force);

					if (byId.ok) {
						setStatus('Kodik', {
							...byId,
							note: [`Kodik ${kodikId}, id из карточки карусели`, ...notes]
								.filter(Boolean)
								.join(' · ')
						});

						return;
					}

					notes.push(`по id записи ${kodikId} тоже не ответил`);
				}

				if (params.title || doramaCard?.title) {
					const byTitle = await kodikSearch(
						{ title: params.title || doramaCard.title, types: DORAMA_TYPES },
						force
					);

					if (byTitle.ok) {
						setStatus('Kodik', {
							...byTitle,
							note: [byTitle.note, doramaCard?.checkNote, 'записи в календаре нет']
								.filter(Boolean)
								.join(' · ')
						});

						return;
					}

					notes.push(byTitle.note);
				}

				setStatus('Kodik', {
					ok: false,
					label: pbNote ? 'база не ответила' : 'нет записи',
					note: [doramaCard?.checkNote, pbNote, 'дорамы нет в календаре: записи в PocketBase нет', ...notes]
						.filter(Boolean)
						.join(' · '),
					retry: Boolean(pbNote)
				});
				return;
			}

			// Alloha и Collaps проверяют материал по номеру фильма в Kinopoisk. У дорам этого
			// номера в источнике нет, но он есть у Shikimori в externalLinks — его пишет
			// скрапер scripts/scrape-doramas.mjs (--fill-ids), или приходит из адреса карусели.
			// Без номера проверять нечего.
			//
			// Номер идёт первым и для Kodik, как в поиске: по нему get-player отвечает записью
			// всего материала, а id из карточки — записью одного дня, и серий по номеру чаще
			// больше. Замер живыми запросами по 22 карточкам карусели дорам 2026-11-11: где были
			// оба ключа, номер ответил на 18, на 9 из них дал больше серий, чем id записи, на 8
			// пути совпали, меньше — ни разу; на четырёх карточках с номером ответил только id
			// записи, поэтому он остаётся запасным, но идёт после номера.
			const number = doramaRecord.kinopoiskId || params.kp || '';
			const notes = [];

			if (isKinopoiskId(number) || isImdbId(number)) {
				const [byNumber, alloha, collaps] = await Promise.all([
					isKinopoiskId(number)
						? kodikEmbed(number, force)
						: kodikSearch({ imdbId: number, types: DORAMA_TYPES }, force),
					allohaEmbed(number, force),
					isKinopoiskId(number) ? collapsEmbed(number, force) : Promise.resolve(null)
				]);

				if (collaps) setCollapsStatus(collaps);
				if (alloha) setStatus('Alloha', alloha);

				if (byNumber?.ok) {
					setStatus('Kodik', {
						...byNumber,
						note: [byNumber.note, `по номеру ${number}`].filter(Boolean).join(' · ')
					});

					return;
				}

				notes.push(`по номеру ${number} Kodik не ответил`);
			} else {
				setStatus('Alloha', {
					ok: false,
					label: 'нет id',
					note: 'Alloha отвечает только по номеру фильма в Kinopoisk'
				});
				setCollapsStatus({
					ok: false,
					label: 'нет id',
					note: 'Collaps отвечает только по номеру фильма в Kinopoisk'
				});
			}

			// Запасной путь — id собственной записи Kodik (поле kodikId, его заполняет скрапер
			// --fill-kodik по названию): get-player отвечает по нему плеером без поиска и по
			// публичному токену тоже — проверено запросом. Дальше — id записи Shikimori
			// (--fill-ids), поиск Shikimori через прокси по трём вариантам имени: название
			// плитки, оригинальное название из карточки и название без номера сезона.
			// kodikSearch — последний путь, он требует токен из .env, потому что на search
			// публичный токен отвечает 401.
			if (doramaRecord.kodikId) {
				const byId = await kodikPlayerByKodikId(doramaRecord.kodikId, force);

				if (byId.ok) {
					setStatus('Kodik', {
						...byId,
						note: [
							`Kodik ${doramaRecord.kodikId}, ${doramaRecord.kodikNote || 'id взят из записи календаря'}`,
							...notes
						].filter(Boolean).join(' · ')
					});

					return;
				}

				notes.push(`по id записи ${doramaRecord.kodikId} тоже не ответил`);
			}

			const found = doramaRecord.shikimoriId
				? {
						ok: true,
						id: doramaRecord.shikimoriId,
						note: doramaRecord.matchNote
							? `Shikimori ${doramaRecord.shikimoriId}, ${doramaRecord.matchNote}`
							: 'id Shikimori взят из записи календаря'
					}
				: await shikimoriSearchByTitle(doramaRecord, force);

			if (!found?.ok) {
				// ok=false → по id не играем: Shikimori отвечает близкими названиями, и это
				// чужая запись. Замер 2026-10-31: поиск «баларао 1 сезон 2026» дал id 41240
				// («I~ya I~ya I~ya», kind music) → get-player по нему found=false. Раньше
				// страница играла этот id и писала «Kodik не нашёл плеер по id Shikimori»,
				// хотя id относился к чужой записи. Теперь честно: что предложил Shikimori, что
				// ответил Kodik по названию (поиск требует токен из .env: по публичному
				// токену отвечает 401) и откуда взялась запись.
				const origin = String(doramaRecord.matchNote || '').startsWith('запись создана из карусели')
					? 'запись создали из карусели: тайтла нет в списке doramatv, по id его найти нельзя'
					: '';

				const byTitle = await kodikSearch({ title: doramaRecord.title, types: DORAMA_TYPES }, force);

				if (byTitle.ok) {
					setStatus('Kodik', {
						...byTitle,
						note: [
							`Kodik по названию: ${byTitle.note}`,
							...notes,
							origin ? `(${origin})` : ''
						]
							.filter(Boolean)
							.join(' · ')
					});

					return;
				}

				setStatus('Kodik', {
					ok: false,
					label: found?.label || 'не найден',
					note: [found?.note, byTitle.note, origin, ...notes].filter(Boolean).join(' · ')
				});

				return;
			}

			const player = await kodikPlayerByShikimoriId(found.id, force);
			setStatus('Kodik', { ...player, note: player.ok ? found.note : player.note });

			return;
		}

		if (seriesMode && !params.kp && !params.id) {
			// Карточка «Сериалов» без id: в адресе только имя. Берём карточку снимка по имени —
			// там id записи Kodik, который пишет суточный проход (Kodik спрашивается по имени,
			// совпадение имени проверяется внутри kodikSearch). Когда id есть, играем напрямую
			// по нему: get-player отвечает по id записи без поиска. Когда id нет, ищем по имени
			// с фильтром типа — без фильтра Kodik по «Тайны Нортумбрии» ответил movie-26281, это
			// фильм, а не сериал (замер 2026-11-04 по двадцати карточкам снимка: с фильтром
			// отвечает на тринадцати, без фильтра на семи).
			seriesCard = await cardByTitle(params.title || '', force);

			film = seriesCard
				? { nameRu: seriesCard.title, year: seriesCard.year || '' }
				: params.title
					? { nameRu: params.title, year: '' }
					: '';

			// В этом режиме открытый плеер — Kodik: он единственный умеет искать по названию,
			// Alloha и Collaps работают по номеру материала.
			openPlayer('Kodik');

			if (isLogin && !listKey) {
				listKey = listKeyFor(params, seriesCard);

				if (listKey) await readList(listKey);
			}

			if (isKodikId(seriesCard?.kodikId)) {
				const byId = await kodikPlayerByKodikId(seriesCard.kodikId, force);

				setStatus('Kodik', {
					...byId,
					note: byId.ok
						? `Kodik ${seriesCard.kodikId}, id из карточки карусели`
						: `Kodik не нашёл плеер по id ${seriesCard.kodikId} из карточки карусели`
				});

				return;
			}

			const byTitle = await kodikSearch({ title: params.title, types: nameType(seriesCard || {}) }, force);

			setStatus('Kodik', byTitle);

			return;
		}

		if (animeMode) {
			// Клиент версии 0.21 в getFirstListItem обращается к /records/first, которого в
			// сервере PocketBase 0.40 уже нет (он отвечает 404). Поэтому берём список с
			// ограничением в одну запись — этот путь проверен запросом к API.
			let animeRecords = [];

			try {
				animeRecords = await pb
					.collection('anime_releases')
					.getFullList({ filter: `shikimoriId="${params.id}"`, per_page: 1 });
			} catch (error) {
				pbNote = `PocketBase не ответил (${error?.message || error?.name || 'сеть'}): возможно, контейнер ещё не поднялся`;
			}

			animeRecord = animeRecords[0] ?? null;

			// Записи по id нет — пробуем найти по имени: точное равенство по индексу nameKey
			// (миграция pb_migrations/1793440300), LIKE по title только как запасной путь для
			// записей без ключа. Карточка AnimeGO названа с суффиксом сезона («... 2»), а
			// Shikimori ведёт сезон отдельной записью, поэтому короткое имя может привести к
			// другому сезону того же произведения — такое совпадение помечаем отдельно, id из
			// карточки всегда важнее.
			let animeNameNote = '';

			if (!animeRecord) {
				animeRecord = await animeRecordByName(params.title || '');

				if (animeRecord) {
					const full = nameKeyOf(params.title || '');
					const key = animeRecord.nameKey || nameKeyOf(animeRecord.title);
					const title = animeRecord.title || params.title;

					animeNameNote =
						key === full
							? `запись нашли по имени «${title}», id Shikimori из записи: ${animeRecord.shikimoriId}`
							: `запись нашли по короткому имени «${title}» — это другой сезон того же произведения`;
				}
			}

			// Заголовок страницы строится из film, поэтому для аниме подставляем поля записи:
			// иначе шапка остаётся пустой, когда Kinopoisk API не ответил. Записи может не быть —
			// тогда берём имя и год из карточки снимка карусели; оттуда же номер фильма для Kodik.
			animeCard = animeRecord || !params.title ? null : await cardByTitleFor('anime', '', params.title, force);

			film = animeRecord
				? { nameRu: animeRecord.title, year: animeRecord.year || '' }
				: animeCard
					? { nameRu: animeCard.title, year: animeCard.year || '' }
					: '';

			// В аниме-режиме открытый плеер — Kodik: он единственный умеет искать по id Shikimori.
			openPlayer('Kodik');

			// Первый путь — get-player по номеру фильма в Kinopoisk: он тот же, что у результата
			// поиска, и Kodik отвечает по нему записью франшизы. По id Shikimori Kodik привязывает
			// ответ к записи конкретного сезона, поэтому карусель находила меньше серий, чем поиск.
			// Замер живыми запросами 2026-11-11: «Пожиратель звёзд» — Shikimori 44218 даёт 26 серий,
			// номер 4519776 даёт 223; по 10 карточкам онгоинга пути разошлись в четырёх. Номер
			// берём из адреса карусели, иначе из записи календаря, иначе из снимка по имени; id
			// Shikimori остаётся запасным путем, он же отвечает без личного токена.
			const number = params.kp || animeRecord?.kinopoiskId || animeCard?.kinopoiskId || '';
			const shikiId = animeRecord?.shikimoriId || params.id;
			const noRecord = animeRecord ? animeNameNote : pbNote || 'записи в календаре нет — брали по id Shikimori';
			const noteFor = (base) => [base, noRecord].filter(Boolean).join(' · ');
			const byNumber = number ? await kodikEmbed(number, force) : null;

			if (byNumber?.ok) {
				setStatus('Kodik', { ...byNumber, note: noteFor(`Kodik: запись по номеру Kinopoisk ${number}, путь тот же, что у поиска`) });
			} else if (shikiId) {
				const byId = await kodikPlayerByShikimoriId(shikiId, force);

				if (byId.ok) {
					setStatus('Kodik', { ...byId, note: noteFor(byId.note) });
				} else if (animeRecord?.title || animeRecord?.titleEn || params.title) {
					// Название берем из адреса карусели, когда записи в календаре нет: иначе
					// странице нечем искать, кроме id.
					const byTitle = await kodikSearch({
						title: animeRecord?.title || animeRecord?.titleEn || params.title,
						types: 'anime-serial',
						year: animeRecord?.year || animeCard?.year || ''
					}, force);

					setStatus('Kodik', { ...byTitle, note: noteFor(byTitle.note) });
				} else {
					setStatus('Kodik', { ...byId, note: noteFor(byId.note) });
				}
			} else if (number) {
				setStatus('Kodik', { ...byNumber, note: noteFor(byNumber.note) });
			} else {
				setStatus('Kodik', {
					ok: false,
					label: 'нет id',
					note: noteFor('в адресе нет ни номера фильма, ни id Shikimori: искать нечем')
				});
			}

			// Alloha и Collaps проверяют материал по номеру фильма в Kinopoisk. Без номера
			// проверять нечего, ищет только Kodik — по id Shikimori или по названию записи.
			if (number) {
				const [collaps, alloha] = await Promise.all([
					collapsEmbed(number, force),
					allohaEmbed(number, force)
				]);
				setCollapsStatus(collaps);
				setStatus('Alloha', alloha);
			} else {
				setStatus('Alloha', {
					ok: false,
					label: 'нет id',
					note: 'Alloha отвечает только по номеру фильма в Kinopoisk'
				});
				setCollapsStatus({
					ok: false,
					label: 'нет id',
					note: 'Collaps отвечает только по номеру фильма в Kinopoisk'
				});
			}

			return;
		}

		// Фильм по id записи Kodik: карточка карусели фильмов ведёт на эту страницу, когда
		// тайтла нет в Kinopoisk и поиск Kodik нашёл запись по названию (types=movie,
		// foreign-movie). По такому id get-player отвечает плеером без поиска и по публичному
		// токену (проверено на тайтлах карусели), поэтому играем напрямую: номер фильма в
		// Kinopoisk здесь не нужен, и apiGetFilm по строке вида movie-53796 ответил бы ошибкой.
		// Заголовок страницы строится из film, поэтому подставляем название из адреса карусели.
		//
		// Раньше страница здесь останавливалась: проверка id считала movie-53796 неверным
		// номером фильма, и показывалась ошибка «bad id».
		if (!animeMode && !doramaMode && isKodikId(params.id)) {
			film = params.title ? { nameRu: params.title, year: '' } : '';

			// Открытый плеер — Kodik: он единственный работает по id своей записи. Alloha и
			// Collaps проверяют материал по номеру фильма в Kinopoisk, которого здесь нет.
			openPlayer('Kodik');

			const byId = await kodikPlayerByKodikId(params.id, force);

			setStatus('Kodik', {
				...byId,
				note: byId.ok
					? `Kodik ${params.id}, id из карточки карусели`
					: `Kodik не нашёл плеер по id ${params.id} из карточки карусели`
			});

			setStatus('Alloha', {
				ok: false,
				label: 'нет id',
				note: 'Alloha отвечает только по номеру фильма в Kinopoisk'
			});
			setCollapsStatus({
				ok: false,
				label: 'нет id',
				note: 'Collaps отвечает только по номеру фильма в Kinopoisk'
			});

			return;
		}

		// Строку оставляем открытой, если её источник уже ответил: перестановка меняет
		// frameSrc и пересобирает кадр, хотя адрес тот же.
		const keep = activePlayer ? players.find((player) => player.name === activePlayer.name) : null;

		activePlayer = keep && answered[keep.name]?.ok ? keep : players[0];

		// Все три источника проверяются параллельно, чтобы кнопка не ждала дважды. Внутри каждого
		// проверки есть таймаут: без него зависший запрос оставлял бы статус «поиск» навсегда.
		// Номер фильма из ?kp= важнее id записи Kodik: по нему все три источника работают без
		// поиска по названию.
		const target = params.kp || params.id;

		// Источник, который уже ответил, проверяем один раз: ответ лежит в кэше, но сам
		// повтор создавал новый объект статуса и пересобирал кадр при том же адресе.
		const [collaps, kodik, alloha] = await Promise.all([
			answered['Collaps']?.ok ? null : collapsEmbed(target, force),
			answered['Kodik']?.ok ? null : kodikEmbed(target, force),
			answered['Alloha']?.ok ? null : allohaEmbed(target, force)
		]);

		if (collaps) setCollapsStatus(collaps);
		if (kodik) setStatus('Kodik', kodik);
		if (alloha) setStatus('Alloha', alloha);

		try {
			const card = await apiGetFilm(target);

			if (card?.failed) {
				// Kinopoisk сейчас не ответил. Если карточку уже получали раньше,
				// показываем сохранённую: страница тогда не пустая, а описание — из кэса.
				const saved = filmCache.get(target);

				film = saved || card;
				filmRetry = Boolean(card.retry);
			} else {
				film = card;
				watchHistory.add(film);

				// Состояние списка читается один раз в начале checkSources (readList) — по тому же
				// ключу, по которому запись пишется. Здесь чтения нет, чтобы страница фильма не
				// читала список второй раз и не тянула состояние с прошлой страницы.
			}
		} catch (error) {
			console.error(error);
			filmRetry = true;
		}

		// Если по номеру Kodik не ответил, пробуем имя — тот же путь, что у страницы поиска:
		// она находит запись по названию и проверяет совпадение имени и года, поэтому первый
		// результат выдаче не берёт. Фильтр типа обязателен: без него по «Тайны Нортумбрии»
		// Kodik ответил movie-26281, это фильм (замер 2026-11-04, по двадцати карточкам
		// снимка с фильтром отвечает на тринадцати). Список через запятую API принимает
		// (проверено запросом 2026-11-11), одно слово movie — нет: 400 «Неправильный тип»
		// (замер 2026-11-06), поэтому для фильмов список без него.
		//
		// Замер 2026-11-11 по 43 карточкам теперешних лент (30 фильмов, 13 сериалов): по
		// номеру Kodik не ответил ни разу, по имени с фильтром нашлась одна запись и с
		// другим годом — этих тайтлов у Kodik нет, они играются через Alloha. Значит этот
		// блок нужен для карточек, где запись лежит под другим номером; рабочие карточки
		// лишнего запроса не получают, потому что он идёт только после неудачи по номеру.
		if (!answered['Kodik']?.ok && params.title) {
			const cardByName = seriesMode ? await cardByTitle(params.title, force) : null;
			const types = seriesMode ? nameTypes(cardByName || {}) : KODIK_TYPE;
			const byTitle = await kodikSearch(
				{
					title: params.title,
					types,
					year: cardByName?.year || (typeof film === 'string' ? '' : film?.year || '')
				},
				force
			);

			if (byTitle.ok) {
				setStatus('Kodik', {
					...byTitle,
					note: [byTitle.note, `Kodik: запись по имени карточки, фильтр типа ${types}`]
						.filter(Boolean)
						.join(' · ')
				});
			}
		}
	}

	// Порядок: сначала три источника, и только если ни один ничего не нашёл — проверка
	// источника kinovibe по плейлисту. Поэтому рабочие карточки не получают лишнего
	// запроса и лишней строки: лишняя строка появляется только там, где играть нечем.
	async function load(force = false) {
		await checkSources(force);

		if (!doramaMode || players.some((player) => player.status?.ok)) return;

		const status = await playlistForCard(doramaCard || doramaRecord, force);

		setStatus('Kinovibe', status);

		// Если играть было нечем, открываем найденный плейлист сразу: другой источник здесь
		// уже показал, что ничего не нашёл, и выбирать нечего. Без серий источник остаётся
		// просто строкой с тем, что ответил плейлист.
		if (status.ok) {
			openPlayer('Kinovibe');
		}
	}

	// Повтор без перезагрузки страницы. Неудачу мы не запоминаем, поэтому вторая
	// попытка действительно может дать плеер: на замере в один момент первая попытка
	// висела 12 секунд, а те же адреса в следующих раундах отвечали за 1-250 мс.
	// Раундов не больше трёх, пауза между ними растёт, чтобы не долбить источник.
	const MAX_ROUNDS = 3;

	let retryRound = 0;
	let retryBusy = false;
	let retryTimer;

	// Реактивная переменная, а не функция: шаблон должен пересчитаться, когда статус
	// источника меняется. Функция в {#if} зависимостей не видела бы.
	let canRetry = false;
	// Повтор имеет смысл только там, где он может дать другой результат: сетевая ошибка
	// или 5xx. Если источник ответил отказом (404 — материала нет, 422 — отказ), повтор
	// даст то же самое, и кнопку показывать не нужно.
	$: canRetry = players.some((player) => player.status?.retry) || filmRetry || Boolean(pbNote);

	// Список строк «Плееры»: строку Kinovibe показываем только когда первые три ничего не
	// нашли. Для карточек, где плеер есть, состав строк не меняется — те же три.
	// Строка Kinovibe видна только когда остальные источники ничего не нашли: карточки,
	// где плеер работает, выглядят ровно как раньше. Источники сравниваем между собой,
	// без самого Kinovibe — иначе его собственный успех прятал бы его строку.
	$: visiblePlayers = players.filter(
		(player) =>
			!player.fallbackOnly ||
			!players.some((other) => other !== player && other.status?.ok)
	);

	async function retry() {
		if (retryBusy || retryRound >= MAX_ROUNDS || !canRetry) return;

		retryRound++;
		retryBusy = true;

		await load(true);

		retryBusy = false;

		if (canRetry && retryRound < MAX_ROUNDS) {
			clearTimeout(retryTimer);
			retryTimer = setTimeout(retry, 1500 * (retryRound + 1));
		}
	}

	afterNavigate(() => {
		retryRound = 0;
		load(false).then(retry);
	});

	// Маршрут мог подняться уже после проверки — тогда повторяем сразу, без
	// перезагрузки. Контрол+F5 больше не нужен: повтор обновляет только результаты
	// проверок, и удачный ответ уже лежит в кэше.
	if (browser) {
		const onOnline = () => {
			retryRound = 0;
			load(true).then(retry);
		};

		window.addEventListener('online', onOnline);

		onDestroy(() => {
			clearTimeout(retryTimer);
			window.removeEventListener('online', onOnline);
		});
	}
</script>

<svelte:window on:beforeunload={flushProgress} />

<section>
	<div class="box">
		<aside>
			<!-- Чип типа живёт в строке заголовка, рядом с годом: в шапку колонки
				вставляется слот, разметка блока остаётся в этом файле. -->
			<ComplexSubHeder
				title={film?.nameRu || film?.nameEn || film?.nameOriginal}
				year={film?.year}
			>
				{#if showType(film?.type)}
					<span class="badge">{showType(film.type)}</span>
				{/if}
			</ComplexSubHeder>
			<svelte:element
				this={kpCard ? 'a' : 'div'}
				class="rating"
				href={kpCard || undefined}
				target={kpCard ? '_blank' : undefined}
			>
				{#if rating.score > 0}
					<mark
						class:okey={rating.score > 3.9 && rating.score < 7}
						class:bad={rating.score < 4}
					>
						{rating.score}
					</mark>
					<span>{rating.platform}</span>
					{#if kpCard}<ExternalIcon />{/if}
				{/if}
			</svelte:element>

			<div class="actions">
				{#if listKey}
					<!-- Блок работает по числовому ключу: номер фильма в Kinopoisk, для аниме ещё
					 числовой id Shikimori. Строковый id источника (serial-78450) в числовое поле
					 film_id не записать, поэтому без числового ключа блока нет. Дизайн тот же. -->
					<div class="list">
						<h4>Добавить в профиль</h4>
						{#if isLogin}
							<div>
								<CheckboxGroup
									on:change={() => updateLists(listKey, activeList)}
									options={lists}
									bind:value={activeList}
								/>
							</div>
						{/if}
						{#if listNote}
							<p>{listNote}</p>
						{/if}
					</div>
				{/if}
				{#if !isBlocked}
					<div class="sources">
						<h4>Плееры</h4>
						<div>
							{#each visiblePlayers as player}
								<Button
									toggle
									active={activePlayer?.name == player.name}
									disabled={player.dynamic && !player.softCheck && !player.status?.ok}
									on:click={() => setActivePlayer(player)}
								>
									{player.name}
								</Button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<p>
				{film.description ||
					animeRecord?.description ||
					(doramaRecord ? doramaSummary(doramaRecord) : 'Описание не найдено')}
			</p>
		</aside>
		<div class="player">
			{#key frameSrc}
				{#if isBlocked}
					<ErrorTemplate
						title="Заблокированно"
						desc="По просьбе правообладателей, онлайн просмотр данного материалла недоступен"
					>
						<CrossIcon slot="icon" />
						<a href="/" slot="action">
							<Button>
								Перейти на главную <RefreshIcon />
							</Button>
						</a>
					</ErrorTemplate>
				{:else if badId}
					<ErrorTemplate title="Неверный адрес">
						<WifiProblemIcon slot="icon" />
						<a href="/releases" slot="action">
							<Button>
								К графику премьер <RefreshIcon />
							</Button>
						</a>
					</ErrorTemplate>
				{:else if activePlayer?.status?.playlist?.length}
					<!-- Кадр собрать нечем: каждый embed-адрес источника отвечает 404 (замер
						 восьми тайтлов снимка 2026-11-01), поэтому играет файл из плейлиста своим
						 <video>. Эта ветка включается только для строки Kinovibe, а она появляется
						 только когда остальные три источника ничего не нашли — для рабочих карточек
						 здесь ничего не меняется. -->
					<video
						title="player"
						bind:this={videoEl}
						src={activePlayer.status.playlist[episode]?.file}
						controls
						playsinline
						on:loadedmetadata={onLoadedMetadata}
						on:timeupdate={onTimeUpdate}
					></video>
				{:else if frameSrc}
					<!-- referrerpolicy нужен, а не украшение: страница плеера Alloha отвечает 404
						 без referrer и 200 с ним. Если в браузере стоит запрет referrer для сторонних
						 фреймов, кадр остаётся пустым — здесь фиксируем, что referrer уходит. -->
					<iframe
						title="player"
						allowfullscreen="true"
						allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
						sandbox="allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation allow-forms"
						referrerpolicy="no-referrer-when-downgrade"
						src={frameSrc}
					></iframe>
				{:else}
					<!-- Кадр не строим: без номера материала в Kinopoisk источник показал бы
						 чужой материал по первому подходящему id. Показываем, что именно известно. -->
					<ErrorTemplate title="Плеера нет">
						<WifiProblemIcon slot="icon" />
					</ErrorTemplate>
				{/if}
			{/key}

			{#if activePlayer?.status?.playlist?.length}
				<!-- Полоска строится по реальному времени нашего <video>: оно же сохраняется
					 и возобновляется, когда возвращаешься к серии. -->
				<div class="progress">
					<div class="bar">
						<span style="width: {percent()}%" />
					</div>
					<p>
						<span>{clock(watched)}</span>
						{#if total}
							<span>из {clock(total)}</span>
						{/if}
					</p>
				</div>
			{/if}

			{#if activePlayer?.status?.playlist?.length}
				<!-- Список серий того, что ответил плейлист источника: имена берём из его
					 comment, ничего не додумываем. -->
				<div class="episodes">
					{#each activePlayer.status.playlist as ep, index}
						<button
							class="episode"
							class:active={index === episode}
							on:click={() => playEpisode(index)}
						>
							{ep.name}
						</button>
					{/each}
				</div>
			{/if}

			{#if !isBlocked && !badId && (doramaMode || animeMode) && !frameSrc}
				<p class="hint">
					{#if doramaMode && !frameSrc}
						<a href="/releases?type=dorama">календарь дорам</a>
						{#if !doramaRecord && doramaCard?.sourceUrl}
							<a href={doramaCard.sourceUrl} target="_blank" rel="noopener noreferrer">
								страница источника
							</a>
						{/if}
					{/if}
					{#if animeMode && !frameSrc}
						<a href={`/anime?id=${params?.id}${params?.date ? `&date=${params.date}` : ''}`}>
							карточка аниме в календаре
						</a>
					{/if}
				</p>
			{/if}
		</div>
	</div>
</section>

<style lang="scss">
	@import './styles.scss';
</style>

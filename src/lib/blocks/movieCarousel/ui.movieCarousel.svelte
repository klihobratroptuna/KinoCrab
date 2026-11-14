<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { Button } from '$lib/elements/button';
	import { ArrowIcon } from '$lib/shared/icons';
	import { loadMovieSnapshot, movieTileHref } from '$lib/shared/movieSource';
	import { posterUrl } from '$lib/shared/doramaPoster';
	import { todayKey } from '$lib/shared/moscowDate';

	// Карточка фильма, как в карусели аниме и дорам: тайтлы листаются стрелками; страниц тут
	// нет, стрелок недели тоже нет. Порядок теперь не порядок подборки, а правило ленты:
	// зрительский тир, тир рипа, дата появления рипа, год. Эти места считает проход и пишет в
	// поле pos, поэтому страница показывает то, что лежит в базе, и порядок ей не пересчитывает.
	//
	// Источник — своя база: блок читает коллекцию movie_carousel. Раньше здесь разбирали HTML
	// главной страницы kinovibe и зависели от чужого проекта: не ответит страница или изменится
	// разметка — вкладка остаётся на прошлом снимке. Теперь данные наши, а вид карточек тот же:
	// поля title, poster, genre, year, kinopoiskId, kodikId, sourceUrl не менялись; к ним
	// добавлены поля гейта — playerVia, quality, qualityTier, qualitySource, resolution,
	// playerAddedAt, qualityChangedAt, ratingCount, nameKey (миграция 1793961000).
	//
	// Страница только читает: снимок пишет фоновый проход scripts/scrape-movies.mjs, он
	// проверяет кандидатов гейтом и складывает результат в коллекцию. Здесь не было
	// обращения к источнику: замер 2026-11-06, чтение готового снимка — 5 мс, один проход
	// пула — около трёх минут сетевых ответов. Раньше блок сам звал проход при пустом
	// снимке или чужом дне, и посетитель ждал эти минуты; теперь порядок и причина
	// «карточки нет» считаются в проходе, а страница показывает то, что лежит в базе.
	//
	// На карточке две плашки: оценка (поле rating) и качество рипа (поле quality). Обе
	// есть только у тайтлов, прошедших гейт, то есть у тайтлов с нашим плеером. Плашку
	// качества не показываем, когда источник — Alloha: у него поля качества нет (замер
	// 2026-11-06: строка Alloha отвечает по номеру, поля качества в ответе нет). Оценка
	// раньше не показывалась, потому что у фильмов 2026 года её часто нет; теперь лента
	// формируется по порогу (6.0 и 50 голосов, внутри окна премьер — 10), поэтому оценка
	// на карточке есть всегда, и дырки не видно.
	//
	// Данные читаются в браузере: на сервере карусели нет, снимок лежит в коллекции
	// movie_carousel. В базе хранится исходный адрес постера (image.tmdb.org у строк пула, CDN
	// Kinopoisk у строк, записанных раньше), а картинку грузит браузер по пути прокси — по тому же
	// правилу, что в карусели дорам и «Сериалов» ($lib/shared/doramaPoster).
	//
	// Исправление 2026-11-06: раньше блок подставлял прямую ссылку CDN, и на карточках не было ни
	// одного постера. Замер того же дня: из этой сети image.tmdb.org не открывается (в консоли
	// браузера ERR_CONNECTION_REFUSED), а тот же файл по пути прокси /api/tmdb-poster отвечает 200
	// и 80 КБ — nginx держит домен на своём апстриме, потому что имя ведёт на 127.0.0.1. Поэтому
	// карточка показывала первую букву: картинка не загрузилась.
	let cards = null;
	// note больше не выводим: посетителю не нужна техническая информация про
	// снимок источника и фоновый проход, карусель показываем без текста.
	let note = '';
	let sliderEl;
	let atStart = true;
	let atEnd = false;
	// Постер — путь прокси, собранный из исходного адреса поля poster; файл на диске не
	// появляется. Если картинка не открылась, показываем первую букву названия.
	let broken = {};

	// Адрес картинки для img: helper знает хосты и их прокси-префиксы, поэтому он общий с
	// дорамами и «Сериалами», а не копия списка здесь.
	function poster(card) {
		return posterUrl(card);
	}

	// Карточку открываем внутри проекта: по правилу ленты карточка ведёт на наш плеер, и наружу
	// она ведёт только когда открыть внутри нечем — нет числового ключа. После гейта 2026-11-07
	// (карточка ленты обязана иметь числовой ключ Kinopoisk) такого случая в ленте нет, поэтому
	// все карточки одной карусели открываются одинаково, как в «Сериалах» и дорамах.
	//
	// Функция смотрит на ссылку, а не на поля. Раньше она проверяла только kinopoiskId и kodikId и
	// разошлась с адресом: замер 2026-11-07 на карточке «Образцовый гражданин» — href внутренний
	// (/watch?kp=tt13884466), но target="_blank" и класс external, потому что ключа у строки не
	// было. Теперь поведение карточки не может противоречить тому, куда она ведёт.
	function external(card) {
		return !movieTileHref(card).startsWith('/watch');
	}

	onMount(() => {
		if (!browser) return;

		load();
		window.addEventListener('resize', measure);
	});

	onDestroy(() => {
		if (!browser) return;

		window.removeEventListener('resize', measure);
	});

	async function load() {
		const snapshot = await loadMovieSnapshot();
		cards = snapshot.cards;

		// Снимок за вчера — не ошибка: фоновый проход обновит его в свой интервал.
		// Пишем об этом, чтобы посетитель не ждал обновления прямо сейчас.
		if (snapshot.day && snapshot.day != todayKey()) {
			note = `Показан снимок за ${snapshot.day} — обновление пишет фоновый проход`;
		}

		await tick();
		measure();
	}

	function measure() {
		if (!sliderEl) return;

		atStart = sliderEl.scrollLeft <= 1;
		atEnd = sliderEl.scrollLeft + sliderEl.clientWidth >= sliderEl.scrollWidth - 1;
	}

	// Стрелки листают на один экран, как в карусели аниме: на широком экране видно 5
	// карточек, на телефоне — 2, поэтому за шаг берём ширину видимой части, а не одну
	// карточку. Прокрутка и прилипание карточки к левому краю не менялись. Раньше в блоке
	// было ровно 5 карточек источника, и на широком экране листать было нечего; теперь
	// снимок хранит 15 карточек, поэтому листать есть на любой ширине.
	function step(direction) {
		if (!sliderEl) return;

		const distance = sliderEl.clientWidth || sliderEl.scrollWidth;
		sliderEl.scrollTo({ left: sliderEl.scrollLeft + direction * distance, behavior: 'smooth' });
	}

	function letter(title) {
		return (
			String(title || '')
				.trim()
				.charAt(0)
				.toUpperCase() || '?'
		);
	}

	// Год в подборке Kinopoisk — отдельным полем, а не скобками в конце названия. Скобки
	// остались только в старых записях, где имя пришло с kinovibe: «Чужая мама (2026)».
	// Год показываем второй строкой вместе с жанром. Так вторая строка есть у каждой
	// карточки, и высота карточки совпадает с каруселями аниме и дорам, где вторая строка —
	// оригинальное название и строка серий. Название в h3 без года: иначе год повторился бы
	// дважды.
	function yearOf(title) {
		return (String(title || '').match(/\((\d{4})\)$/) || [])[1] || '';
	}

	function titleNoYear(title) {
		return String(title || '').replace(/\s*\(\d{4}\)$/, '').trim() || String(title || '');
	}

	// Страна производства — кодом TMDB, подписью, если она короткая. Поле country пишется из
	// ответа /movie/{id}: строка search/discover через прокси поля origin_country не отдаёт (замер
	// 2026-11-06 вечер), и страна нужна не только для этой строки — по ней лента делится на
	// группы: сначала производство США, потом другие страны, и внутри группы по дате релиза.
	// Кода страны в строке нет, когда запрос /movie/{id} не попал в бюджет прохода: тогда строка
	// остаётся как была — год и жанр.
	const COUNTRY_LABEL = {
		US: 'США', GB: 'Великобритания', KR: 'Южная Корея', TH: 'Таиланд', ID: 'Индонезия', AU: 'Австралия',
		ES: 'Испания', IN: 'Индия', TR: 'Турция', JP: 'Япония', CN: 'Китай', RU: 'Россия', DE: 'Германия',
		FR: 'Франция', CA: 'Канада', IT: 'Италия', SE: 'Швеция', NL: 'Нидерланды', DK: 'Дания',
		NO: 'Норвегия', PL: 'Польша', FI: 'Финляндия', NZ: 'Новая Зеландия', BR: 'Бразилия', HK: 'Гонконг',
		IE: 'Ирландия', BE: 'Бельгия', NG: 'Нигерия', MX: 'Мексика', AR: 'Аргентина'
	};

	function countryLabel(card) {
		const code = String(card.country || '').split(', ')[0] || '';

		return code ? COUNTRY_LABEL[code] || code : '';
	}

	// Вторая строка — год, страна и жанр из подборки Kinopoisk (поля year и genres; genres там
	// массив, жанр берём первым). У фильмов 2026 года жанра часто нет, тогда строка только
	// с годом и страной. У старых записей, где имя пришло из kinovibe, год по-прежнему берётся из
	// скобок в названии.
	function metaLine(card) {
		return [String(card.year || '') || yearOf(card.title), countryLabel(card), card.genre].filter(Boolean).join(' · ');
	}

	// Плашка качества: имя источника и разрешение из полей записи. Поле qualitySource —
	// служебный ключ прохода (webdl, bluray, hdtv, sat, cam), поэтому здесь своя короткая
	// подпись: на карточке 160 px строка «WEB-DLRip 720p» целиком не помещается и плашка
	// лезет на постер. Целое поле quality остаётся в подсказке.
	//
	// Плашки нет, когда тайтл пришёл из Alloha: у источника поля качества нет (замер
	// 2026-11-06), и выдумывать «BDRip» мы не будем — виден только сам факт плеера.
	const RIP_LABEL = { webdl: 'WEB-DL', bluray: 'BDRip', webrip: 'WEB-Rip', hdtv: 'HDTV', sat: 'SATRip', cam: 'CAM', other: 'Рип' };

	function qualityLine(card) {
		const label = RIP_LABEL[card.qualitySource] || '';

		if (!label || label === 'CAM') return '';

		return [label, card.resolution].filter(Boolean).join(' ');
	}

	// Подсказка по плашке: полное качество источника и дата, когда карточка получила плеер.
	// Если качество изменилось сегодня, говорим об этом прямо: карточка двигается в ленте
	// только при реальном улучшении тира, поэтому такая строка не может быть неправдой.
	function qualityHint(card) {
		const day = todayKey();
		const parts = [card.quality || 'без качества'];

		if (card.playerAddedAt) parts.push(`рип от ${card.playerAddedAt}`);

		// «Улучшилось сегодня» говорим только когда дата улучшения не совпадает с датой появления
		// рипа: для новой карточки qualityChangedAt равна playerAddedAt, и там улучшения не было —
		// карточка просто появилась в ленте (проверено 2026-11-06 на Веноме 2024 года).
		if (card.qualityChangedAt == day && card.qualityChangedAt != card.playerAddedAt) parts.push('качество улучшилось сегодня');

		return parts.join(' · ');
	}
</script>

<section class="carousel">
	{#if cards && cards.length}
		<div class="box">
			<Button circle dark nav title="Назад" disabled={atStart} on:click={() => step(-1)}>
				<ArrowIcon left />
			</Button>

			<div class="slider" bind:this={sliderEl} on:scroll={measure}>
				{#each cards as card (card.id)}
					<article class="slide">
						<a
							class="card"
							class:external={external(card)}
							href={movieTileHref(card)}
							target={external(card) ? '_blank' : undefined}
							rel={external(card) ? 'nofollow noopener' : undefined}
							title={card.title}
						>
							<div class="poster">
								{#if poster(card) && !broken[card.id]}
									<img
										src={poster(card)}
										alt={card.title}
										loading="lazy"
										inert
										on:error={() => (broken = { ...broken, [card.id]: true })}
									/>
								{:else}
									<span>{letter(card.title)}</span>
								{/if}

								{#if card.rating}
									<div class="rating">{card.rating}</div>
								{/if}

								{#if qualityLine(card)}
									<div class="quality" title={qualityHint(card)}>{qualityLine(card)}</div>
								{/if}
							</div>

							<div class="text">
								<h3>{titleNoYear(card.title)}</h3>
								<span class="meta">{metaLine(card)}</span>
							</div>
						</a>
					</article>
				{/each}
			</div>

			<Button circle dark nav title="Вперёд" disabled={atEnd} on:click={() => step(1)}>
				<ArrowIcon />
			</Button>
		</div>
	{/if}
</section>

<style lang="scss">
	section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* Карусель — строка внутри панели. Карточки без рамок, стрелки сидят в той же
	   панели у её краёв, а не сбоку от неё. */
	.box {
		position: relative;
		display: flex;
		gap: 12px;
		padding: 4px 14px;

		> :global(button) {
			/* Стрелка лежит поверх постера у края блока и показывается, только пока
			   указатель находится над блоком карусели. */
			position: absolute;
			top: 50%;
			/* Центрируем через translate, а не через transform: у кнопки в Component
			   есть transform: scale(90%) на нажатии, и transform перетирал бы
			   центрирование — стрелка подпрыгивала, отпускание попадало не на кнопку,
			   и клик уходил на блок. */
			translate: 0 -50%;
			z-index: 3;
			opacity: 0;
			pointer-events: none;
			width: 34px;
			height: 34px;
			padding: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border-radius: 100px;
			border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			background: rgba(255, 255, 255, 0.12);
			color: var(--white, #fff);
			transition: opacity ease 0.25s, transform ease 0.25s, background ease 0.25s, border-color ease 0.25s, color ease 0.25s;

			&:disabled {
				opacity: 0;
				cursor: default;
			}

			@include hover {
				background: var(--white, #fff);
				border-color: transparent;
				color: #000;
			}
		}

		> :global(button):first-child {
			left: 4px;
		}

		> :global(button):last-child {
			right: 4px;
		}

		@media (pointer: fine) {
			&:hover > :global(button):not(:disabled) {
				opacity: 1;
				pointer-events: auto;
			}
		}

		/* На телефоне наведения нет, поэтому там стрелки остаются видимыми. */
		@media (pointer: coarse) {
			> :global(button):not(:disabled) {
				opacity: 1;
				pointer-events: auto;
			}
		}

		/* С клавиатуры стрелка видна, пока на ней стоит фокус. */
		&:focus-within > :global(button):not(:disabled) {
			opacity: 1;
			pointer-events: auto;
		}
	}

	/* Карусель: строка с прокруткой и прилипанием карточки к левому краю. */
	.slider {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scroll-behavior: smooth;

		/* Карусель всегда занимает всю доступную ширину. Иначе, когда карточек ровно
		   столько, сколько в ряд, и прокрутки нет, ширина считается от содержимого,
		   и процент в flex-basis даёт уже, чем в других вкладках. */
		flex: 1 1 auto;
		min-width: 0;

		/* Полоса прокрутки не занимает место: высота карусели одинаковая при
		   переключении вкладок. */
		scrollbar-width: none;

		/* Плитка при наведении приподнимается, поэтому у строки есть запас сверху и
		   снизу: маска не обрезает карточку. */
		padding: 8px 0;

		&::-webkit-scrollbar {
			display: none;
		}

		/* Крайние плитки затухают: видно, что лента продолжается. */
		-webkit-mask-image: linear-gradient(to right, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 1) 7%, rgba(0, 0, 0, 1) 93%, rgba(0, 0, 0, 0.4));
		mask-image: linear-gradient(to right, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 1) 7%, rgba(0, 0, 0, 1) 93%, rgba(0, 0, 0, 0.4));

		/* 5 плиток в ряд на широком экране, 4 на 1280, 3 на планшете, 2 на телефоне. */
		.slide {
			flex: 0 0 calc((100% - 4 * 14px) / 5);
			min-width: 150px;
			scroll-snap-align: start;
		}

		@media (max-width: 1280px) {
			.slide {
				flex-basis: calc((100% - 3 * 14px) / 4);
			}
		}

		@media (max-width: 1024px) {
			.slide {
				flex-basis: calc((100% - 2 * 14px) / 3);
			}
		}

		@media (max-width: 768px) {
			.slide {
				flex-basis: calc((100% - 1 * 14px) / 2);
			}
		}
	}

	/* Плитка как на netflix.shop: постер занимает всю карточку, название лежит
	   внутри неё снизу, по градиенту. Всё остальное проявляется при наведении. */
	.card {
		position: relative;
		display: block;
		aspect-ratio: 2 / 3;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		background: #121216;
		overflow: hidden;
		user-select: none;
		text-decoration: none;

		transition: transform ease 0.45s cubic-bezier(0.2, 0.7, 0.2, 1), border-color ease 0.25s;

		@include hover {
			transform: translateY(-4px);
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));

			.poster img {
				transform: scale(1.06);
			}

			.poster .rating,
			.poster .quality,
			.text .meta {
				opacity: 1;
			}
		}
	}

	/* Постер заполняет всю плитку: рамка и радиус теперь у самой карточки. */
	.poster {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
			transition: transform ease 0.45s cubic-bezier(0.2, 0.7, 0.2, 1);
		}

		span {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			font-weight: 600;
			font-size: 24px;
			color: var(--gray-soft, #6a6e77);
		}

		/* Оценка поверх постера в левом верхнем углу — тот же вид, что в каруселях дорам,
		   аниме и сериалов. Подложка нужна, потому что постеры бывают светлые: без неё цифры
		   теряются на картинке. Шкала нейтральная: цветных бейджей больше нет. */
		.rating,
		.quality {
			position: absolute;
			z-index: 1;
			/* Плашки проявляются только при наведении на плитку. */
			opacity: 0;
			transition: opacity ease 0.25s;
			padding: 4px 8px;
			border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			border-radius: 8px;
			background: rgba(11, 11, 13, 0.6);
			-webkit-backdrop-filter: blur(8px);
			backdrop-filter: blur(8px);
			font-weight: 600;
			font-size: 12px;
			line-height: 130%;
			color: var(--white, #fff);
		}

		.rating {
			top: 8px;
			left: 8px;
		}

		.quality {
			top: 8px;
			right: 8px;
			max-width: calc(100% - 16px);
		}
	}

	/* Название лежит внутри плитки, снизу, по тёмному градиенту — так текст читается
	   на любом постере. Вторая строка проявляется только при наведении. */
	.text {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 2;
		min-width: 0;
		padding: 22px 14px 12px;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.35) 55%, rgba(0, 0, 0, 0) 100%);

		h3 {
			font-weight: 600;
			letter-spacing: -0.01em;
			font-size: 16px;
			line-height: 130%;
			color: var(--white, #fff);
			text-overflow: ellipsis;
			white-space: nowrap;
			overflow: hidden;
		}

		.meta {
			display: block;
			font-weight: 400;
			font-size: 12px;
			line-height: 130%;
			color: rgba(255, 255, 255, 0.72);
			text-overflow: ellipsis;
			white-space: nowrap;
			overflow: hidden;

			opacity: 0;
			transition: opacity ease 0.25s;
		}
	}
</style>

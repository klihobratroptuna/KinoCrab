<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { Button } from '$lib/elements/button';
	import { ArrowIcon } from '$lib/shared/icons';
	import { canOpenInternal, loadSeriesSnapshot, tileHref } from '$lib/shared/seriesSource';
	import { posterUrl } from '$lib/shared/doramaPoster';
	import { todayKey } from '$lib/shared/moscowDate';

	// Карусель «Сериалы»: тот же вид карточки, что в каруселях фильмов, аниме и дорам, но
	// выборка не за один день, а за последние 30 дней (модуль $lib/shared/seriesSource).
	//
	// Под названием — строка серий из строки Kodik, а если серий нет, жанр и год: высота
	// карточки та же, что в остальных вкладках (40px), поэтому переключение вкладок её не
	// меняет. Кнопки на карточке нет.
	//
	// Карточку без плеера показываем: тайтл мог попасть в окно только по имени, и за это
	// время источник мог добавить запись. Проверку делает модуль, один раз в сутки, и блок
	// пишет об этом строку — сама карточка не отличается от остальных.
	//
	// Постер берём из той же строки Kodik. Когда он ведёт на хост, который у нас не
	// открывается, модуль один раз в сутки просит Kinopoisk по названию: тот же ответ даёт
	// номер и картинку с яндексового CDN, а если там ничего нет — постер с TMDB. Пауза между
	// запросами держится по ограничению ключа (5 запросов за 5 секунд). Проход идёт в фоне:
	// блок сначала показывает сохранённый снимок, поэтому длинную проверку посетитель не ждёт.
	//
	// Данные читаются в браузере: на сервере карусели нет, источник читается через прокси
	// nginx, снимок лежит в коллекции series_carousel.
	// Тайтлы, которые показывает карусель дорам, здесь не дублируются: модуль сравнивает
	// нормализованное имя (целиком и без суффикса сезона) с группой самого свежего дня
	// карусели дорам. На экране об этом ничего не пишут — дубли просто не попадают в список.
	//
	// В этой вкладке только те страны, которые для неё нужны: Европа, США, Канада, СНГ и
	// Австралия с Новой Зеландией — Турцию убрали 2026-11-04, её сериалы здесь больше не
	// нужны. Азиатские тайтлы сюда не берут — они в «Дорамах», и страна известна из той же
	// строки источника, которая даёт постер, жанр и оценку. На экране об этом ничего не пишут:
	// просто карточек других стран в списке нет. Места раздаются по кругу — сначала по одному
	// самому свежему тайтлу каждой страны, потом второй, потом третий, и всего мест двадцать.
	// Порядок групп — по лучшему тайтлу страны: сначала качество, внутри по свежести.
	//
	// Порядок карточек — качество, внутри качества свежесть, и только потом приоритет имён
	// (решение пользователя 2026-11-06: более свежие должны быть ближе к началу; до этого порядок
	// решал только приоритет имён, и лента была из старых тайтлов). Качество решает проход: имя в
	// топ-100 популярного TMDB — первая группа; оценка не ниже 6.0 и голоса не меньше порогу —
	// вторая для тайтлов свежее 2020 года, третья для старых; четвёртая работает только заполнением.
	// Порог голосов для премьеры внутри окна — 10, вне окна 50: по замеру 2026-11-06 тайтл
	// «Яга: Охота на ведьм» (номер 13516692, оценка 7.4 при 18 голосах) не попадал в ленту именно
	// из-за порога 50.
	//
	// Мультипликационные сериалы в эту вкладку не берут — решение пользователя 2026-11-06. Их
	// опознаёт проход по полному списку жанров того источника, который дал тайтл, и по категории
	// строки myshows, а для карточек, где списка жанров нет, по жанрам Kinopoisk по номеру тайтла:
	// по замеру того же дня первый жанр карточки «Леди Баг и Супер-кот» — «Боевик», и по первому
	// жанру такой тайтл не опознать. На экране об этом ничего не пишут — таких карточек в списке нет.
	let cards = null;
	// note больше не выводим: посетителю не нужна техническая информация про
	// снимок источника и фоновый сервис, карусель показываем без текста.
	let note = '';
	let sliderEl;
	let atStart = true;
	let atEnd = false;

	// Постер — через прокси nginx для тех хостов, где без referer или без нашего адреса
	// картинка не открывается (doramaPoster). Вид карточки не меняется: тот же img, только
	// адрес. Если картинка не открылась, показываем первую букву названия.
	let broken = {};
	let small = {};

	function posterSrc(card) {
		return posterUrl(card);
	}

	// Картинку узнее 300 пикселей показываем как отсутствие постера. Причина: Kinopoisk по
	// любому адресу, где постера нет, отдаёт одну и ту же заглушку — замер 2026-11-05:
	//   no-poster.png → 200, image/gif, 2401 байт, 208×304;
	//   film_big/11312133.jpg → те же 2401 байт, то есть та же заглушка.
	// Модуль такую ссылку не принимает, но адрес по номеру он мог построить раньше, чем API
	// назвал заглушку, и проверить это без запроса нельзя. Настоящий постер с CDN Kinopoisk
	// или TMDB шире 300 пикселей, поэтому по ширине картинки заглушку видно на показе.
	function isPlaceholder(img) {
		return Boolean(img?.naturalWidth) && img.naturalWidth < 300;
	}

	// Оценку показываем поверх постера, в левом верхнем углу — тот же вид, что в каруселях
	// дорам и аниме. Подложка нужна, потому что постеры бывают светлые.
	// Оценку пишет тот же проход, что и постер, и только когда совпадение с источником
	// принято: раньше она могла прийти от ответа, который модуль отверг (фильм вместо
	// сериала), и на карточке стояла цифра чужого тайтла.
	function ratingOf(card) {
		return card.rating ? String(card.rating) : '';
	}

	// Карточку открываем внутри проекта — как в остальных разделах: номер фильма в Kinopoisk,
	// иначе id записи Kodik (его пишет суточный проход, в том числе из поиска по имени), иначе
	// страница /watch по одному имени. Наружу карточка не ведёт ни когда, по решению
	// пользователя 2026-11-04. Функция остаётся такой же, как в блоке дорам: наружу она
	// срабатывает только когда искать нечем, то есть здесь уже не срабатывает ни на одной
	// карточке.
	function external(card) {
		return !canOpenInternal(card);
	}

	function line(card) {
		if (card.episode) return card.episode;

		const meta = [card.genre, card.year].filter(Boolean).join(' · ');

		return meta || 'без плеера';
	}

	onMount(() => {
		if (!browser) return;

		start();
		window.addEventListener('resize', measure);
	});

	onDestroy(() => {
		if (!browser) return;

		window.removeEventListener('resize', measure);
	});

	async function start() {
		// Страница читает только базу. Проверки источников делает фоновый сервис
		// (series-sync, каждые 30 минут): замер 2026-11-05 — чтение готового снимка из
		// PocketBase 5 мс, а один проход отбора (до 150 проверок кандидатов) около двух
		// минут. Раньше этот проход делал каждый визит на вкладку, и посетитель ждал
		// ответы Kodik, Alloha, TMDB, Kinopoisk и myshows, а квота источников кончалась
		// быстрее, чем менялся список.
		const snapshot = await loadSeriesSnapshot();
		cards = snapshot.cards;

		// Снимок за вчера — значит сервис ещё не успел: он пишет базу по расписанию,
		// и страница не трогает источники, чтобы не повторять его работу.
		if (snapshot.day && snapshot.day != todayKey()) {
			note = `Показан снимок за ${snapshot.day} — обновляет его фоновый сервис, каждые 30 минут`;
		}

		await tick();
		measure();
	}

	function measure() {
		if (!sliderEl) return;

		atStart = sliderEl.scrollLeft <= 1;
		atEnd = sliderEl.scrollLeft + sliderEl.clientWidth >= sliderEl.scrollWidth - 1;
	}

	// Стрелки листают на один экран, как в остальных каруселях: на широком экране видно 5
	// карточек, на телефоне — 2, поэтому за шаг берём ширину видимой части, а не одну
	// карточку.
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
							href={tileHref(card)}
							target={external(card) ? '_blank' : undefined}
							rel={external(card) ? 'nofollow noopener' : undefined}
							title={card.title}
						>
							<div class="poster">
								{#if posterSrc(card) && !broken[card.id] && !small[card.id]}
									<img
										src={posterSrc(card)}
										alt={card.title}
										loading="lazy"
										inert
										on:load={(event) => {
											if (isPlaceholder(event.currentTarget)) small = { ...small, [card.id]: true };
										}}
										on:error={() => (broken = { ...broken, [card.id]: true })}
									/>
								{:else}
									<span>{letter(card.title)}</span>
								{/if}

								{#if ratingOf(card)}
									<div class="rating">{ratingOf(card)}</div>
								{/if}
							</div>

							<div class="text">
								<h3>{card.title}</h3>
								{#if line(card)}
									<span class="episode">{line(card)}</span>
								{/if}
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
			/* Центрируем через translate, а не transform: у кнопки есть transform:
			   scale(90%) на нажатии, оно перетирало центрирование, стрелка
			   подпрыгивала, и отпускание мыши попадало не на кнопку. */
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

		/* Карусель занимает всю доступную ширину, чтобы flex-basis в процентах считался
		   одинаково во всех вкладках и высота карточек не менялась при переключении. */
		flex: 1 1 auto;
		min-width: 0;

		/* Полоса прокрутки не занимает место — высота карусели одинаковая во всех вкладках. */
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
			.text .episode {
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

		/* Оценка поверх постера, в левом верхнем углу — тот же вид, что в каруселях дорам и
		   аниме. Подложка нужна, потому что постеры бывают светлые: без неё цифры теряются на
		   картинке. Шкала нейтральная: цветных бейджей больше нет. */
		.rating {
			position: absolute;
			top: 8px;
			left: 8px;
			z-index: 1;
			/* Плашка проявляется только при наведении на плитку. */
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

		.episode {
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

<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { Button } from '$lib/elements/button';
	import { ArrowIcon } from '$lib/shared/icons';
	import { currentSeason, isInternal, loadSnapshot, refreshSnapshot, tileHref } from '$lib/shared/kodikFeed/anime';
	import { todayKey } from '$lib/shared/moscowDate';

	// Карточка сезона по виду как на AnimeGO: тайтлы в порядке онгоинга animevost — по
	// свежестью выхода русской озвучки (10 карточек на страницу, берём две), листаются
	// стрелками; страницы тут нет — карусель не делится на страницы.
	// Вторая строка карточки: номер серии; если его нет — вторая строка остаётся прежней,
	// ромадзи из названия. Высота остаётся той же, что в каруселях дорам и фильмов, поэтому
	// при переключении вкладок карточка не растёт.
	const season = currentSeason();

	let cards = null;
	// note больше не выводим: посетителю не нужна техническая информация про
	// источник и сохранённый снимок, карусель показываем без текста.
	let note = '';
	let busy = false;
	let sliderEl;
	let atStart = true;
	let atEnd = false;
	// Постер подгружаем ссылкой на CDN источника, файл на диске не появляется.
	// Если картинка не открылась, показываем первую букву названия.
	let broken = {};

	// Карточку открываем внутри проекта; если тайтл не удалось сопоставить ни по номеру
	// фильма, ни по Shikimori, ни по id Kodik, ссылка ведёт на страницу источника, и её
	// открываем в новой вкладке.
	function external(card) {
		return !isInternal(card);
	}

	onMount(() => {
		// На сервере карусели нет: PocketBase и запрос к источнику работают в браузере.
		if (!browser) return;

		start();
		window.addEventListener('resize', measure);
	});

	onDestroy(() => {
		if (!browser) return;

		window.removeEventListener('resize', measure);
	});

	async function start() {
		const snapshot = await loadSnapshot(season);
		cards = snapshot.cards;

		// Раз в сутки: снимок за сегодня уже лежит в базе — второй раз источник не трогаем.
		// Если снимка ещё нет вообще, первый проход делаем сразу.
		if (!cards.length || (snapshot.day && snapshot.day != todayKey())) await update();

		await tick();
		measure();
	}

	async function update() {
		if (busy) return;
		busy = true;
		note = '';

		const result = await refreshSnapshot(season);

		if (!result.ok) {
			// Показываем то, что уже сохранено: без сохранённого снимка была бы пустая вкладка.
			note = `Источник не ответил (${result.reason}), показан сохранённый снимок`;
		}

		const snapshot = await loadSnapshot(season);
		cards = snapshot.cards;

		busy = false;
		await tick();
		measure();
	}

	function measure() {
		if (!sliderEl) return;

		atStart = sliderEl.scrollLeft <= 1;
		atEnd = sliderEl.scrollLeft + sliderEl.clientWidth >= sliderEl.scrollWidth - 1;
	}

	// Стрелки листают на один экран, как на AnimeGO: на широком экране видно 5 карточек,
	// на телефоне — 2, поэтому за шаг берём ширину видимой части, а не одну карточку.
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
								<div class="ratings">
									<!-- Зелёное — оценка AnimeGO, красная — оценка Shikimori. Их не смешиваем:
										 это два разных источника, и значения у одного тайтла различаются.
										 Kodik оценкой AnimeGO не делится, поэтому зелёное поле заполняет
										 отдельный скрипт: оценка AnimeGO по имени тайтла (2026-11-02:
										 2 оценки из их списка сезона + 1 из нашей записи AnimeGO). -->
									<span class="go" class:muted={!card.rating}>{card.rating || '—'}</span>
									{#if card.score}
										<span class="shiki">{card.score}</span>
									{/if}
								</div>

								{#if card.poster && !broken[card.id]}
									<img
										src={card.poster}
										alt={card.title}
										loading="lazy"
										inert
										on:error={() => (broken = { ...broken, [card.id]: true })}
									/>
								{:else}
									<span class="fallback">{letter(card.title)}</span>
								{/if}
							</div>

							<div class="text">
								<h3>{card.title}</h3>
								<!-- Строка серии: номер выхода русской озвучки из заголовка карточки
									 онгоинга animevost. До 2026-11-05 её не было: проход аниме не писал
									 поле episode, хотя у дорам такая строка есть. -->
								{#if card.episode}
									<span class="episode">{card.episode}</span>
								{:else if card.originalTitle}
									<span class="orig">{card.originalTitle}</span>
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

			.poster .ratings,
			.text .orig,
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

		.fallback {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			font-weight: 600;
			font-size: 24px;
			color: var(--gray-soft, #6a6e77);
		}
	}

	/* Оценка поверх постера, в левом верхнем углу. Подложка нужна, потому что
	   постеры бывают светлые: без неё цифры теряются на картинке. Шкала нейтральная:
	   цветных бейджей больше нет, оценки отличаются только весом строки. */
	.ratings {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 1;
		/* Плашка проявляется только при наведении на плитку. */
		opacity: 0;
		transition: opacity ease 0.25s;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 5px 8px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
		background: rgba(11, 11, 13, 0.6);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);

		span {
			font-weight: 600;
			font-size: 12px;
			line-height: 130%;
			color: var(--white, #fff);
		}

		.muted {
			color: var(--gray-soft, #6a6e77);
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

		.orig,
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

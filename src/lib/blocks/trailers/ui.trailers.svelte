<script>
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { TIMEZONE } from '$lib/shared/moscowDate';
	import { trailerFeed } from '$lib/shared/trailers';
	import vibroTap from '$lib/shared/scripts/vibroTap';

	// Лента читается один раз в сутки (ключ кэша — день), поэтому при повторном визите
	// на страницу запроса нет: карточки берутся из кэша. Обновление на странице
	// автоматическое, без кнопки: раз в десять минут, с force, то есть мимо кэша.
	// После неудачи интервал длиннее — лента Reddit ограничивает частые обращения, второй
	// запрос подряд дал 429 (проверено живьём 2026-11-13). Скрытую вкладку пропускаем:
	// долбить источник, когда страницу никто не видит, незачем.
	const REFRESH_MS = 10 * 60 * 1000;
	const BACKOFF_MS = 30 * 60 * 1000;

	// Обратную анимацию видно только пока dialog открыт, поэтому элемент закрываем
	// после неё. iframe гаснет сразу: воспроизведение прекращается в тот же момент,
	// а не по окончании анимации.
	const ANIM_MS = 250;

	let cards = null;
	let reason = '';
	let loading = false;

	let dialog;
	let current = null;
	let playing = false;
	let closing = false;
	let closeTimer;
	let refreshTimer;

	// Дата публикации записи приходит в UTC. Показываем её по Москве, как в блоке
	// релизов, иначе посетитель из другого пояса видит соседний день.
	function dayOf(iso) {
		const date = new Date(iso);

		if (!Number.isFinite(date.getTime())) return '';

		return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TIMEZONE }).format(date);
	}

	async function load(force = false) {
		if (loading) return null;
		loading = true;

		const result = await trailerFeed(force);

		if (result.ok) {
			cards = result.cards;
			reason = '';
		} else if (!cards) {
			// Первый неудачный вид — показываем причину; если карточки уже есть,
			// неудача их не перетирает (неудачный ответ не кэшируется).
			reason = result.reason;
		}

		loading = false;

		return result;
	}

	// Один таймер на весь блок: интервал пересчитывается после каждой проверки, поэтому
	// неудача не превращается в поток повторных запросов.
	function schedule(delay) {
		clearTimeout(refreshTimer);

		refreshTimer = setTimeout(async () => {
			if (document.visibilityState === 'visible') {
				const result = await load(true);
				// null — значит проверку пропустили, потому что прошлая ещё в полёте:
				// это не неудача источника, интервал оставляем обычный.
				schedule(result && !result.ok ? BACKOFF_MS : REFRESH_MS);
			} else {
				schedule(REFRESH_MS);
			}
		}, delay);
	}

	function open(card) {
		vibroTap();
		current = card;
		playing = true;

		if (dialog) dialog.showModal();
	}

	function close() {
		if (!dialog) return;

		playing = false;
		closing = true;

		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			closing = false;
			current = null;
			dialog.close();
		}, ANIM_MS);
	}

	// Esc перехватываем: native close закрыл бы окно без обратной анимации, и src
	// iframe остался бы живым. preventDefault — и идём через нашу функцию, где тот же
	// путь, что у клика по фону.
	function onEscape(event) {
		event.preventDefault();
		close();
	}

	function reset() {
		clearTimeout(closeTimer);
		closing = false;
		playing = false;
		current = null;
	}

	onMount(() => {
		if (!browser) return;

		load().then((result) => schedule(result?.ok ? REFRESH_MS : BACKOFF_MS));
	});

	onDestroy(() => {
		clearTimeout(closeTimer);
		clearTimeout(refreshTimer);
	});
</script>

<!-- Строка над лентой, на фоне страницы: те же отступы и правое выравнивание, что у
     строки «Последний просмотр» и панели релизов. -->
<div class="head">
	<h2>Трейлеры</h2>
</div>

<div class="feed">
	{#if !cards && loading}
		<p class="loader">Загрузка ленты…</p>
	{:else if cards && cards.length}
		<ul>
			{#each cards as card (card.id)}
				<li>
					<button class="card" on:click={() => open(card)} title={card.title}>
						<span class="poster">
							{#if card.thumb}
								<img src={card.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />
							{:else}
								<span>{card.title.trim().charAt(0).toUpperCase()}</span>
							{/if}
						</span>
						<span class="text">
							<strong>{card.title}</strong>
							<time>{dayOf(card.published)}</time>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="nothing">
			<h3>Пусто</h3>
			<p>{reason || 'Лента трейлеров не ответила — обновите.'}</p>
		</div>
	{/if}
</div>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
	class:closing
	aria-modal="true"
	bind:this={dialog}
	on:close={reset}
	on:cancel={onEscape}
	on:click|self={close}
>
	{#if current}
		<div class="caption">
			<h3>{current.title}</h3>
			<p>
				<span>{dayOf(current.published)}</span>
				<!-- Модальное окно открывается поверх главной страницы, поэтому ссылка
					 на источник остаётся отдельной — она не ведёт с страницы на YouTube. -->
				<a href={current.url} target="_blank" rel="nofollow noopener">Смотреть на YouTube</a>
			</p>
		</div>

		<div class="frame">
			<!-- referrerpolicy здесь обязателен: с «no-referrer» проигрыватель YouTube
				 не получает информацию об источнике и отвечает Error 153. Нужен
				 strict-origin-when-cross-origin. allow-список и allowfullscreen —
				 стандартный набор для embed, без них autoplay не разрешён. -->
			<iframe
				src={playing && current.videoId ? `https://www.youtube.com/embed/${current.videoId}?autoplay=1&playsinline=1&rel=0` : ''}
				title={current.title}
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				allowfullscreen
				referrerpolicy="strict-origin-when-cross-origin"
				loading="lazy"
			/>
		</div>
	{/if}
</dialog>

<style lang="scss">
	/* Строка над лентой: отступы как у панели, без подложки, правое выравнивание —
	   как у строки «Последний просмотр» и панели релизов. */
	.head {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 16px;
		max-width: 1920px;
		margin: 0 40px 12px;
		align-self: stretch;

		@media (max-width: 768px) {
			margin: 0 16px 10px;
			gap: 8px;
		}

		h2 {
			/* Тот же размер, что у надписей разделов карусели (кнопки навигации):
			   15px, 600, tracking -0.01em. */
			font-family: Inter;
			font-size: 15px;
			font-weight: 600;
			letter-spacing: -0.01em;
			line-height: 20px;
			color: var(--white, #fff);
		}
	}

	/* Плитки ленты стоят на фоне страницы, как ряд «Последний просмотр» и лента релизов. */
	.feed {
		max-width: 1920px;
		margin: 0 40px 16px;
		align-self: stretch;

		@media (max-width: 768px) {
			margin: 0 16px 16px;
		}
	}

	ul {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		align-items: flex-start;
		list-style: none;
		gap: 12px;

		li {
			display: flex;
			/* Без этого длинные заголовки растягивают колонки и лента выходит за край. */
			min-width: 0;
		}

		@media (max-width: 1400px) {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		@media (max-width: 1024px) {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		@media (max-width: 768px) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		@media (max-width: 480px) {
			grid-template-columns: 1fr;
		}
	}

	/* Та же карточка, что в плитках релизов: фон карточки, тонкая линия, радиус 12. */
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		min-width: 0;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		padding: 12px;
		background: var(--card, #16161a);
		color: inherit;
		font-family: Inter;
		text-align: left;
		user-select: none;
		cursor: pointer;

		transition: all ease 0.25s;

		&:active {
			transform: scale(98%);
		}

		@include hover {
			background: var(--card-hi, #1b1b21);
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));

			strong {
				color: var(--white, #fff);
			}
		}
	}

	/* Превью в одной рамке 16:9 — поэтому все плитки одинакового размера. */
	.poster {
		display: block;
		aspect-ratio: 16 / 9;
		min-width: 0;
		border-radius: 10px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: #121216;
		overflow: hidden;

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		/* Заглушка, когда превью нет или картинка не загрузилась. */
		span {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			font-weight: 700;
			font-size: 28px;
			color: var(--gray, #8b8f98);
		}
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;

		strong {
			overflow: hidden;
			color: var(--white, #fff);
			white-space: nowrap;
			text-overflow: ellipsis;
			/* H4 — Desktop */
			font-family: Inter;
			font-size: 15px;
			font-weight: 600;
			letter-spacing: -0.01em;
			line-height: 21px;
			transition: color ease 0.25s;
		}

		time {
			font-family: Inter;
			font-size: 13px;
			font-weight: 400;
			line-height: 130%;
			color: var(--gray-soft, #6a6e77);
		}
	}

	.loader {
		font-family: Inter;
		font-weight: 400;
		font-size: 14px;
		line-height: 160%;
		color: var(--gray, #8b8f98);
	}

	.nothing {
		h3 {
			margin-bottom: 8px;
			font-family: Inter;
			font-weight: 700;
			font-size: 18px;
			line-height: 135%;
			color: var(--white, #fff);
		}

		p {
			font-family: Inter;
			font-weight: 400;
			font-size: 14px;
			line-height: 160%;
			color: var(--gray, #8b8f98);
		}
	}

	/* Окно поверх главной страницы: тёмный оверлей, та же поверхность карточки,
	   тонкая линия, радиус 14. Появление — fade + лёгкий scale, исчезновение — та же
	   анимация в обратную сторону. */
	dialog[open] {
		position: fixed;
		margin: auto;
		padding: 24px;
		width: min(900px, calc(100% - 32px));
		max-height: calc(100vh - 64px);
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 14px;
		background: var(--card, #16161a);
		box-shadow: var(--shadow, 0 18px 40px rgba(0, 0, 0, 0.45));
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: hidden;
		cursor: default;
		animation: pop 0.25s ease-out;

		&::backdrop {
			position: fixed;
			background: rgba(0, 0, 0, 0.8);
			cursor: pointer;
			overscroll-behavior: contain;
			animation: fade 0.25s ease-out;
		}

		&.closing {
			animation: pop 0.25s ease-out reverse;

			&::backdrop {
				animation: fade 0.25s ease-out reverse;
			}
		}

		@media (max-width: 768px) {
			margin: 16px;
			padding: 16px;
			max-height: calc(100vh - 32px);
		}

		@media (prefers-reduced-motion: reduce) {
			animation: none;

			&::backdrop {
				animation: none;
			}
		}

		@keyframes fade {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}

		@keyframes pop {
			from {
				opacity: 0;
				transform: scale(0.96);
			}
			to {
				opacity: 1;
				transform: scale(1);
			}
		}
	}

	/* Строка заголовка окна: имя и дата в том же языке, что карточки. Кнопки закрытия
	   тут нет — окно закрывается кликом по фону и Esc. */
	.caption {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;

		h3 {
			overflow: hidden;
			color: var(--white, #fff);
			white-space: nowrap;
			text-overflow: ellipsis;
			/* H4 — Desktop */
			font-family: Inter;
			font-size: 18px;
			font-weight: 600;
			letter-spacing: -0.01em;
			line-height: 24px;
		}

		p {
			display: flex;
			align-items: center;
			gap: 12px;
			font-family: Inter;
			font-size: 13px;
			font-weight: 400;
			line-height: 130%;
			color: var(--gray-soft, #6a6e77);
		}

		a {
			color: var(--white, #fff);
			font-weight: 600;
			letter-spacing: -0.01em;
			text-decoration: none;
		}
	}

	.frame {
		aspect-ratio: 16 / 9;
		min-width: 0;
		border-radius: 10px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: #121216;
		overflow: hidden;

		iframe {
			display: block;
			width: 100%;
			height: 100%;
			border: none;
			background: #121216;
		}
	}
</style>

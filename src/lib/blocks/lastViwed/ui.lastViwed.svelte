<script>
	import { goto } from '$app/navigation';
	import vibroTap from '$lib/shared/scripts/vibroTap';
	import watchHistory from '$lib/shared/scripts/watchHistory';
	import { onMount } from 'svelte';

	// Здесь теперь не одна карточка, а последние три просмотра: ряд из трёх мест.
	// Если смотрений меньше, ряд короче — пустых мест не показываем.
	const MAX = 3;

	let items = [];

	const timeOptions = {
		month: 'long',
		day: 'numeric',
		timezone: 'UTC'
	};

	function clickHandler(film) {
		vibroTap();
		goto('/watch?id=' + film?.kinopoiskId);
	}

	// Полоска только там, где прогресс реально сохранён: пишет его наш <video>,
	// сторонние iframe время не отдают. Нет прогресса — карточка остаётся как была.
	function clock(seconds) {
		const s = Math.max(0, Math.round(Number(seconds) || 0));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const r = s % 60;

		return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
	}

	onMount(() => {
		items = (watchHistory.get() || [])
			.slice(0, MAX)
			.map((film) => ({ film, progress: watchHistory.findProgress(film) }));
	});
</script>

{#if items.length}
	<div class="row">
		{#each items as item}
			<section on:click={() => clickHandler(item.film)} role="button" tabindex="0">
				<img src={item.film.posterUrlPreview} alt="Постер" />
				<div class="text">
					<h3>{item.film.nameRu || item.film.nameEn || item.film.nameOriginal}</h3>
					{#if item.progress}
						<div class="progress">
							<div class="bar">
								<span style="width: {item.progress.percent}%" />
							</div>
							<p>
								{#if item.progress.episodeName || item.progress.episode}
									<span>{item.progress.episodeName || `Серия ${item.progress.episode + 1}`}</span>
								{/if}
								<span>{item.progress.percent}%</span>
								{#if item.progress.duration}
									<span>{clock(item.progress.seconds)} из {clock(item.progress.duration)}</span>
								{/if}
							</p>
						</div>
					{/if}
					<div class="bottom">
						{#if item.film._kinofree?.lastviewed}
							<div class="time">
								<p>Последний просмотр</p>
								<span>{new Date(item.film._kinofree.lastviewed).toLocaleString('ru', timeOptions)}</span>
							</div>
						{/if}
						<div class="more">Продолжить</div>
					</div>
				</div>
			</section>
		{/each}
	</div>
{/if}

<style lang="scss">
	// Три карточки в ряд: тёмная поверхность с тонкой линией, без цветной заливки
	// и без цветного свечения при наведении.
	.row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		max-width: 1920px;
		margin: 16px 40px;
		align-self: stretch;

		@media (max-width: 1024px) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		@media (max-width: 768px) {
			grid-template-columns: 1fr;
			margin: 16px;
		}
	}

	section {
		display: flex;
		padding: 14px 16px;
		align-items: center;
		gap: 14px;
		min-width: 0;
		border-radius: 14px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: var(--card, #16161a);
		box-shadow: none;
		transition: all ease 0.25s;
		cursor: pointer;
		user-select: none;

		@media (max-width: 768px) {
			gap: 12px;
		}

		&:active {
			transform: scale(98%);
		}

		@include hover {
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
		}
	}

	img {
		display: flex;
		width: 44px;
		height: 62px;
		flex: 0 0 auto;
		justify-content: center;
		align-items: center;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: #121216;
	}

	.text {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		min-width: 0;
		flex: 1 0 0;

		h3 {
			overflow: hidden;
			color: var(--white, #fff);
			white-space: nowrap;
			text-overflow: ellipsis;
			/* H4 — Desktop */
			font-family: Inter;
			font-size: 15px;
			font-style: normal;
			font-weight: 600;
			letter-spacing: -0.01em;
			line-height: 21px;
		}

		// Полоска просмотра: тонкая линия с белым заполнением, без цветной заливки.
		.progress {
			display: flex;
			align-items: center;
			gap: 8px;

			.bar {
				flex: 1 1 auto;
				min-width: 48px;
				height: 3px;
				border-radius: 100px;
				background: rgba(255, 255, 255, 0.12);
				overflow: hidden;

				span {
					display: block;
					height: 100%;
					border-radius: 100px;
					background: var(--white, #fff);
				}
			}

			p {
				display: flex;
				gap: 6px;
				color: var(--gray, #8b8f98);
				font-family: Inter;
				font-size: 12px;
				font-weight: 500;
				line-height: 16px;
				font-variant-numeric: tabular-nums;
			}
		}

		.bottom {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}

		.time {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;

			p {
				color: var(--gray-soft, #6a6e77);

				/* text-14 */
				font-family: Inter;
				font-size: 12px;
				font-style: normal;
				font-weight: 400;
				line-height: 16px;
			}
			span {
				color: var(--gray, #8b8f98);

				/* text-14-bold */
				font-family: Inter;
				font-size: 12px;
				font-style: normal;
				font-weight: 500;
				line-height: 16px;
			}
		}
	}

	.more {
		flex: 0 0 auto;

		/* Просто надпись: карточка целиком кликабельна, pill и стрелка не нужны. */
		color: var(--white, #fff);
		font-family: Inter;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 16px;
	}
</style>

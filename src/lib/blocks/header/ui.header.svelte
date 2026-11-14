<script>
	import { Button } from '$lib/elements/button';
	import vibroTap from '$lib/shared/scripts/vibroTap';
	import { page } from '$app/stores';
</script>

<header>
	<a href="/" class="logo">
		<h1>
			<span class="mark" aria-hidden="true"></span>
			<span class="name">KINOCRAB</span>
		</h1>
	</a>
	<nav class:hideMobile={$page.url.pathname != '/' && $page.url.pathname != '/index.html'}>
		<a class="button" href="/search?popular">
			<Button nav vibro dark>
				Популярно сейчас
			</Button>
		</a>
		<a class="button" href="/releases">
			<Button nav vibro dark>
				Релизы
			</Button>
		</a>
	</nav>
	<a class="profile" href="/profile">
		<button on:click={vibroTap}>
			<p>Профиль</p>
		</button>
	</a>
</header>

<style lang="scss">
	// Шапка компактная и липкая: поверх контента, тёмное стекло, тонкая линия снизу.
	// overflow-x: clip у .app нужен, чтобы липкость работала — с hidden родитель
	// становится контейнером прокрутки, и шапка перестаёт держаться на экране.
	header {
		position: sticky;
		top: 0;
		z-index: 30;
		padding: 16px 40px;
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 24px;
		align-self: stretch;
		justify-content: space-between;
		background: var(--glass, rgba(11, 11, 13, 0.72));
		-webkit-backdrop-filter: blur(22px) saturate(140%);
		backdrop-filter: blur(22px) saturate(140%);
		border-bottom: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		transition: all ease 0.25s;

		@media (max-width: 1024px) {
			grid-template-columns: auto auto;
			align-items: stretch;
		}

		@media (max-width: 768px) {
			padding: 12px 16px;
		}
	}

	h1 {
		color: var(--white, #fff);
		cursor: pointer;
		font-family: Inter;
		font-size: 1rem;
		font-style: normal;
		font-weight: 800;

		transition: all ease 0.25s;

		/* Знак нарезан под содержимое картинки: static/logo3.webp, 510x161 px, то есть 3.17 : 1.
		   По высоте 48 px, без крупных отступов. */
		.mark {
			display: block;
			height: 48px;
			aspect-ratio: 510 / 161;
			background: currentColor;
			-webkit-mask: url('/logo3.webp') center / contain no-repeat;
			mask: url('/logo3.webp') center / contain no-repeat;

			/* Слово в картинке лежит ниже середины полотна: центр масс букв — на строке
			   84 из 161, то есть 2 % ниже центра (середина полотна 80.5). Без сдвига
			   буквы стоят ниже строки текста кнопок. Сдвиг в процентах, чтобы он оставался
			   тем же и на меньшей высоте. */
			transform: translateY(-2%);
		}

		/* Текст остаётся для скринридеров и поиска: виден только знак. */
		.name {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		@media (max-width: 768px) {
			.mark {
				height: 40px;
			}
		}

		@include hover {
			color: var(--white, #fff);
		}
	}

	nav {
		display: flex;
		align-items: center;
		gap: 16px;
		width: inherit;
		width: 100%;

		@media (max-width: 1024px) {
			grid-row: 2;
			grid-column: 1 / span 2;
		}
	}

	.hideMobile {
		@media (max-width: 768px) {
			display: none;
		}
	}

	.profile {
		align-self: center;
		justify-self: end;

		// Кнопка шапки: только текст, без рамки; акцент — белый, на наведении
		// та же лёгкая заливка, что у остальных кнопок шапки.
		button {
			display: flex;
			padding: 9px 14px;
			height: 100%;
			align-items: center;
			gap: 10px;
			border: none;
			border-radius: 10px;
			background: transparent;
			box-shadow: none;
			user-select: none;

			transition: all ease 0.25s;

			color: var(--gray, #8b8f98);
			font-family: Inter;
			font-size: 15px;
			font-style: normal;
			font-weight: 600;
			letter-spacing: -0.01em;
			line-height: 20px; /* 133% */
			text-decoration: none;

			&:active {
				transform: scale(90%);
			}

			// Та же подсветка и то же свечение, что у кнопок навигации в шапке.
			@include hover {
				border-radius: 10px;
				background: rgba(255, 255, 255, 0.06);
				box-shadow: 0 10px 24px rgba(255, 255, 255, 0.12);
				color: var(--white, #fff);
			}

			@media (max-width: 1024px) {
				margin: 0;
				height: auto;
				display: inline-flex;
				padding: 10px;
				align-items: center;
				border-radius: 10px;
			}
		}
	}

	a {
		text-decoration: none;
	}
	.button {
		@media (max-width: 1024px) {
			width: -webkit-fill-available;
			height: 100%;
		}
	}
</style>

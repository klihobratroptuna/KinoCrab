<script>
	import { onMount } from 'svelte';
	import vibroTap from '$lib/shared/scripts/vibroTap';
	export let contrast = false;
	export let circle = false;
	export let dark = false;
	export let nav = false;
	export let toggle = false;
	export let active = false;
	export let vibro = false;

	let element;

	onMount(() => {
		element.addEventListener('click', () => {
			if (vibro) {
				vibroTap();
			}
		});
	});
</script>

<button
	bind:this={element}
	class:contrast
	class:circle
	class:dark
	class:nav
	class:toggle
	class:active
	{...$$restProps}
	on:click
>
	<slot />
</button>

<style lang="scss">
	// Один язык для всех кнопок: плоские поверхности, тонкая линия вместо рамки,
	// акцент только белый. Классы и их назначение не меняются.
	button {
		appearance: none;
		border: none;
		display: flex;
		padding: 10px 18px;
		align-items: center;
		gap: 8px;
		border-radius: 12px;
		background: var(--white, #fff);
		color: var(--black, #000);
		font-family: Inter;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 18px; /* 128.571% */
		user-select: none;

		transition: all ease 0.25s;

		:global(svg path) {
			stroke: var(--black, #000);
			transition: all ease 0.25s;
		}

		// Элемент segmented control или чип: вкладка, вариант переключателя
		&.toggle {
			display: flex;
			align-items: center;
			justify-content: flex-start;
			flex-direction: row;
			gap: 10px;
			border: none;
			border-radius: 9px;
			padding: 7px 14px;
			box-shadow: none;
			background: transparent;
			color: var(--gray, #8b8f98);
			font-size: 14px;
			font-weight: 600;
			line-height: 18px;
			text-wrap: nowrap;

			@include hover {
				background: rgba(255, 255, 255, 0.06);
				color: var(--white, #fff);
			}

			&.active {
				background: rgba(255, 255, 255, 0.10);
				color: var(--white, #fff);
			}
		}

		&.dark {
			color: var(--gray, #8b8f98);
			border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			background: rgba(255, 255, 255, 0.04);
			box-shadow: none;

			:global(svg path) {
				stroke: currentColor;
			}

			@include hover {
				background: rgba(255, 255, 255, 0.08);
				border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
				color: var(--white, #fff);

				:global(svg path) {
					stroke: var(--white, #fff);
				}
			}
		}

		// Навигация: без фона и рамки, текст с иконкой; на наведении лёгкая заливка
		&.nav {
			display: flex;
			padding: 9px 14px;
			height: 100%;
			align-items: center;
			gap: 10px;
			border: none;
			border-radius: 10px;
			background: transparent;
			box-shadow: none;

			font-size: 15px;
			font-weight: 600;
			letter-spacing: -0.01em;
			line-height: 20px; /* 133% */
			text-decoration: none;

			@media (max-width: 1024px) {
				display: flex;
				width: inherit;
				padding: 10px;
				flex-direction: column;
				justify-content: flex-start;
				align-items: flex-start;
				gap: 10px;
				border-radius: 10px;
				font-size: 14px;
				font-weight: 500;
				line-height: 18px; /* 128.571% */
				text-align: left;
			}

			&:active {
				transform: scale(90%);
			}

			@include hover {
				border-radius: 10px;
				background: rgba(255, 255, 255, 0.06);
				color: var(--white, #fff);
			}
		}

		&.contrast {
			background: var(--white, #fff);
		}

		&.circle {
			margin: 0;
			display: inline-flex;
			padding: 10px;
			align-items: center;
			gap: 10px;
			border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			border-radius: 100px;
			background: rgba(255, 255, 255, 0.05);
			box-shadow: none;
			color: var(--gray, #8b8f98);

			@media (max-width: 768px) {
				&.dark {
					padding: 10px;
				}

				padding: 0px;
				gap: 0;
				border: none;
				background: none;
				box-shadow: none;

				:global(svg path) {
					stroke: var(--gray, #8b8f98);
				}
			}

			&.dark {
				border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
				background: rgba(255, 255, 255, 0.05);
				box-shadow: none;

				:global(svg path) {
					stroke: currentColor;
				}
			}
		}

		@include hover {
			box-shadow: 0 10px 24px rgba(255, 255, 255, 0.12);

			&.contrast {
				box-shadow: 0 10px 24px rgba(255, 255, 255, 0.12);
			}

			&.circle {
				background: var(--white, #fff);
				border-color: transparent;
				color: #000;
				box-shadow: none;

				&.dark {
					border-radius: 100px;
					border-color: transparent;
					background: var(--white, #fff);
					color: #000;

					@media (max-width: 768px) {
						padding: 10px;
						gap: 0;
					}
				}

				:global(svg path) {
					stroke: #000;
				}
			}
		}
	}
</style>

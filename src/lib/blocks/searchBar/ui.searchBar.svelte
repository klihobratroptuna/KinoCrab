<script>
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { CrossIcon } from '$lib/shared/icons';
	import vibroTap from '$lib/shared/scripts/vibroTap';
	import { apiSearchFilm } from '$lib/shared/api';

	let params;
	let suggest = {
		select: -1,
		list: []
	};

	let input;
	let inputFocus = false;
	let inputValue = '';

	function focusStatus(newState) {
		inputFocus = newState;
	}
	function clearinput() {
		inputValue = '';
		input.focus();
	}
	function search() {
		if (!inputValue.trim()) return;
		goto('./search?key=' + encodeURIComponent(inputValue));
	}

	let timer = null;
	function inputHandler(e) {
		if (e.key == 'ArrowUp' || e.key == 'ArrowDown' || inputValue.trim().length < 3) return;

		if (timer) clearTimeout(timer);
		suggest.select = -1;
		timer = setTimeout(async () => {
			// Подсказки — по имени и легче страницы результатов: запрос пересчитывается на
			// каждый символ после паузы 400 мс, поэтому проверок плеера и лишних запросов
			// за кодом IMDb здесь нет. Резерв включается, только если Kinopoisk не ответил.
			let { films } = await apiSearchFilm(inputValue, 1, { light: true });
			if (films) {
				suggest.list = films
					.map((obj) => {
						return { title: `${obj.nameRu || obj.nameEn} ${obj.year || ''}`, id: obj.filmId };
					})
					.slice(0, 5);
			} else {
				suggest.list = [];
			}
			suggest.list[-1] = { title: inputValue };
		}, 400);
	}

	function inputController(e) {
		if (e.key == 'Enter') search();
		if (e.key == 'ArrowUp') {
			if (suggest.list.length > 0 && suggest.select > -1) {
				suggest.select--;
				inputValue = suggest.list[suggest.select].title;
			}
		}
		if (e.key == 'ArrowDown') {
			if (suggest.list.length > 0 && suggest.select + 1 < suggest.list.length) {
				suggest.select++;
				inputValue = suggest.list[suggest.select].title;
			}
		}
	}

	afterNavigate(() => {
		params = Object.fromEntries($page.url.searchParams);
		if (params.key) {
			inputValue = params.key;
		}
	});
</script>

<div class="searchBar">
	<div class="input" class:inputFocus class:inputValue={inputValue.length && !inputFocus}>
		<input
			on:focus={() => focusStatus(true)}
			on:blur={() => focusStatus(false)}
			on:keydown={inputController}
			on:keyup={inputHandler}
			bind:value={inputValue}
			bind:this={input}
			type="text"
			placeholder="Фильм или сериал"
		/>
		<button class="clear" on:click={clearinput} class:canClear={inputValue}>
			<CrossIcon small />
		</button>
		<button
			class="search"
			disabled={!(inputValue.trim().length > 0)}
			on:pointerdown={() => {
				vibroTap();
				search();
			}}
		>
			<p>Найти</p>
		</button>

		{#if inputFocus && suggest.list.length && inputValue.trim().length > 2}
			<ul class="suggest">
				{#each suggest.list as { title, id }}
					<button
						on:pointerdown|stopPropagation={() => {
							inputValue = title
							goto(`/search?key=${title}`);
						}}
					>
						{title}
					</button>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style lang="scss">
	.searchBar {
		display: flex;
		gap: 8px;
		width: 100%;
	}

	// Кнопка очистки: стоит в строке, перед «Найти», и видна только когда есть
	// что очищать.
	.clear {
		display: inline-flex;
		align-items: center;
		background: none;
		border: none;
		visibility: hidden;
		padding: 6px;
		cursor: pointer;

		:global(g) {
			opacity: 0.5;
		}
		@include hover {
			:global(g) {
				opacity: 1;
			}
		}
	}
	.canClear {
		visibility: visible;
	}

	/* Подсказки: та же тёмная поверхность, что и панель, тонкая линия вместо верхней рамки. */
	.suggest {
		top: calc(100% + 12px);
		position: absolute;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		box-shadow: var(--shadow, 0 18px 40px rgba(0, 0, 0, 0.45));
		width: 100%;
		background: var(--card, #16161a);
		overflow: hidden;
		z-index: 3;

		button {
			background: var(--card, #16161a);
			border: none;
			text-align: start;
			font-family: var(--font-family);
			font-weight: 500;
			letter-spacing: -0.01em;
			font-size: 14px;
			line-height: 129%;
			color: var(--white, #fff);
			padding: 11px 16px;
			@include hover {
				background: rgba(255, 255, 255, 0.07);
			}
		}
	}

	// Поле поиска — одна скруглённая строка на фоне страницы, без панели вокруг:
	// поверхность цвета карточки, тонкая линия, скруглённые края. При фокусе
	// линия только чуть ярче, без цветного кольца.
	.input {
		display: flex;
		position: relative;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 52px;
		padding: 0 6px 0 18px;
		cursor: text;
		border-radius: 999px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: var(--card, #16161a);
		box-shadow: none;
		transition: all ease 0.25s;

		@media (max-width: 768px) {
			width: -webkit-fill-available;
			padding: 0 6px 0 16px;
		}

		@include hover {
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
		}

		&.inputFocus {
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
			box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
		}

		// Текст есть, но фокус потерян: строка остаётся чуть яркой, текст белым.
		&.inputValue {
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));

			input {
				color: var(--white, #fff);
			}
		}
	}

	input {
		color: #fff;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0 4px;
		/* text-16 */
		font-family: Inter;
		font-size: 15px;
		font-style: normal;
		font-weight: 400;
		line-height: 20px; /* 125% */
		border: none;
		width: 100%;
		background: none;
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;

		&::placeholder {
			color: var(--gray-soft, #6a6e77);
		}

		&:focus {
			color: var(--white, #fff);
			&::placeholder {
				color: transparent;
			}
		}
	}

	// Кнопка поиска: белый акцент, лежит внутри скруглённой строки справа.
	// Без жёлтого и без цветного свечения.
	.search {
		border: none;
		display: inline-flex;
		padding: 11px 18px;
		justify-content: center;
		align-items: center;
		gap: 8px;
		border-radius: 999px;
		background: var(--white, #fff);
		color: var(--black, #000);
		/* text-16-bold */
		font-family: Inter;
		font-size: 15px;
		font-style: normal;
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 20px; /* 125% */
		transition: all ease 0.25s;
		user-select: none;

		// Слово «Найти» остаётся: стрелки в строке больше нет, и на узком экране
		// кнопке нужно что-то показывать.
		@media (max-width: 768px) {
			padding: 10px 14px;
		}

		&:active {
			transform: scale(90%);
		}

		@include hover {
			box-shadow: 0 10px 24px rgba(255, 255, 255, 0.12);
		}

		// Кнопка остаётся белой и при пустом поле: пустая строка поиска не должна
		// выглядеть серой. Нажатие без текста ничего не делает — проверка в коде.
		&:disabled {
			&:active {
				transform: none;
			}

			@include hover {
				box-shadow: none;
			}
		}
	}
</style>

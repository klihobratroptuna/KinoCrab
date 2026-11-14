// Карусель аниме на Kodik: тот же интерфейс, что у animego, чтобы блок не менялся —
// только строка импорта. animego остаётся как запасной путь: если живой тест не устроит,
// возвращаем прежний импорт.
import { currentSeason } from '$lib/shared/animego';
import { canOpenInternal, refreshFor, snapshotFor, tileHrefFor } from './index.js';

// Название сезона берём то же, что уже стало ключом в базе: сезон по месяцу, 2026/fall.
export { currentSeason };

export function loadSnapshot(season, force = false) {
	return snapshotFor('anime', season, force);
}

export function refreshSnapshot(season) {
	return refreshFor('anime', season);
}

export function tileHref(card) {
	return tileHrefFor('anime', card);
}

export function isInternal(card) {
	return canOpenInternal('anime', card);
}

// Карусель дорам на Kodik: тот же интерфейс, что у kinovibe, чтобы блок не менялся —
// только строка импорта. kinovibe остаётся как запасной путь: если живой тест не устроит,
// возвращаем прежний импорт.
import { canOpenInternal, cardByTitleFor, refreshFor, snapshotFor, tileHrefFor } from './index.js';

export function loadSnapshot(force = false) {
	return snapshotFor('drama', '', force);
}

export function refreshSnapshot() {
	return refreshFor('drama', '');
}

export function tileHref(card) {
	return tileHrefFor('drama', card);
}

export function carouselCardByTitle(title, force = false) {
	return cardByTitleFor('drama', '', title, force);
}

export function isInternal(card) {
	return canOpenInternal('drama', card);
}

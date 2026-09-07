import { russianPlural } from './russianPlural';

it.each([
  [0, 'дней'], [1, 'день'], [2, 'дня'], [4, 'дня'], [5, 'дней'],
  [11, 'дней'], [12, 'дней'], [14, 'дней'], [21, 'день'], [22, 'дня'],
  [25, 'дней'], [101, 'день'], [111, 'дней'], [-2, 'дня'], [1.5, 'дня'],
] as const)('uses the Russian form for %s', (count, word) => {
  expect(russianPlural(count, ['день', 'дня', 'дней'])).toBe(word);
});

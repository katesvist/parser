const tokenizeRegex = /[a-zа-яё0-9]+/gi;

const toLowerRussian = (text: string) => text.toLowerCase().replace(/ё/g, 'е');

const suffixes = [
  'иями',
  'ями',
  'ами',
  'ией',
  'ией',
  'иям',
  'ием',
  'иях',
  'иях',
  'ях',
  'ия',
  'ии',
  'ию',
  'ий',
  'ие',
  'ье',
  'ья',
  'ьи',
  'ью',
  'ьях',
  'ями',
  'ями',
  'ов',
  'ев',
  'ей',
  'ий',
  'ай',
  'ой',
  'ый',
  'ей',
  'ем',
  'ом',
  'ах',
  'ам',
  'ям',
  'ям',
  'ям',
  'ям',
  'ою',
  'ею',
  'ую',
  'юю',
  'ая',
  'яя',
  'ою',
  'ею',
  'ия',
  'ья',
  'ья',
  'ью',
  'ий',
  'ый',
  'ой',
  'ое',
  'ее',
  'ие',
  'ые',
  'го',
  'его',
  'ому',
  'ему',
  'ому',
  'ему',
  'ам',
  'ям',
  'ах',
  'ях',
  'ет',
  'ют',
  'ит',
  'ат',
  'ят',
  'ешь',
  'ишь',
  'ем',
  'им',
  'ил',
  'ыл',
  'ла',
  'на',
  'ло',
  'но',
  'ны',
  'ли',
  'ть',
  'ти',
  'й',
  'ю',
  'у',
  'а',
  'о',
  'е',
  'ы',
  'и',
  'я',
  'ь',
];

const uniqueSuffixes = Array.from(new Set(suffixes)).sort(
  (a, b) => b.length - a.length
);

const MIN_STEM_LENGTH = 3;

const stemCache = new Map<string, string>();

const simpleStem = (input: string) => {
  if (input.length <= MIN_STEM_LENGTH) {
    return toLowerRussian(input);
  }

  if (stemCache.has(input)) {
    return stemCache.get(input)!;
  }

  let word = toLowerRussian(input);

  for (const suffix of uniqueSuffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM_LENGTH) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }

  stemCache.set(input, word);
  return word;
};

const splitTokens = (text: string) =>
  (text.match(tokenizeRegex) ?? []).map((token) => toLowerRussian(token));

export const buildTokenSet = (text: string) => {
  const set = new Set<string>();
  for (const token of splitTokens(text)) {
    if (!token) continue;
    set.add(token);
    set.add(simpleStem(token));
  }
  return set;
};

export const tokenizeQuery = (query: string) =>
  splitTokens(query).map((token) => ({
    raw: token,
    stem: simpleStem(token),
  }));

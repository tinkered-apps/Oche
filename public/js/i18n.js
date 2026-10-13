// Interface text in two languages.
//
// English is the default, Polish is a complete second set. Every visible string
// lives here under a key, so switching language just redraws the screen.
// Bed labels (20, D20, T20, BULL, MISS) stay the same in both
// languages, because that is how they are written everywhere.

const en = {
  'app.title': 'Oche: automatic darts scoring',
  'footer.privacy': 'Privacy',

  'player.default': 'Player {n}',

  'scoreboard.aria': 'Scores',
  'throws.aria': 'Darts in this turn',
  'modes.aria': 'How darts are entered',
  'mode.camera': 'Camera',
  'mode.board': 'Board',
  'mode.keypad': 'Keypad',

  'stage.intro': 'Point the phone so the whole board fits in the frame. I find the board and count the darts.',
  'stage.start': 'Turn on the camera',
  'stage.retry': 'Try again',
  'stage.starting': 'Starting the camera…',
  'stage.blocked': 'This browser gives no access to the camera. Open the page over <b>https://</b> or switch to a manual mode in the settings.',
  'stage.noCamera': 'This browser offers no camera (an <b>https://</b> address is needed). Pick the <b>Board</b> or <b>Keypad</b> mode.',
  'stage.failed': 'Could not turn on the camera: {message}',

  'board.aria': 'Dartboard',
  'board.hint': 'Tap where the dart landed.',

  'keypad.hint': 'A number scores a single. For a double or triple, tap ×2 or ×3 first, then the number.',
  'keypad.double': 'Double',
  'keypad.triple': 'Triple',
  'keypad.thenNumber': 'then a number',
  'keypad.tapNumber': 'tap a number',
  'keypad.bull': 'BULL 50',
  'keypad.outerBull': '25',
  'keypad.miss': 'MISS 0',

  'ring.single': 'Single',
  'ring.double': 'Double',
  'ring.triple': 'Triple',

  'slot.empty': 'dart {n}',
  'slot.points': '{points} pts',
  'stat.checkout': 'checkout: {path}',
  'stat.average': 'avg {value}',

  'turn.next': 'Next player',
  'turn.resume': 'Darts pulled, {name} throws',
  'turn.newGame': 'New game',

  'action.undo': 'Undo',
  'action.calibrate': 'Find board',
  'action.settings': 'Settings',

  'status.setup': 'Put the phone opposite the board and turn on the camera',
  'status.settling': 'Learning the empty board…',
  'status.searching': 'Looking for the board in the frame…',
  'status.waiting': 'Waiting for the camera image…',
  'status.found': 'Board found. Throw, I count on my own',
  'status.pull': 'Take the darts out of the board, then {name} throws',
  'status.pullShort': 'Take the darts out, then {name} throws',
  'status.winner': '{name} wins',

  'watch.baseline': 'Board clear, throw',
  'watch.watching': 'Waiting for a dart',
  'watch.confirming': 'Something arrived, checking',
  'watch.motion': 'Movement in the frame, waiting for it to settle',
  'watch.occluded': 'Board covered, step out of the frame',
  'watch.settling': 'Stabilising the image…',

  'hint.keypad': 'Enter the darts on the keypad',
  'hint.board': 'Tap the board to record darts',

  'flash.uncertain': '{score} (right on the wire, check it)',
  'flash.manual': '{score} (by hand)',
  'flash.duplicate': 'Skipped. That dart is already counted',
  'flash.edited': 'Changed to: {score}',
  'flash.deleted': 'Dart removed',
  'flash.bust': 'Bust. The turn doesn\'t count, back to {score}',

  'score.bull': 'Bulls-eye = 50',
  'score.outerBull': 'Outer bull = 25',
  'score.double': 'Double {sector} = {points}',
  'score.triple': 'Triple {sector} = {points}',
  'score.single': 'Single {sector} = {points}',
  'score.out': 'Off the board = 0',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.theme.system': 'Match the device',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.game': 'Game',
  'settings.game.101': '101 (quick leg)',
  'settings.game.301': '301',
  'settings.game.501': '501',
  'settings.doubleOut': 'Finish on a double (double out)',
  'settings.doubleOutNote': 'With this rule only a double or the bulls-eye ends the game, and leaving one point is a bust. Changing the game or the rules mid-leg starts a new one.',
  'settings.player': 'Player {n}',
  'settings.minGap': 'Closest separate hits',
  'settings.minGap.4': '4 mm (tight groups counted separately)',
  'settings.minGap.8': '8 mm (recommended)',
  'settings.minGap.15': '15 mm (fewer repeats of the same dart)',
  'settings.minGapNote': 'A hit closer than this to a dart already counted in this turn is taken for that same dart. A smaller value counts tight groups better, a larger one filters out a dart still shaking after it lands.',
  'settings.skip': 'Skip turn',
  'settings.newGame': 'New game',
  'settings.done': 'Done',
  'settings.install': 'Install app',
  'settings.installNote': 'Adds Oche to your home screen like any other app. It opens full screen and works without internet.',

  'calib.note': 'Board recognised: match {match}%, radius {radius} px, {squash}% face-on.',
  'calib.none': 'Board not recognised yet.',
  'calib.noBoard': 'I cannot see the board. Check that all of it fits in the frame and that there is enough light.',
  'calib.partial': 'I can only see part of the board. Get the whole board in the frame.',
  'calib.blurry': 'The outline of the board is unclear. Improve the light or the position of the phone.',
  'calib.fitFailed': 'Could not fit the outline of the board. Point the phone more straight on.',
  'calib.tooFlat': 'The board is seen too flat. Move the phone more straight in front of it.',
  'calib.failed': 'Could not recognise the board. Try once more.',
  'calib.noBull': 'I cannot see the centre of the board (the bull). Check the focus and the light.',
  'calib.tooSkewed': 'The camera is at too sharp an angle to read the board reliably.',
  'calib.noOrientation': 'I recognised the board, but not the way it is turned. Check that the 20 is at the top.',
  'calib.uncertain': 'Recognition of the board is shaky. Improve the light or the position of the phone.',

  'edit.title': 'Fix the dart',
  'edit.titleWith': 'Dart: {label}',
  'edit.noteUncertain': 'This dart landed right on the wire of a bed, where mistakes are easiest.',
  'edit.noteEdited': 'Fixed by hand.',
  'edit.noteDefault': 'Pick the right bed if the automatic count got it wrong.',
  'edit.other': 'Another bed',
  'edit.delete': 'Delete dart',
  'edit.close': 'Close',

  'win.line': 'takes the {start} leg',
  'win.darts': 'darts',
  'win.average': 'per turn',
  'win.best': 'best turn',
  'win.rematch': 'Rematch',
  'win.close': 'Close',

  'camera.unsupported': 'This browser gives no access to the camera. Open the page over HTTPS or on localhost.'
};

const pl = {
  'app.title': 'Oche: automatyczne liczenie punktów',
  'footer.privacy': 'Prywatność',

  'player.default': 'Gracz {n}',

  'scoreboard.aria': 'Wyniki',
  'throws.aria': 'Trafienia w tej kolejce',
  'modes.aria': 'Sposób wpisywania rzutów',
  'mode.camera': 'Kamera',
  'mode.board': 'Tarcza',
  'mode.keypad': 'Cyfry',

  'stage.intro': 'Ustaw telefon tak, żeby cała tarcza była w kadrze. Resztę zrobię sam. Znajdę tarczę i policzę rzuty.',
  'stage.start': 'Włącz kamerę',
  'stage.retry': 'Spróbuj ponownie',
  'stage.starting': 'Uruchamiam kamerę…',
  'stage.blocked': 'Ta przeglądarka nie daje dostępu do kamery. Otwórz stronę przez <b>https://</b> albo włącz tryb ręczny w ustawieniach.',
  'stage.noCamera': 'Ta przeglądarka nie udostępnia kamery (potrzebny adres <b>https://</b>). Wybierz tryb <b>Tarcza</b> albo <b>Cyfry</b>.',
  'stage.failed': 'Nie udało się włączyć kamery: {message}',

  'board.aria': 'Tarcza do darta',
  'board.hint': 'Stuknij w miejsce trafienia lotki.',

  'keypad.hint': 'Numer to pojedyncze. Na podwójne albo potrójne najpierw stuknij ×2 lub ×3, potem numer.',
  'keypad.double': 'Podwójne',
  'keypad.triple': 'Potrójne',
  'keypad.thenNumber': 'potem numer',
  'keypad.tapNumber': 'stuknij numer',
  'keypad.bull': 'BULL 50',
  'keypad.outerBull': '25',
  'keypad.miss': 'PUDŁO 0',

  'ring.single': 'Pojedyncze',
  'ring.double': 'Podwójne',
  'ring.triple': 'Potrójne',

  'slot.empty': 'lotka {n}',
  'slot.points': '{points} pkt',
  'stat.checkout': 'zejście: {path}',
  'stat.average': 'śr. {value}',

  'turn.next': 'Następny gracz',
  'turn.resume': 'Lotki wyjęte, gra {name}',
  'turn.newGame': 'Nowa gra',

  'action.undo': 'Cofnij',
  'action.calibrate': 'Znajdź tarczę',
  'action.settings': 'Ustawienia',

  'status.setup': 'Ustaw telefon naprzeciw tarczy i włącz kamerę',
  'status.settling': 'Zapamiętuję czystą tarczę…',
  'status.searching': 'Szukam tarczy w kadrze…',
  'status.waiting': 'Czekam na obraz z kamery…',
  'status.found': 'Tarcza znaleziona. Rzucaj, liczę sam',
  'status.pull': 'Wyjmij lotki z tarczy, potem kolejka: {name}',
  'status.pullShort': 'Wyjmij lotki, potem gra {name}',
  'status.winner': 'Wygrywa {name}',

  'watch.baseline': 'Tarcza czysta, rzucaj',
  'watch.watching': 'Czekam na rzut',
  'watch.confirming': 'Coś przybyło, sprawdzam',
  'watch.motion': 'Ruch w kadrze. Czekam, aż się uspokoi',
  'watch.occluded': 'Tarcza zasłonięta, odsuń się od kadru',
  'watch.settling': 'Stabilizuję obraz…',

  'hint.keypad': 'Wpisz rzuty z klawiatury',
  'hint.board': 'Stukaj w tarczę, żeby zapisać rzuty',

  'flash.uncertain': '{score} (tuż przy krawędzi, sprawdź)',
  'flash.manual': '{score} (ręcznie)',
  'flash.duplicate': 'Pomijam. To lotka, która jest już policzona',
  'flash.edited': 'Poprawione na: {score}',
  'flash.deleted': 'Rzut usunięty',
  'flash.bust': 'Przekroczenie. Kolejka się nie liczy, powrót do {score}',

  'score.bull': 'Bulls-eye = 50',
  'score.outerBull': 'Zewnętrzny bull = 25',
  'score.double': 'Podwójne {sector} = {points}',
  'score.triple': 'Potrójne {sector} = {points}',
  'score.single': 'Pojedyncze {sector} = {points}',
  'score.out': 'Poza tarczą = 0',

  'settings.title': 'Ustawienia',
  'settings.language': 'Język',
  'settings.theme': 'Motyw',
  'settings.theme.system': 'Jak w urządzeniu',
  'settings.theme.light': 'Jasny',
  'settings.theme.dark': 'Ciemny',
  'settings.game': 'Gra',
  'settings.game.101': '101 (szybka partia)',
  'settings.game.301': '301',
  'settings.game.501': '501',
  'settings.doubleOut': 'Zamknięcie podwójnym (double out)',
  'settings.doubleOutNote': 'Przy tej zasadzie grę kończy tylko trafienie w pole podwójne albo w bulls-eye, a zostawienie jednego punktu jest przekroczeniem. Zmiana gry lub zasad w trakcie partii zaczyna nową.',
  'settings.player': 'Gracz {n}',
  'settings.minGap': 'Najbliższe osobne trafienia',
  'settings.minGap.4': '4 mm (ciasne grupy liczone osobno)',
  'settings.minGap.8': '8 mm (zalecane)',
  'settings.minGap.15': '15 mm (mniej powtórek tej samej lotki)',
  'settings.minGapNote': 'Trafienie bliżej niż tyle od lotki już policzonej w tej kolejce jest uznawane za tę samą lotkę. Mniejsza wartość lepiej liczy ciasne grupy, większa skuteczniej odsiewa drgania lotki po wbiciu.',
  'settings.skip': 'Pomiń kolejkę',
  'settings.newGame': 'Nowa gra',
  'settings.done': 'Gotowe',
  'settings.install': 'Zainstaluj aplikację',
  'settings.installNote': 'Dodaje Oche do ekranu głównego jak każdą inną aplikację. Otwiera się na pełnym ekranie i działa bez internetu.',

  'calib.note': 'Tarcza rozpoznana: zgodność {match}%, promień {radius} px, ujęcie {squash}% na wprost.',
  'calib.none': 'Tarcza jeszcze nierozpoznana.',
  'calib.noBoard': 'Nie widzę tarczy. Sprawdź, czy cała mieści się w kadrze i czy jest dość światła.',
  'calib.partial': 'Widzę tarczę tylko częściowo. Obejmij kadrem całą tarczę.',
  'calib.blurry': 'Obrys tarczy jest niewyraźny. Popraw oświetlenie albo ustawienie telefonu.',
  'calib.fitFailed': 'Nie udało się dopasować obrysu tarczy. Ustaw telefon bardziej na wprost.',
  'calib.tooFlat': 'Tarcza widziana zbyt płasko. Przesuń telefon bardziej na wprost tarczy.',
  'calib.failed': 'Nie udało się rozpoznać tarczy. Spróbuj jeszcze raz.',
  'calib.noBull': 'Nie widzę środka tarczy (bulla). Sprawdź ostrość i oświetlenie.',
  'calib.tooSkewed': 'Ustawienie kamery jest zbyt skośne, żeby wiarygodnie odczytać tarczę.',
  'calib.noOrientation': 'Rozpoznałem tarczę, ale nie jej ustawienie. Sprawdź, czy pole 20 jest na górze.',
  'calib.uncertain': 'Rozpoznanie tarczy jest niepewne. Popraw światło albo ustawienie telefonu.',

  'edit.title': 'Popraw trafienie',
  'edit.titleWith': 'Trafienie: {label}',
  'edit.noteUncertain': 'To trafienie wypadło tuż przy krawędzi pola, gdzie najłatwiej o pomyłkę.',
  'edit.noteEdited': 'Poprawione ręcznie.',
  'edit.noteDefault': 'Wybierz właściwe pole, jeśli automat się pomylił.',
  'edit.other': 'Inne pole',
  'edit.delete': 'Usuń rzut',
  'edit.close': 'Zamknij',

  'win.line': 'wygrywa lega {start}',
  'win.darts': 'lotki',
  'win.average': 'na kolejkę',
  'win.best': 'najlepsza kolejka',
  'win.rematch': 'Rewanż',
  'win.close': 'Zamknij',

  'camera.unsupported': 'Ta przeglądarka nie udostępnia kamery. Otwórz stronę przez HTTPS lub na localhost.'
};

const DICTS = { en, pl };

/** Languages offered by the app; each name is always in its own language. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polski' }
];

export const DEFAULT_LANGUAGE = 'en';

let current = DEFAULT_LANGUAGE;

export function getLanguage() {
  return current;
}

/** Sets the language; an unknown code falls back to English. */
export function setLanguage(code) {
  current = DICTS[code] ? code : DEFAULT_LANGUAGE;
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}

/**
 * Text for a key, with `{name}` placeholders filled in. An unknown key comes back
 * as is, so this function can also be given a plain browser message and nothing
 * breaks.
 */
export function t(key, params) {
  const dict = DICTS[current] || en;
  const template = dict[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

/** Default player name (numbered from one). */
export function defaultPlayerName(index) {
  return t('player.default', { n: index + 1 });
}

/** Whether this name is only the default label, in any of the languages. */
export function isDefaultPlayerName(name, index) {
  return Object.values(DICTS).some((dict) => (
    dict['player.default'].replace('{n}', String(index + 1)) === name
  ));
}

/** A throw described in words, e.g. "Triple 20 = 60". */
export function describeScore(score) {
  switch (score.ring) {
    case 'bull': return t('score.bull');
    case 'outerBull': return t('score.outerBull');
    case 'double': return t('score.double', score);
    case 'triple': return t('score.triple', score);
    case 'single': return t('score.single', score);
    default: return t('score.out');
  }
}

/**
 * Puts text into the static document. `data-i18n` replaces an element's content,
 * `data-i18n-html` lets simple markup through (bold text in messages), and
 * `data-i18n-aria` labels the element for screen readers.
 */
export function applyStaticTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  const title = root.querySelector('title');
  if (title) title.textContent = t('app.title');
}

import './style.css';
import {
  createHandheld,
  type HandheldControl,
  type HandheldScene,
} from './handheld';
import {
  CREW_MEMBERS,
  createPixelScreen,
  screenActionFromKey,
  type PixelScreenController,
} from './screen';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root was not found.');

const controls: ReadonlyArray<{ action: HandheldControl; label: string }> = [
  { action: 'up', label: 'Up' },
  { action: 'down', label: 'Down' },
  { action: 'left', label: 'Left' },
  { action: 'right', label: 'Right' },
  { action: 'a', label: 'A' },
  { action: 'b', label: 'B' },
  { action: 'start', label: 'Start' },
  { action: 'select', label: 'Select' },
];

app.innerHTML = `
  <main class="app-shell">
    <a class="skip-link" href="#text-mode">Skip the 3D console</a>
    <p class="brand-mark">
      Davy Back Fight Games
      <span>Interactive proof of concept</span>
    </p>

    <p class="status" role="status" aria-live="polite" data-state="loading">
      Booting handheld
    </p>

    <div class="scene-shell" aria-hidden="true">
      <canvas class="scene-canvas" data-handheld-scene></canvas>
    </div>

    <p class="help">
      Click the console or use <span class="desktop-only"><kbd>arrow keys</kbd>, <kbd>Z</kbd>, <kbd>X</kbd></span>
      <span aria-hidden="true"> · </span><kbd>Shift</kbd> for help
    </p>

    <div class="semantic-controls" role="toolbar" aria-label="Handheld controls">
      ${controls
        .map(
          ({ action, label }) =>
            `<button type="button" data-control="${action}" aria-label="${label} button">${label}</button>`,
        )
        .join('')}
    </div>

    <button
      class="text-mode-toggle"
      type="button"
      aria-expanded="false"
      aria-controls="text-mode"
    >
      Text mode
    </button>

    <section class="text-mode-panel" id="text-mode" hidden>
      <div class="text-mode-panel__inner">
        <h1 tabindex="-1">Davy Back Fight Games</h1>
        <p>
          A small independent game studio making playful games with a sharp edge.
          This copy is temporary while we test the handheld concept.
        </p>

        <h2>Games</h2>
        <p>Our first project is in the works. More loot soon.</p>

        <h2>The crew</h2>
        ${CREW_MEMBERS.map(
          ({ name, role, bio }) => `
            <article>
              <h3>${name} — ${role}</h3>
              <p>${bio.join(' ')}</p>
            </article>
          `,
        ).join('')}

        <h2>Contact</h2>
        <p>Contact details and social links are placeholders for this proof of concept.</p>
      </div>
    </section>
  </main>
`;

function queryRequired<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required element was not found: ${selector}`);
  return element;
}

const canvas = queryRequired<HTMLCanvasElement>('[data-handheld-scene]');
const status = queryRequired<HTMLElement>('.status');
const textModeToggle = queryRequired<HTMLButtonElement>('.text-mode-toggle');
const textModePanel = queryRequired<HTMLElement>('.text-mode-panel');
const textModeHeading = queryRequired<HTMLElement>('h1', textModePanel);
const skipLink = queryRequired<HTMLAnchorElement>('.skip-link');

let handheld: HandheldScene | undefined;
let pixelScreen: PixelScreenController | undefined;
let audioContext: AudioContext | undefined;

function playControlSound(): void {
  if (!pixelScreen?.getState().soundEnabled) return;
  audioContext ??= new AudioContext();
  const startedAt = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(155, startedAt);
  oscillator.frequency.exponentialRampToValueAtTime(105, startedAt + 0.055);
  gain.gain.setValueAtTime(0.025, startedAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.06);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + 0.065);
}

function dispatchControl(control: HandheldControl, showPhysicalPress = false): void {
  if (!pixelScreen) return;
  if (showPhysicalPress) handheld?.flashControl(control);
  pixelScreen.dispatch(control);
  playControlSound();
}

function setTextMode(open: boolean, moveFocus = true): void {
  document.body.dataset.textMode = String(open);
  textModePanel.hidden = !open;
  textModeToggle.setAttribute('aria-expanded', String(open));
  textModeToggle.textContent = open ? 'Close text mode' : 'Text mode';
  if (open && moveFocus) textModeHeading.focus();
}

textModeToggle.addEventListener('click', () => {
  setTextMode(textModeToggle.getAttribute('aria-expanded') !== 'true');
});

skipLink.addEventListener('click', (event) => {
  event.preventDefault();
  setTextMode(true);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
  button.addEventListener('click', () => {
    dispatchControl(button.dataset.control as HandheldControl, true);
  });
}

window.addEventListener('keydown', (event) => {
  if (document.body.dataset.textMode === 'true') {
    if (event.key === 'Escape') {
      setTextMode(false, false);
      textModeToggle.focus();
    }
    return;
  }

  if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
  const action = screenActionFromKey(event.key);
  if (!action || event.repeat) return;
  event.preventDefault();
  dispatchControl(action, true);
});

try {
  handheld = createHandheld({
    canvas,
    onControl: (control) => dispatchControl(control),
    onContextLost: () => {
      status.dataset.state = 'fallback';
      status.textContent = '3D unavailable — text mode ready';
      setTextMode(true, false);
    },
  });

  pixelScreen = createPixelScreen({
    canvas: handheld.screenCanvas,
    onRender: () => handheld?.updateScreen(),
  });

  pixelScreen.subscribe((_screenCanvas, state) => {
    status.dataset.state = state.screen === 'boot' ? 'loading' : 'ready';
    status.textContent = state.helpOpen
      ? 'Controls and sound'
      : state.screen === 'boot'
        ? 'Booting handheld'
        : state.screen === 'menu'
          ? 'Ready to play'
          : `Viewing ${state.screen}`;
  });
} catch (error) {
  console.error(error);
  status.dataset.state = 'fallback';
  status.textContent = '3D unavailable — text mode ready';
  setTextMode(true, false);
}

window.addEventListener('pagehide', () => {
  pixelScreen?.destroy();
  handheld?.destroy();
  void audioContext?.close();
});

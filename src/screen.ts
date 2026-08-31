/**
 * 160 x 144 logical screen UI for the Davy Back Fight Games handheld PoC.
 *
 * The copy in SCREEN_COPY is intentionally placeholder content. Keeping it in
 * one object makes replacing it later deliberately boring.
 */

export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;
export const SCREEN_RENDER_SCALE = 4;
export const SCREEN_BACKING_WIDTH = SCREEN_WIDTH * SCREEN_RENDER_SCALE;
export const SCREEN_BACKING_HEIGHT = SCREEN_HEIGHT * SCREEN_RENDER_SCALE;

export type ScreenAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "start"
  | "select";

export type PageId = "games" | "studio" | "crew" | "contact";
export type ScreenId = "boot" | "menu" | PageId;

export interface PixelScreenState {
  screen: ScreenId;
  menuIndex: number;
  helpOpen: boolean;
  soundEnabled: boolean;
  revision: number;
}

export interface PixelScreenOptions {
  /** Supply a canvas for frameworks that need to own the DOM node. */
  canvas?: HTMLCanvasElement;
  /** Defaults to 850ms. Pass 0 to skip the boot screen in development. */
  bootDuration?: number;
  /** Called after every canvas redraw; set `texture.needsUpdate = true` here. */
  onRender?: (canvas: HTMLCanvasElement, state: Readonly<PixelScreenState>) => void;
  onSoundChange?: (enabled: boolean) => void;
}

export interface PixelScreenController {
  readonly canvas: HTMLCanvasElement;
  dispatch(action: ScreenAction): void;
  getState(): Readonly<PixelScreenState>;
  render(): void;
  subscribe(
    listener: (canvas: HTMLCanvasElement, state: Readonly<PixelScreenState>) => void,
  ): () => void;
  destroy(): void;
}

const MENU: ReadonlyArray<{ label: string; page: PageId }> = [
  { label: "GAMES", page: "games" },
  { label: "THE STUDIO", page: "studio" },
  { label: "THE CREW", page: "crew" },
  { label: "CONTACT", page: "contact" },
];

const SCREEN_COPY: Record<
  PageId,
  { kicker: string; title: string; body: readonly string[] }
> = {
  games: {
    kicker: "UPCOMING",
    title: "THE BLACK SPOT",
    body: ["CODENAME / PLACEHOLDER", "STATUS: IN THE WORKS", "MORE LOOT SOON."],
  },
  studio: {
    kicker: "DAVY BACK",
    title: "SMALL CREW.",
    body: ["LOUD IDEAS.", "WE MAKE PLAYFUL GAMES", "WITH A SHARP EDGE."],
  },
  crew: {
    kicker: "ROLL CALL",
    title: "THE CREW",
    body: ["NAMES COMING SOON.", "CURRENTLY: MAKING", "WEIRD THINGS WORK."],
  },
  contact: {
    kicker: "SEND A SIGNAL",
    title: "SAY AHOY",
    body: ["HELLO@DAVYBACK.GAMES", "SOCIALS COMING SOON.", "NO SPAM. GOOD VIBES."],
  },
};

const COLOR = {
  ink: "#132a25",
  deep: "#24503e",
  mid: "#4f7a4d",
  light: "#a5b85d",
  paper: "#d4d56a",
  flash: "#f5ec8b",
} as const;

type RenderListener = (
  canvas: HTMLCanvasElement,
  state: Readonly<PixelScreenState>,
) => void;

class ScreenController implements PixelScreenController {
  readonly canvas: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D;
  private readonly bootDuration: number;
  private readonly bootStartedAt: number;
  private readonly onSoundChange?: (enabled: boolean) => void;
  private readonly listeners = new Set<RenderListener>();
  private state: PixelScreenState;
  private animationFrame: number | undefined;
  private disposed = false;

  constructor(options: PixelScreenOptions) {
    this.canvas = options.canvas ?? document.createElement("canvas");
    // Preserve the original layout coordinates while rasterising at 4x. Text
    // and diagonal edges are now antialiased instead of being reduced to a
    // handful of chunky pixels.
    this.canvas.width = SCREEN_BACKING_WIDTH;
    this.canvas.height = SCREEN_BACKING_HEIGHT;
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.imageRendering = "auto";

    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for the pixel screen.");
    this.context = context;
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";

    this.bootDuration = Math.max(0, options.bootDuration ?? 850);
    this.bootStartedAt = now();
    this.onSoundChange = options.onSoundChange;
    if (options.onRender) this.listeners.add(options.onRender);

    this.state = {
      screen: this.bootDuration === 0 ? "menu" : "boot",
      menuIndex: 0,
      helpOpen: false,
      soundEnabled: false,
      revision: 0,
    };

    this.render();
    if (this.state.screen === "boot") this.animateBoot();
  }

  dispatch(action: ScreenAction): void {
    if (this.disposed) return;

    if (this.state.screen === "boot") {
      if (action === "a" || action === "start") this.finishBoot();
      return;
    }

    if (this.state.helpOpen) {
      if (action === "a") this.setSound(!this.state.soundEnabled);
      if (action === "b" || action === "select") this.setState({ helpOpen: false });
      if (action === "start") this.goHome();
      return;
    }

    if (action === "select") {
      this.setState({ helpOpen: true });
      return;
    }

    if (action === "start") {
      this.goHome();
      return;
    }

    if (this.state.screen === "menu") {
      if (action === "up") this.moveMenu(-1);
      if (action === "down") this.moveMenu(1);
      if (action === "a") this.setState({ screen: MENU[this.state.menuIndex].page });
      return;
    }

    if (action === "b") {
      this.goHome();
      return;
    }

    // The shoulder-to-shoulder content pages can also be browsed without
    // repeatedly returning to the menu.
    if (action === "left" || action === "right") {
      const current = MENU.findIndex((item) => item.page === this.state.screen);
      const step = action === "left" ? -1 : 1;
      const menuIndex = wrap(current + step, MENU.length);
      this.setState({ menuIndex, screen: MENU[menuIndex].page });
    }
  }

  getState(): Readonly<PixelScreenState> {
    return { ...this.state };
  }

  render(): void {
    if (this.disposed) return;
    this.prepareContext();
    if (this.state.screen === "boot") this.drawBoot();
    else if (this.state.screen === "menu") this.drawMenu();
    else this.drawPage(this.state.screen);

    if (this.state.helpOpen) this.drawHelp();
    for (const listener of this.listeners) listener(this.canvas, this.getState());
  }

  subscribe(listener: RenderListener): () => void {
    this.listeners.add(listener);
    listener(this.canvas, this.getState());
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.disposed = true;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.listeners.clear();
  }

  private animateBoot = (): void => {
    if (this.disposed || this.state.screen !== "boot") return;
    const elapsed = now() - this.bootStartedAt;
    if (elapsed >= this.bootDuration) {
      this.finishBoot();
      return;
    }
    this.render();
    this.animationFrame = requestAnimationFrame(this.animateBoot);
  };

  private finishBoot(): void {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.setState({ screen: "menu" });
  }

  private moveMenu(step: number): void {
    this.setState({ menuIndex: wrap(this.state.menuIndex + step, MENU.length) });
  }

  private goHome(): void {
    this.setState({ screen: "menu", helpOpen: false });
  }

  private setSound(enabled: boolean): void {
    this.setState({ soundEnabled: enabled });
    this.onSoundChange?.(enabled);
  }

  private setState(patch: Partial<PixelScreenState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.render();
  }

  private prepareContext(): void {
    const { context: ctx } = this;

    // Context transforms survive between frames. Return to backing pixels so
    // every redraw covers all 640 x 576 pixels, then restore logical units.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLOR.paper;
    ctx.fillRect(0, 0, SCREEN_BACKING_WIDTH, SCREEN_BACKING_HEIGHT);
    ctx.setTransform(SCREEN_RENDER_SCALE, 0, 0, SCREEN_RENDER_SCALE, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  private clear(): void {
    const { context: ctx } = this;

    // A very sparse dot pattern keeps some display character without adding
    // noisy texture immediately behind every letter.
    ctx.fillStyle = COLOR.light;
    for (let y = 3; y < SCREEN_HEIGHT; y += 12) {
      for (let x = (y / 12) % 2 ? 8 : 2; x < SCREEN_WIDTH; x += 12) {
        ctx.fillRect(x, y, 0.65, 0.65);
      }
    }
  }

  private drawBoot(): void {
    this.clear();
    const ctx = this.context;
    const progress = this.bootDuration === 0
      ? 1
      : Math.min(1, (now() - this.bootStartedAt) / this.bootDuration);
    const reveal = Math.max(0, Math.min(9, Math.floor(progress * 11)));

    drawFlag(ctx, 68, 20);
    text(ctx, "DAVY BACK", 80, 61, { align: "center", size: 12, color: COLOR.ink });
    text(ctx, "FIGHT GAMES", 80, 76, { align: "center", size: 7, color: COLOR.deep });
    ctx.strokeStyle = COLOR.deep;
    ctx.lineWidth = 2;
    ctx.strokeRect(43, 94, 74, 8);
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(46, 97, reveal * 7, 2);
    text(ctx, "A / START TO SKIP", 80, 122, {
      align: "center",
      size: 6,
      color: COLOR.deep,
    });
  }

  private drawMenu(): void {
    this.clear();
    const ctx = this.context;
    drawHeader(ctx, this.state.soundEnabled);

    text(ctx, "CHOOSE YOUR COURSE", 12, 33, { size: 7, color: COLOR.deep });
    MENU.forEach((item, index) => {
      const y = 45 + index * 18;
      if (index === this.state.menuIndex) {
        ctx.fillStyle = COLOR.ink;
        ctx.fillRect(8, y - 9, 144, 15);
        cutCorners(ctx, 8, y - 9, 144, 15, COLOR.paper);
        text(ctx, ">", 16, y + 1, { size: 8, color: COLOR.flash });
        text(ctx, item.label, 29, y, { size: 9, color: COLOR.flash });
      } else {
        text(ctx, item.label, 29, y, { size: 9, color: COLOR.ink });
      }
    });

    drawFooter(ctx, "D-PAD MOVE", "A OPEN");
  }

  private drawPage(page: PageId): void {
    this.clear();
    const ctx = this.context;
    const content = SCREEN_COPY[page];
    drawHeader(ctx, this.state.soundEnabled);

    text(ctx, content.kicker, 10, 37, { size: 6.5, color: COLOR.deep });
    text(ctx, content.title, 10, 55, { size: 11, color: COLOR.ink });
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(10, 62, 36, 3);

    content.body.forEach((line, index) => {
      text(ctx, line, 10, 80 + index * 13, {
        size: index === 0 ? 7 : 6.5,
        color: index === 0 ? COLOR.ink : COLOR.deep,
      });
    });
    drawFooter(ctx, "< > BROWSE", "B BACK");
  }

  private drawHelp(): void {
    const ctx = this.context;
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(7, 11, 146, 122);
    ctx.fillStyle = COLOR.flash;
    ctx.fillRect(10, 14, 140, 116);
    cutCorners(ctx, 10, 14, 140, 116, COLOR.ink);

    text(ctx, "CAPTAIN'S NOTES", 80, 32, {
      align: "center",
      size: 8,
      color: COLOR.ink,
    });
    ctx.fillStyle = COLOR.deep;
    ctx.fillRect(24, 39, 112, 2);
    text(ctx, "D-PAD   MOVE / BROWSE", 20, 57, { size: 6, color: COLOR.ink });
    text(ctx, "A       OPEN / SELECT", 20, 70, { size: 6, color: COLOR.ink });
    text(ctx, "B       GO BACK", 20, 83, { size: 6, color: COLOR.ink });
    text(ctx, "START   MAIN MENU", 20, 96, { size: 6, color: COLOR.ink });
    text(ctx, `A SOUND: ${this.state.soundEnabled ? "ON" : "OFF"}`, 20, 113, {
      size: 7,
      color: COLOR.deep,
    });
    text(ctx, "SELECT / B CLOSE", 80, 125, {
      align: "center",
      size: 6,
      color: COLOR.deep,
    });
  }
}

export function createPixelScreen(options: PixelScreenOptions = {}): PixelScreenController {
  return new ScreenController(options);
}

/** Maps browser controls to the same actions as the 3D device buttons. */
export function screenActionFromKey(key: string): ScreenAction | undefined {
  const normalized = key.toLowerCase();
  const mapping: Record<string, ScreenAction> = {
    arrowup: "up",
    w: "up",
    arrowdown: "down",
    s: "down",
    arrowleft: "left",
    a: "left",
    arrowright: "right",
    d: "right",
    z: "a",
    enter: "a",
    " ": "a",
    x: "b",
    escape: "b",
    shift: "select",
    backspace: "select",
    control: "start",
  };
  return mapping[normalized];
}

function drawHeader(ctx: CanvasRenderingContext2D, soundEnabled: boolean): void {
  ctx.fillStyle = COLOR.ink;
  ctx.fillRect(0, 0, SCREEN_WIDTH, 23);
  text(ctx, "DBFG // 01", 8, 15, { size: 7, color: COLOR.flash });
  text(ctx, soundEnabled ? "SND+" : "SND-", 151, 15, {
    align: "right",
    size: 6,
    color: COLOR.light,
  });
}

function drawFooter(ctx: CanvasRenderingContext2D, left: string, right: string): void {
  ctx.fillStyle = COLOR.deep;
  ctx.fillRect(0, 128, SCREEN_WIDTH, 16);
  text(ctx, left, 7, 139, { size: 6, color: COLOR.flash });
  text(ctx, right, 153, 139, { align: "right", size: 6, color: COLOR.flash });
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLOR.ink;
  ctx.fillRect(x, y, 3, 31);
  ctx.fillRect(x - 4, y + 30, 11, 3);
  ctx.fillRect(x + 3, y + 1, 27, 18);
  ctx.fillStyle = COLOR.paper;
  ctx.fillRect(x + 7, y + 5, 3, 3);
  ctx.fillRect(x + 20, y + 5, 3, 3);
  ctx.fillRect(x + 12, y + 11, 7, 3);
  ctx.fillStyle = COLOR.paper;
  ctx.fillRect(x + 27, y + 15, 3, 4);
}

function cutCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 2, 2);
  ctx.fillRect(x + width - 2, y, 2, 2);
  ctx.fillRect(x, y + height - 2, 2, 2);
  ctx.fillRect(x + width - 2, y + height - 2, 2, 2);
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: {
    size: number;
    color: string;
    align?: CanvasTextAlign;
  },
): void {
  ctx.save();
  ctx.fillStyle = options.color;
  ctx.font = `650 ${options.size}px ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
  ctx.restore();
}

function wrap(value: number, length: number): number {
  return (value + length) % length;
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

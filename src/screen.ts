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
  crewMemberIndex: number;
  crewScrollY: number;
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

export const CREW_MEMBERS: ReadonlyArray<{
  name: string;
  role: string;
  portrait: "captain" | "engineer" | "artist";
  bio: readonly string[];
}> = [
  {
    name: "Obibobi",
    role: "CREATIVE CAPTAIN",
    portrait: "captain",
    bio: [
      "BUILDS STRANGE WORLDS AND WRITES TROUBLE INTO EVERY CORNER.",
      "KEEPS PROJECTS POINTED TOWARD PLAYFUL SURPRISES, BOLD CHOICES, AND THE ROUTE NOBODY EXPECTED.",
    ],
  },
  {
    name: "Toter-Keks",
    role: "GAMEPLAY ENGINEER",
    portrait: "engineer",
    bio: [
      "TURNS WILD IDEAS INTO TIGHT, RESPONSIVE SYSTEMS THAT FEEL GOOD IN YOUR HANDS.",
      "HUNTS STUBBORN BUGS BEFORE THEY BITE, THEN TUNES EVERY JUMP, HIT, AND BUTTON PRESS.",
    ],
  },
  {
    name: "Guntmar 123",
    role: "STORY WRITER",
    portrait: "artist",
    bio: [
      "WRITES CHARACTERS, QUESTS, AND STRANGE TWISTS THAT PULL PLAYERS INTO EACH WORLD.",
      "SHAPES EVERY SCENE WITH HUMOR, HEART, AND JUST ENOUGH TROUBLE TO KEEP THE STORY MOVING.",
    ],
  },
];

const CREW_VIEW_TOP = 24;
const CREW_VIEW_BOTTOM = 128;
const CREW_VIEW_HEIGHT = CREW_VIEW_BOTTOM - CREW_VIEW_TOP;
const CREW_SCROLL_STEP = 13;

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
      crewMemberIndex: 0,
      crewScrollY: 0,
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

    if (this.state.screen === "crew") {
      if (action === "left") this.moveCrewMember(-1);
      if (action === "right") this.moveCrewMember(1);
      if (action === "up") this.scrollCrewProfile(-1);
      if (action === "down") this.scrollCrewProfile(1);
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

  private moveCrewMember(step: number): void {
    this.setState({
      crewMemberIndex: wrap(this.state.crewMemberIndex + step, CREW_MEMBERS.length),
      crewScrollY: 0,
    });
  }

  private scrollCrewProfile(step: number): void {
    const member = CREW_MEMBERS[this.state.crewMemberIndex];
    const maxScroll = Math.max(0, crewProfileHeight(this.context, member) - CREW_VIEW_HEIGHT);
    const crewScrollY = Math.min(
      maxScroll,
      Math.max(0, this.state.crewScrollY + step * CREW_SCROLL_STEP),
    );
    if (crewScrollY !== this.state.crewScrollY) this.setState({ crewScrollY });
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
    if (page === "crew") {
      this.drawCrew();
      return;
    }

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
    drawFooter(ctx, "", "B BACK");
  }

  private drawCrew(): void {
    this.clear();
    const ctx = this.context;
    const member = CREW_MEMBERS[this.state.crewMemberIndex];
    const profileHeight = crewProfileHeight(ctx, member);
    const maxScroll = Math.max(0, profileHeight - CREW_VIEW_HEIGHT);

    drawHeader(ctx, this.state.soundEnabled);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, CREW_VIEW_TOP, SCREEN_WIDTH - 5, CREW_VIEW_HEIGHT);
    ctx.clip();
    ctx.translate(0, CREW_VIEW_TOP - this.state.crewScrollY);

    text(ctx, "ROLL CALL", 10, 12, { size: 6, color: COLOR.deep });
    text(ctx, `< ${this.state.crewMemberIndex + 1} / ${CREW_MEMBERS.length} >`, 150, 12, {
      align: "right",
      size: 6,
      color: COLOR.deep,
    });
    text(ctx, member.name, 10, 31, { size: 11, color: COLOR.ink });
    text(ctx, member.role, 10, 44, { size: 6, color: COLOR.deep });
    drawCrewPortrait(ctx, 111, 19, member.portrait);

    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(10, 57, 139, 2);
    text(ctx, "PROFILE", 10, 72, { size: 6, color: COLOR.deep });
    drawCrewBio(ctx, member);
    ctx.restore();

    drawCrewScrollbar(ctx, this.state.crewScrollY, maxScroll, profileHeight);
    drawFooter(ctx, "<> MEMBER  ^v SCROLL", "B BACK");
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
    text(ctx, "D-PAD   MOVE / READ", 20, 57, { size: 6, color: COLOR.ink });
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

type CrewMember = (typeof CREW_MEMBERS)[number];

interface CrewBioLine {
  value: string;
  y: number;
  paragraph: number;
}

function screenFont(size: number): string {
  return `650 ${size}px ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  size: number,
): string[] {
  ctx.save();
  ctx.font = screenFont(size);
  const lines: string[] = [];
  let current = "";

  for (const word of value.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  ctx.restore();
  return lines;
}

function crewBioLayout(ctx: CanvasRenderingContext2D, member: CrewMember): {
  lines: CrewBioLine[];
  height: number;
} {
  const lines: CrewBioLine[] = [];
  let y = 87;

  member.bio.forEach((paragraph, paragraphIndex) => {
    for (const value of wrapText(ctx, paragraph, 139, 6.5)) {
      lines.push({ value, y, paragraph: paragraphIndex });
      y += 10;
    }
    if (paragraphIndex < member.bio.length - 1) y += 5;
  });

  return { lines, height: y + 6 };
}

function crewProfileHeight(ctx: CanvasRenderingContext2D, member: CrewMember): number {
  return crewBioLayout(ctx, member).height;
}

function drawCrewBio(ctx: CanvasRenderingContext2D, member: CrewMember): void {
  for (const line of crewBioLayout(ctx, member).lines) {
    text(ctx, line.value, 10, line.y, {
      size: 6.5,
      color: line.paragraph === 0 ? COLOR.ink : COLOR.deep,
    });
  }
}

function drawCrewPortrait(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  portrait: CrewMember["portrait"],
): void {
  ctx.fillStyle = COLOR.deep;
  ctx.fillRect(x, y, 38, 40);
  cutCorners(ctx, x, y, 38, 40, COLOR.paper);
  ctx.fillStyle = COLOR.light;
  ctx.fillRect(x + 3, y + 3, 32, 34);
  ctx.fillStyle = COLOR.paper;
  ctx.fillRect(x + 10, y + 10, 18, 19);
  ctx.fillStyle = COLOR.ink;
  ctx.fillRect(x + 8, y + 31, 22, 6);
  ctx.fillStyle = COLOR.deep;
  ctx.fillRect(x + 13, y + 18, 3, 3);
  ctx.fillRect(x + 22, y + 18, 3, 3);
  ctx.fillRect(x + 17, y + 25, 5, 2);

  if (portrait === "captain") {
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(x + 8, y + 7, 22, 6);
    ctx.fillRect(x + 8, y + 12, 4, 13);
    ctx.fillStyle = COLOR.flash;
    ctx.fillRect(x + 13, y + 8, 12, 2);
  } else if (portrait === "engineer") {
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(x + 10, y + 7, 18, 5);
    ctx.fillRect(x + 8, y + 17, 10, 6);
    ctx.fillRect(x + 20, y + 17, 10, 6);
    ctx.fillRect(x + 18, y + 19, 2, 2);
    ctx.fillStyle = COLOR.paper;
    ctx.fillRect(x + 11, y + 19, 4, 2);
    ctx.fillRect(x + 23, y + 19, 4, 2);
  } else {
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(x + 8, y + 7, 22, 5);
    ctx.fillRect(x + 8, y + 11, 5, 17);
    ctx.fillRect(x + 25, y + 11, 5, 10);
    ctx.fillStyle = COLOR.flash;
    ctx.fillRect(x + 27, y + 6, 3, 3);
  }
}

function drawCrewScrollbar(
  ctx: CanvasRenderingContext2D,
  scrollY: number,
  maxScroll: number,
  contentHeight: number,
): void {
  if (maxScroll <= 0) return;
  const trackY = CREW_VIEW_TOP + 4;
  const trackHeight = CREW_VIEW_HEIGHT - 8;
  const thumbHeight = Math.max(16, Math.round(trackHeight * (CREW_VIEW_HEIGHT / contentHeight)));
  const thumbTravel = trackHeight - thumbHeight;
  const thumbY = trackY + Math.round(thumbTravel * (scrollY / maxScroll));

  ctx.fillStyle = COLOR.light;
  ctx.fillRect(157, trackY, 2, trackHeight);
  ctx.fillStyle = COLOR.deep;
  ctx.fillRect(156, thumbY, 4, thumbHeight);
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
  ctx.font = screenFont(options.size);
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

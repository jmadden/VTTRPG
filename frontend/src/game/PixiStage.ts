// ============================================================================
// PixiStage.ts: owns the Pixi v8 Application and the three render layers.
//
// Layer order (back to front):
//   mapLayer   : background / grid lines (static-ish)
//   tokenLayer : one Container (circle + label) per token; draggable ones opt in
//   shroudLayer: fog: opaque over unrevealed cells (semi-transparent for GM)
//
// Input is unified at the stage level: pointer-down on a token starts a drag;
// pointer-down on empty space fires a cell action (reveal/conceal). State lives
// in store.ts; MapView calls syncTokens / redrawShroud on store changes.
// ============================================================================

import {
  Application,
  Circle,
  Container,
  Graphics,
  Text,
  type ColorSource,
  type FederatedPointerEvent,
} from 'pixi.js';
import {
  cellToWorld,
  cellPolygon,
  worldToCell,
  type CellKey,
  type ClientToken,
  type Grid,
} from '@vtt/shared';

const BG = '#0a0a0f';
const GRID_LINE = 0x2a2a3a;
const SHROUD_COLOR = 0x3b4a63; // slate blue-gray: reads clearly as fog

const TOKEN_COLORS: Record<ClientToken['type'], number> = {
  player: 0x4ade80, // green
  monster: 0xef4444, // red
  prop: 0x9ca3af, // gray
};

export interface StageHandlers {
  onCellAction: (cell: CellKey) => void;
  onTokenDrop: (tokenId: string, x: number, y: number) => void;
}

export class PixiStage {
  private app: Application | null = null;
  private mapLayer = new Container();
  private tokenLayer = new Container();
  private shroudLayer = new Container();
  private shroud = new Graphics();

  private grid: Grid = { type: 'square', size: 70 };
  private handlers: StageHandlers = { onCellAction: () => {}, onTokenDrop: () => {} };
  private dragging: { id: string; container: Container } | null = null;

  async init(canvasParent: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({ background: BG, resizeTo: canvasParent, antialias: true });
    canvasParent.appendChild(app.canvas);

    app.stage.addChild(this.mapLayer);
    app.stage.addChild(this.tokenLayer);
    app.stage.addChild(this.shroudLayer);
    this.shroudLayer.addChild(this.shroud);

    // The map grid and shroud span the whole board and sit above/around the
    // tokens. They must be non-interactive so hit-testing falls through to the
    // tokens (for dragging) and to the stage (for cell clicks). eventMode on
    // the parent container is not enough; the Graphics themselves must opt out.
    this.mapLayer.eventMode = 'none';
    this.shroudLayer.eventMode = 'none';
    this.shroud.eventMode = 'none';

    // Stage receives pointer events over empty space too (hitArea = screen).
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', this.onStagePointerDown);
    app.stage.on('pointermove', this.onStagePointerMove);
    app.stage.on('pointerup', this.onStagePointerUp);
    app.stage.on('pointerupoutside', this.onStagePointerUp);

    this.app = app;
  }

  setHandlers(handlers: StageHandlers): void {
    this.handlers = handlers;
  }

  get isDragging(): boolean {
    return this.dragging !== null;
  }

  /** Draw a faint grid so the empty scene reads as a battlemap. */
  drawMapPlaceholder(cols: number, rows: number, grid: Grid): void {
    this.grid = grid;
    this.mapLayer.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();

    if (grid.type === 'square') {
      const s = grid.size;
      const w = cols * s;
      const h = rows * s;
      for (let c = 0; c <= cols; c++) g.moveTo(c * s, 0).lineTo(c * s, h);
      for (let r = 0; r <= rows; r++) g.moveTo(0, r * s).lineTo(w, r * s);
      g.stroke({ color: GRID_LINE, width: 1 });
    } else {
      const w = cols * grid.size * 2;
      const h = rows * grid.size * 2;
      g.rect(0, 0, w, h).fill({ color: 0x14141f });
    }

    g.eventMode = 'none'; // never intercept pointer events over the grid
    this.mapLayer.addChild(g);
  }

  /** Rebuild the token layer. `movable` + `isGM` decide which tokens can drag. */
  syncTokens(
    tokens: Iterable<ClientToken>,
    grid: Grid,
    movable: Set<string>,
    isGM: boolean,
  ): void {
    this.grid = grid;
    this.tokenLayer.removeChildren().forEach((c) => c.destroy());

    for (const token of tokens) {
      const color: ColorSource = TOKEN_COLORS[token.type];
      const radius = 22;

      // A Container positioned at the token's world coords, so dragging is a
      // simple position update and the drop cell is the container position.
      const container = new Container();
      container.position.set(token.x, token.y);

      const g = new Graphics();
      g.circle(0, 0, radius).fill(color);
      g.circle(0, 0, radius).stroke({ color: 0x000000, width: 2 });
      container.addChild(g);

      const label = new Text({
        text: token.name,
        style: { fill: 0xffffff, fontSize: 12, fontFamily: 'system-ui' },
      });
      label.anchor.set(0.5, 1);
      label.y = -radius - 2;
      container.addChild(label);

      if (isGM || movable.has(token.id)) {
        container.eventMode = 'static';
        container.cursor = 'grab';
        // A Container has no geometry of its own; give it an explicit hit area
        // so pointer-down registers (its Graphics child is passive by default).
        container.hitArea = new Circle(0, 0, radius);
        container.on('pointerdown', (e) => this.onTokenPointerDown(e, token.id, container));
      } else {
        container.eventMode = 'none'; // clicks pass through to the stage
      }

      this.tokenLayer.addChild(container);
    }
  }

  /**
   * Repaint the shroud. Every cell NOT in `revealed` gets a fog polygon.
   * GM sees fog at reduced alpha (can peek); players get fully opaque fog.
   */
  redrawShroud(
    revealed: Set<CellKey>,
    grid: Grid,
    cols: number,
    rows: number,
    isGM: boolean,
  ): void {
    this.grid = grid;
    const g = this.shroud;
    g.clear();

    if (grid.type === 'square') {
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const key: CellKey = `${col},${row}`;
          if (revealed.has(key)) continue;
          g.poly(cellPolygon(key, grid));
        }
      }
    } else {
      const qMin = -Math.ceil(rows / 2);
      for (let r = 0; r <= rows; r++) {
        for (let q = qMin; q <= cols; q++) {
          const key: CellKey = `${q},${r}`;
          if (revealed.has(key)) continue;
          g.poly(cellPolygon(key, grid));
        }
      }
    }

    g.fill({ color: SHROUD_COLOR, alpha: isGM ? 0.5 : 1.0 });
  }

  destroy(): void {
    if (!this.app) return;
    this.app.destroy(true, { children: true });
    this.app = null;
  }

  // ── Pointer input ──────────────────────────────────────────────────────────

  private onTokenPointerDown = (
    e: FederatedPointerEvent,
    id: string,
    container: Container,
  ): void => {
    // Consume so the stage handler does not also treat this as a cell action.
    e.stopPropagation();
    this.dragging = { id, container };
    container.cursor = 'grabbing';
    this.tokenLayer.addChild(container); // bring to front while dragging
  };

  private onStagePointerDown = (e: FederatedPointerEvent): void => {
    if (this.dragging) return;
    this.handlers.onCellAction(worldToCell(e.global.x, e.global.y, this.grid));
  };

  private onStagePointerMove = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    this.dragging.container.position.set(e.global.x, e.global.y);
  };

  private onStagePointerUp = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    const { id, container } = this.dragging;
    // Snap to the center of the cell under the drop point.
    const cell = worldToCell(e.global.x, e.global.y, this.grid);
    const center = cellToWorld(cell, this.grid);
    container.position.set(center.x, center.y);
    container.cursor = 'grab';
    this.dragging = null;
    this.handlers.onTokenDrop(id, center.x, center.y);
  };
}

/**
 * Minimal SVG geometry for running bpmn-js in jsdom (tests only). jsdom has no SVGMatrix,
 * SVGTransform lists or layout, so this provides affine matrices, transform lists that keep the
 * `transform` attribute in sync, and approximate text / element bounding boxes. Rendering is not
 * pixel-accurate; it is enough to import, model and save diagrams through the real bpmn-js stack.
 */

class Matrix {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public e = 0,
    public f = 0,
  ) {}
  multiply(m: Matrix) {
    return new Matrix(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    );
  }
  translate(x: number, y: number) {
    return this.multiply(new Matrix(1, 0, 0, 1, x, y));
  }
  scale(s: number) {
    return this.multiply(new Matrix(s, 0, 0, s, 0, 0));
  }
  rotate(deg: number) {
    const r = (deg * Math.PI) / 180;
    return this.multiply(new Matrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0));
  }
  inverse() {
    const det = this.a * this.d - this.b * this.c;
    return new Matrix(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    );
  }
}

class Transform {
  matrix = new Matrix();
  type = 1;
  setMatrix(m: Matrix) {
    this.matrix = new Matrix(m.a, m.b, m.c, m.d, m.e, m.f);
  }
  setTranslate(x: number, y: number) {
    this.matrix = new Matrix(1, 0, 0, 1, x, y);
  }
  setScale(x: number, y: number) {
    this.matrix = new Matrix(x, 0, 0, y, 0, 0);
  }
  setRotate(deg: number, cx = 0, cy = 0) {
    this.matrix = new Matrix().translate(cx, cy).rotate(deg).translate(-cx, -cy);
  }
}

class TransformList {
  private items: Transform[] = [];
  constructor(private readonly owner: Element) {}
  get numberOfItems() {
    return this.items.length;
  }
  private sync() {
    const m = this.consolidate()?.matrix;
    if (m)
      this.owner.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    else this.owner.removeAttribute('transform');
  }
  clear() {
    this.items = [];
    this.sync();
  }
  appendItem(t: Transform) {
    this.items.push(t);
    this.sync();
    return t;
  }
  initialize(t: Transform) {
    this.items = [t];
    this.sync();
    return t;
  }
  getItem(i: number) {
    return this.items[i];
  }
  createSVGTransformFromMatrix(m: Matrix) {
    const t = new Transform();
    t.setMatrix(m);
    return t;
  }
  consolidate() {
    if (!this.items.length) return null;
    const t = new Transform();
    t.setMatrix(this.items.reduce((acc, x) => acc.multiply(x.matrix), new Matrix()));
    return t;
  }
}

const lists = new WeakMap<Element, TransformList>();

function localMatrix(el: Element): Matrix {
  return lists.get(el)?.consolidate()?.matrix ?? new Matrix();
}

/** Bounding box from the element's own geometry attributes (or its text / children). */
function bbox(el: Element): { x: number; y: number; width: number; height: number } {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? '0') || 0;
  switch (el.localName) {
    case 'rect':
    case 'image':
      return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
    case 'circle':
      return { x: n('cx') - n('r'), y: n('cy') - n('r'), width: 2 * n('r'), height: 2 * n('r') };
    case 'text':
    case 'tspan': {
      const text = el.textContent ?? '';
      return { x: 0, y: 0, width: text.length * 6.5, height: text ? 14 : 0 };
    }
    default: {
      const kids = Array.from(el.children)
        .map(bbox)
        .filter((b) => b.width || b.height);
      if (!kids.length) return { x: 0, y: 0, width: 0, height: 0 };
      const x = Math.min(...kids.map((b) => b.x));
      const y = Math.min(...kids.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...kids.map((b) => b.x + b.width)) - x,
        height: Math.max(...kids.map((b) => b.y + b.height)) - y,
      };
    }
  }
}

/** 2D canvas stand-in: bpmn-js normalises colours through `fillStyle` (hex → lower-case hex). */
function fakeContext2d() {
  let fill = '#000000';
  return {
    font: '',
    measureText: (text: string) => ({
      width: text.length * 6.5,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
    get fillStyle() {
      return fill;
    },
    set fillStyle(v: string) {
      fill = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : 'rgba(0, 0, 0, 0)';
    },
  };
}

export function installSvgGeometry() {
  const g = globalThis as Record<string, unknown>;
  if (g.SVGMatrix) return;
  HTMLCanvasElement.prototype.getContext = (() => fakeContext2d()) as never;
  g.SVGMatrix = Matrix;
  g.SVGTransform = Transform;
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, 'transform', {
    configurable: true,
    get(this: Element) {
      let list = lists.get(this);
      if (!list) lists.set(this, (list = new TransformList(this)));
      return { baseVal: list };
    },
  });
  proto.getBBox = function (this: Element) {
    return bbox(this);
  };
  proto.getComputedTextLength = function (this: Element) {
    return (this.textContent ?? '').length * 6.5;
  };
  /** Product of the transforms from the element up to (not including) the <svg> root. */
  const ctm = (el: Element | null): Matrix =>
    !el || el.localName === 'svg' ? new Matrix() : ctm(el.parentElement).multiply(localMatrix(el));
  proto.getCTM = function (this: Element) {
    return ctm(this);
  };
  proto.getScreenCTM = proto.getCTM;
  const svg = (globalThis as unknown as { SVGSVGElement: { prototype: Record<string, unknown> } })
    .SVGSVGElement.prototype;
  svg.createSVGMatrix = () => new Matrix();
  svg.createSVGTransform = () => new Transform();
  svg.createSVGTransformFromMatrix = (m: Matrix) => {
    const t = new Transform();
    t.setMatrix(m);
    return t;
  };
  svg.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform(this: { x: number; y: number }, m: Matrix) {
      return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f };
    },
  });
}

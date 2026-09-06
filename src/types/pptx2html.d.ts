declare module "pptx2html" {
  export default function renderPptx(
    pptx: ArrayBuffer,
    resultElement: Element | string,
    thumbElement?: Element | string
  ): Promise<number>;
}

declare module "jquery" {
  const jquery: unknown;
  export default jquery;
}

declare module "d3" {
  const d3: unknown;
  export = d3;
}

declare module "dimple" {
  const dimple: unknown;
  export default dimple;
}

declare module "jszip" {
  const JSZip: unknown;
  export default JSZip;
}

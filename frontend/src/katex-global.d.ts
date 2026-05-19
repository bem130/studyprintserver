interface KatexRenderOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
  strict?: boolean | string;
}

interface KatexGlobal {
  renderToString(expression: string, options?: KatexRenderOptions): string;
}

declare const katex: KatexGlobal;

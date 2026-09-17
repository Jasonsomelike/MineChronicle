declare module '*stat-icon-renderer.mjs' {
  export function renderRuntime(
    job: unknown,
  ): Promise<{ image: string; width: number; height: number; kind: string }>;
}

// Deno 全局类型声明 - 供 Edge Functions 使用
// Supabase Edge Functions 运行在 Deno 上，但本地 TS 环境无内置类型
// 此文件让 IDE 识别 Deno 命名空间，消除 "找不到名称 Deno" 错误

declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): Record<string, string>;
  };
  serve(handler: (request: Request) => Response | Promise<Response>, options?: unknown): void;
  serve(options: {
    port?: number;
    hostname?: string;
    handler: (request: Request) => Response | Promise<Response>;
    onListen?: (params: { hostname: string; port: number }) => void;
    signal?: AbortSignal;
  }): void;
  readTextFile(path: string | URL): Promise<string>;
  writeTextFile(path: string | URL, data: string): Promise<void>;
  mkdir(path: string | URL, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string | URL): Promise<void>;
};

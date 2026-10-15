import type { ServerOptions } from "ws";
import type { FastifyStaticOptions } from "@fastify/static";

// Keep file downloads and the live IPC connection independent. Only the
// packaged webview assets use the prebuilt compressed representations.
export const WEBVIEW_STATIC_OPTIONS: Pick<
  FastifyStaticOptions,
  "preCompressed" | "setHeaders" | "cacheControl"
> = {
  preCompressed: true,
  cacheControl: false,
  setHeaders(response, assetPath): void {
    response.setHeader("Vary", "Accept-Encoding");
    const hashedAsset = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)(?:\.br|\.gz)?$/.test(
      assetPath,
    );
    response.setHeader(
      "Cache-Control",
      hashedAsset
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    );
  },
};

export const BROWSER_SOCKET_OPTIONS: ServerOptions = {
  noServer: true,
  perMessageDeflate: {
    threshold: 1024,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    concurrencyLimit: 4,
    zlibDeflateOptions: { level: 3 },
  },
};

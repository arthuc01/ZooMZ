declare module "pako" {
  const pako: {
    inflate(data: Uint8Array, options?: unknown): Uint8Array;
  };
  export default pako;
}

declare module "react-plotly.js" {
  import type { ComponentType } from "react";
  const Plot: ComponentType<any>;
  export default Plot;
}

declare module "@vercel/blob" {
  export type BlobListItem = {
    url: string;
    pathname: string;
  };

  export function put(
    pathname: string,
    body: string | Blob | ArrayBuffer | Uint8Array,
    options?: {
      access?: "public";
      addRandomSuffix?: boolean;
      contentType?: string;
    }
  ): Promise<{ url: string; pathname: string }>;

  export function list(options?: { prefix?: string }): Promise<{ blobs: BlobListItem[] }>;

  export function del(url: string | string[]): Promise<void>;
}

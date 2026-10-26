// Minimal types for js-md5 (ships none). We only use the incremental hasher:
//   const h = md5.create(); h.update(bytes); h.hex();
declare module "js-md5" {
  interface Md5Hasher {
    update(data: string | ArrayBuffer | ArrayBufferView | number[]): Md5Hasher;
    hex(): string;
  }
  interface Md5 {
    (data: string | ArrayBuffer | ArrayBufferView | number[]): string;
    create(): Md5Hasher;
  }
  const md5: Md5;
  export default md5;
}

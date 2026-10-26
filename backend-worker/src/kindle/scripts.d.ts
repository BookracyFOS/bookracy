// Shell scripts in this folder are bundled as text (see the `[[rules]]` Text
// entry in wrangler.toml) so the Worker can serve them from /kindle/*.
declare module "*.sh" {
  const content: string;
  export default content;
}

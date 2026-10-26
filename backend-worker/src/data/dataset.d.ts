// Flattened datasets in this folder are bundled as text (see the `[[rules]]` Text
// entry in wrangler.toml) and JSON.parse'd lazily by the module that owns them.
declare module "*.dataset" {
  const content: string;
  export default content;
}

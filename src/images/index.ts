// The plugin's one upload store (endpoint, note lookups and the shutdown hook share it).
import { createImageUploads, ImageUploads } from "./uploads";

let store: ImageUploads | undefined;

export function imageUploads(): ImageUploads {
  return (store ??= createImageUploads());
}

// Unused image uploads live only in memory: discard them when the plugin shuts down.
import { imageUploads } from "../images";
import { LifecycleHook } from "../registry/types";

const hook: LifecycleHook = {
  name: "image-uploads",
  shutdown() {
    imageUploads().clear();
  },
};
export default hook;

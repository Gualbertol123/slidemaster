/* Component tests (jsdom) run the core with the page's platform, as main.tsx installs it (DOMParser, canvas). */
import { installBrowserPlatform } from "../src/platform";

installBrowserPlatform();

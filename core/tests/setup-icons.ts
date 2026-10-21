/* Every core test and benchmark draws "tabler:" icons as the page's workers do (the S15.1 review, finding 2): the set is
   registered through the same entry point, installTabler (core/src/icons; core/src/workers/main.ts calls it too). It
   is inflated only when a test draws the first Tabler name, so a test that draws none pays nothing but the import. */
import { installTabler } from "../src/icons";

installTabler();

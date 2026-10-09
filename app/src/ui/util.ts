import { get } from "../state/store";
export const presetOf = () => get().doc.view?.preset || null;

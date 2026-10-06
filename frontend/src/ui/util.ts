import { S } from "../state/store";
export const presetOf = () => S.sync?.view.preset || null;

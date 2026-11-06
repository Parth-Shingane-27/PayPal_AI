import { cookies } from "next/headers";
import { isUiLang, LANG_COOKIE, translator, type UiLang } from "./core";

/** The interface language chosen with the picker (cookie), English by default. */
export async function getUiLang(): Promise<UiLang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isUiLang(v) ? v : "en";
}

export async function getT() {
  return translator(await getUiLang());
}

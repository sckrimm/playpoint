import texts from "./texts.json";

export type Language = keyof typeof texts;

export type TextGetter = (key: string) => string;

export function getText(language: Language, key: string) {
  return texts[language][key as keyof typeof texts[typeof language]] ?? texts.ka[key as keyof typeof texts.ka] ?? key;
}

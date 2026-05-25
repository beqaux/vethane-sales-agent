import { POSITIONING } from "./knowledge/positioning";
import { FAQ } from "./knowledge/faq";
import { OBJECTIONS } from "./knowledge/objections";
import type { Knowledge } from "../domain/types";

/** RAG korpusu (v1: enjekte edilen küratör bilgi; vektör DB yok). */
export function getKnowledge(): Knowledge {
  return { positioning: POSITIONING, faq: FAQ, objections: OBJECTIONS };
}

// Every language file, bundled statically (they are small, and the app must work offline). English is the fallback.
import type { Messages } from "./core";
import bn from "./shared/bn.json";
import en from "./shared/en.json";
import gu from "./shared/gu.json";
import hi from "./shared/hi.json";
import kn from "./shared/kn.json";
import ml from "./shared/ml.json";
import mr from "./shared/mr.json";
import pa from "./shared/pa.json";
import ta from "./shared/ta.json";
import te from "./shared/te.json";

export const MESSAGES: Record<string, Messages> = { en, hi, mr, bn, ta, te, kn, ml, gu, pa } as Record<string, Messages>;

import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { signatureOk } from "./amb-signature";

const key = "1db0f513-a31f-4afa-9def-fdd6d2398c22";
const body = '{"id":"1db0f513","currency":"THB","productId":"5G_GAMES","timestampMillis":1776929280534,"username":"cp000001"}';
const ts = "1776929280534";
const sign = (raw: string, t: string) => createHmac("sha256", key).update(`${raw}.${t}`).digest("hex");

test("a callback signed with our key over the raw body and its timestamp is accepted", () => {
  expect(signatureOk(body, ts, sign(body, ts), key)).toBe(true);
  expect(signatureOk(body, ts, sign(body, ts).toUpperCase(), key)).toBe(true);
});

test("anything else is refused: another body, another timestamp, another key, or no signature", () => {
  expect(signatureOk(body.replace("THB", "USD"), ts, sign(body, ts), key)).toBe(false);
  expect(signatureOk(body, "1776929280535", sign(body, ts), key)).toBe(false);
  expect(signatureOk(body, ts, sign(body, ts), "another-key")).toBe(false);
  expect(signatureOk(body, null, sign(body, ts), key)).toBe(false);
  expect(signatureOk(body, ts, null, key)).toBe(false);
  expect(signatureOk(body, ts, "not-hex", key)).toBe(false);
  expect(signatureOk(body, ts, sign(body, ts), "")).toBe(false);
});

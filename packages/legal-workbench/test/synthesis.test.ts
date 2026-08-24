import { describe, expect, test } from "bun:test"
import { parseSynthesis } from "../src/synthesis"

describe("subscription synthesis contract", () => {
  test("SYN-01 accepts exact answer claims selecting allowed passages", () => {
    expect(
      parseSynthesis(
        JSON.stringify({
          answer: "The rule applies, subject to a narrow qualification.",
          claims: [
            {
              text: "The rule applies, subject to a narrow qualification.",
              evidence: [
                { passageId: "psg_rule", relationship: "supports" },
                { passageId: "psg_limit", relationship: "qualifies" },
              ],
            },
          ],
        }),
        new Set(["psg_rule", "psg_limit"]),
      ),
    ).toMatchObject({ claims: [{ evidence: [{ relationship: "supports" }, { relationship: "qualifies" }] }] })
  })

  test("SYN-02 rejects model-invented passage IDs", () => {
    expect(() =>
      parseSynthesis(
        '{"answer":"A claim.","claims":[{"text":"A claim.","evidence":[{"passageId":"psg_invented","relationship":"supports"}]}]}',
        new Set(["psg_real"]),
      ),
    ).toThrow("unavailable passage")
  })

  test("SYN-03 rejects claims that cannot map uniquely to answer offsets", () => {
    expect(() =>
      parseSynthesis(
        '{"answer":"Rule. Rule.","claims":[{"text":"Rule.","evidence":[{"passageId":"psg_rule","relationship":"supports"}]}]}',
        new Set(["psg_rule"]),
      ),
    ).toThrow("unique answer substring")
  })
})

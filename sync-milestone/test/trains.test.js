import { describe, expect, it } from "vitest";
import { dateOf } from "../src/trains.js";

describe("dateOf", () => {
  it.each([
    ["2026-11-19T00:00:00Z", "2026-11-19"],
    ["2026-11-19T12:00:00Z", "2026-11-19"],
    // GitHub sends the previous due date in the time zone of the editor
    ["2026-11-18T18:00:00.000-06:00", "2026-11-19"],
    ["2026-11-18T19:00:00.000-05:00", "2026-11-19"],
    ["2026-11-19T09:00:00.000+09:00", "2026-11-19"],
  ])("%s is the day %s", (value, date) => {
    expect(dateOf(value)).toBe(date);
  });

  it.each([[""], [null], [undefined], ["not a date"]])(
    "%j is no date",
    (value) => {
      expect(dateOf(value)).toBe("");
    },
  );
});

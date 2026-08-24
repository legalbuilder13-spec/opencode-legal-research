import { describe, expect, test } from "bun:test"

import { isPublicAddress, publicHttpTarget } from "../src/public-network"

describe("public network boundary", () => {
  test("accepts ordinary globally routable IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true)
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true)
  })

  test("rejects local, private, documentation, transition, and reserved address ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.1.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "::1",
      "fc00::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
      "2001:0db8::1",
      "2002:7f00:1::",
      "3fff::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
    ])
      expect(isPublicAddress(address), address).toBe(false)
  })

  test("returns the exact validated answer set from one lookup", async () => {
    let lookups = 0
    const target = await publicHttpTarget("https://authority.test/opinion#section", async () => {
      lookups += 1
      return ["93.184.216.34"]
    })
    expect(lookups).toBe(1)
    expect(target.addresses).toEqual(["93.184.216.34"])
    expect(target.url.toString()).toBe("https://authority.test/opinion")
  })
})

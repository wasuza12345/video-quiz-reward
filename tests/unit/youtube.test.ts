import { describe, expect, it } from "vitest";
import { parseYoutubeId } from "@/shared/youtube-id";

describe("parseYoutubeId", () => {
  it("accepts a bare 11-char id", () => {
    expect(parseYoutubeId("X7K_Xlz3T1Y")).toBe("X7K_Xlz3T1Y");
  });

  it("accepts youtu.be/ID", () => {
    expect(parseYoutubeId("https://youtu.be/X7K_Xlz3T1Y")).toBe("X7K_Xlz3T1Y");
  });

  it("accepts youtu.be/ID with query params", () => {
    expect(parseYoutubeId("https://youtu.be/X7K_Xlz3T1Y?t=5")).toBe("X7K_Xlz3T1Y");
  });

  it("accepts youtube.com/watch?v=ID", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=X7K_Xlz3T1Y")).toBe("X7K_Xlz3T1Y");
  });

  it("accepts youtube.com/watch?v=ID with extra params", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=X7K_Xlz3T1Y&list=abc&t=10s")).toBe("X7K_Xlz3T1Y");
  });

  it("accepts youtube.com/embed/ID", () => {
    expect(parseYoutubeId("https://www.youtube.com/embed/X7K_Xlz3T1Y")).toBe("X7K_Xlz3T1Y");
  });

  it("accepts youtube.com/shorts/ID", () => {
    expect(parseYoutubeId("https://www.youtube.com/shorts/X7K_Xlz3T1Y")).toBe("X7K_Xlz3T1Y");
  });

  it("trims surrounding whitespace", () => {
    expect(parseYoutubeId("  X7K_Xlz3T1Y  ")).toBe("X7K_Xlz3T1Y");
  });

  it("rejects an unrelated URL", () => {
    expect(parseYoutubeId("https://example.com/watch?v=X7K_Xlz3T1Y")).toBeNull();
  });

  it("rejects a youtube.com URL missing the v param", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(parseYoutubeId("not a url at all")).toBeNull();
    expect(parseYoutubeId("")).toBeNull();
    expect(parseYoutubeId("too-short")).toBeNull();
  });

  it("rejects a youtube.com playlist/channel URL with no video id", () => {
    expect(parseYoutubeId("https://www.youtube.com/channel/UC1234567890")).toBeNull();
  });
});
